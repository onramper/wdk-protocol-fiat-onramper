import type { Adapters, ES256KeyHandle } from '../adapters/types.ts';
import { mapOAuthError, OnramperError, OnramperErrorCode, REBOOTSTRAP_CODES } from '../errors.ts';
import type { GetSessionToken, OnramperChannel } from '../types/onramper.ts';
import { parseJsonBody, safeJsonBody } from '../utils/format.ts';
import { buildDpopProof } from './dpop.ts';
import type { Endpoints } from './endpoints.ts';
import { newNonce, readDpopNonce } from './headers.ts';

/** Refresh this many seconds before expiry, a proactive refresh skew. */
const PROACTIVE_REFRESH_SKEW_SEC = 60;

interface TokenResponse {
  /** The bearer access token to send on session-gated calls. */
  access_token: string;
  /** Rotating credential for the next refresh; absent when the server doesn't rotate it. */
  refresh_token?: string;
  /** Access-token lifetime, in seconds from issuance. */
  expires_in: number;
  /** Server-assigned device identifier; currently unused by the client. */
  device_id?: string;
  /** Server-assigned trust tier for the device; currently unused by the client. */
  tier?: number;
}

/** Bootstraps a session from a partner-issued session token. */
interface SessionTokenGrant {
  grant_type: 'session_token';
  /** The opaque `st_` token minted by the partner's `getSessionToken` callback. */
  session_token: string;
  /** Device-attestation payload; `{ type: 'none' }` until an attestation provider is wired in. */
  attestation: { type: 'none' };
}

/** Refreshes an existing session using its rotating refresh token. */
interface RefreshTokenGrant {
  grant_type: 'refresh_token';
  /** The refresh token returned by the previous token exchange. */
  refresh_token: string;
  /** The session id the refresh token belongs to; the server resolves the session by it. */
  session_id: string;
}

/** The two grant shapes the token endpoint accepts. */
type TokenRequestBody = SessionTokenGrant | RefreshTokenGrant;

/** Minimal shape needed to detect the `use_dpop_nonce` challenge in an OAuth error body. */
interface DpopNonceChallengeBody {
  error?: string;
}

interface SessionManagerDeps {
  /** Platform adapters used for signing, storage, transport and fingerprinting. */
  adapters: Adapters;
  /** URL builder for the token endpoint. */
  endpoints: Endpoints;
  /** Publishable partner API key, sent on the token exchange. */
  apiKey: string;
  /** Client channel reported on the token exchange. */
  channel: OnramperChannel;
  /** Consumer callback that mints a fresh session token when bootstrapping. */
  getSessionToken: GetSessionToken;
}

/**
 * Owns the SDK session lifecycle: it mints a DPoP key, bootstraps an access
 * token from a backend-issued session token, and refreshes it. Concurrent
 * callers are coalesced via a single in-flight promise so we never run two
 * exchanges at once.
 */
export class SessionManager {
  private key?: ES256KeyHandle;
  private fingerprint?: string;
  private accessToken?: string;
  private accessTokenExpSec = 0;
  private refreshToken?: string;
  /** Session id (`sid`) the partner backend issued alongside the session token.
   *  The API's refresh grant requires it and never echoes it back, so it's
   *  captured at bootstrap and resent on every refresh. */
  private sessionId?: string;
  private inFlight?: Promise<string>;

  /**
   * Creates a session manager bound to its collaborators.
   *
   * @param deps - The session manager's collaborators (adapters, endpoints, credentials).
   */
  constructor(private readonly deps: SessionManagerDeps) {}

  /** Clears the whole session, forcing a fresh bootstrap on next use. */
  reset(): void {
    this.accessToken = undefined;
    this.accessTokenExpSec = 0;
    this.refreshToken = undefined;
    this.sessionId = undefined;
  }

  /** Marks the current access token unusable so the next call refreshes (or re-bootstraps). */
  invalidateAccessToken(): void {
    this.accessToken = undefined;
    this.accessTokenExpSec = 0;
  }

  /** The DPoP key handle (generated lazily). Callers need it to sign per-request proofs. */
  async getKey(): Promise<ES256KeyHandle> {
    if (!this.key) {
      this.key = await this.deps.adapters.crypto.generateEs256KeyPair();
    }
    return this.key;
  }

  /** The device fingerprint (resolved lazily, then cached). It must stay stable for the session. */
  async getFingerprint(): Promise<string> {
    if (this.fingerprint === undefined) {
      this.fingerprint = await this.deps.adapters.fingerprint.get();
    }
    return this.fingerprint;
  }

  /** Returns a valid access token, refreshing or bootstrapping as needed (single-flight). */
  async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && this.accessTokenExpSec - PROACTIVE_REFRESH_SKEW_SEC > now) {
      return this.accessToken;
    }
    if (this.inFlight) {
      return this.inFlight;
    }
    // Single chokepoint for the single-error-type guarantee: any raw throw from
    // an adapter (HTTP/crypto) or a non-OAuth refresh failure surfaces here as an
    // OnramperError instead of a native exception.
    this.inFlight = this.acquire()
      .catch((err) => {
        throw err instanceof OnramperError
          ? err
          : new OnramperError(OnramperErrorCode.UPSTREAM_ERROR, 'Failed to obtain access token', { cause: err });
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }

  private async acquire(): Promise<string> {
    if (this.refreshToken) {
      try {
        return await this.refresh();
      } catch (err) {
        // Only a dead-session rejection (bad refresh credential) is recoverable
        // by re-bootstrapping. A decode/transport/DPoP failure must surface —
        // re-bootstrapping would mask it and likely fail the same way.
        if (!(err instanceof OnramperError) || !REBOOTSTRAP_CODES.has(err.code)) {
          throw err;
        }
        this.reset();
      }
    }
    return this.bootstrap();
  }

  private async bootstrap(): Promise<string> {
    // getSessionToken is consumer-supplied (it calls the partner's backend), so
    // any throw — fetch rejection, timeout — must still reach callers as the
    // library's one error type, not a raw exception.
    let sessionId: string;
    let sessionToken: string;
    try {
      ({ sessionId, sessionToken } = await this.deps.getSessionToken());
    } catch (err) {
      throw err instanceof OnramperError
        ? err
        : new OnramperError(OnramperErrorCode.UPSTREAM_ERROR, 'getSessionToken callback failed', { cause: err });
    }
    this.sessionId = sessionId;
    const fingerprint = await this.getFingerprint();
    // The device fingerprint rides on the X-Onramper-Device HEADER; the API
    // requires it there and ignores any body field, so a body-only fingerprint
    // is silently dropped.
    const response = await this.tokenRequest(
      {
        grant_type: 'session_token',
        session_token: sessionToken,
        attestation: { type: 'none' },
      },
      { device: fingerprint },
    );
    this.store(response);
    return response.access_token;
  }

  private async refresh(): Promise<string> {
    if (!this.refreshToken) {
      throw new OnramperError(OnramperErrorCode.INVALID_SDK_SESSION, 'No refresh token available');
    }
    if (!this.sessionId) {
      throw new OnramperError(OnramperErrorCode.INVALID_SDK_SESSION, 'No session id available for refresh');
    }
    // The API's refresh grant requires session_id and resolves the session by it;
    // the refresh token alone is insufficient.
    const response = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      session_id: this.sessionId,
    });
    this.store(response);
    return response.access_token;
  }

  private store(response: TokenResponse): void {
    this.accessToken = response.access_token;
    this.accessTokenExpSec = Math.floor(Date.now() / 1000) + response.expires_in;
    if (response.refresh_token) {
      this.refreshToken = response.refresh_token;
    }
  }

  /**
   * POSTs to the token endpoint with a DPoP proof bound to that endpoint. If the
   * server demands a DPoP nonce (`use_dpop_nonce`), retries once echoing it.
   *
   * @param body - The grant to request (session-token bootstrap or refresh).
   * @param extraHeaders - Request-specific headers — the bootstrap exchange
   *   adds `device` (the X-Onramper-Device fingerprint); refresh sends none.
   * @param dpopNonce - The server-issued nonce to echo, when retrying after a nonce challenge.
   * @returns The parsed token response.
   * @throws {OnramperError} Mapped from the token endpoint's RFC 6749 error body
   *   after the one nonce-challenge retry is exhausted.
   */
  private async tokenRequest(
    body: TokenRequestBody,
    extraHeaders: { device?: string } = {},
    dpopNonce?: string,
  ): Promise<TokenResponse> {
    const url = this.deps.endpoints.tokens(this.deps.apiKey);
    const key = await this.getKey();
    const dpopProof = await buildDpopProof(this.deps.adapters.crypto, key, { method: 'POST', url, nonce: dpopNonce });

    const res = await this.deps.adapters.http.request({
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.deps.apiKey,
        'X-Onramper-DPoP': dpopProof,
        'X-Onramper-Nonce': newNonce(),
        'X-Onramper-Timestamp': new Date().toISOString(),
        'X-Onramper-Channel': this.deps.channel,
        ...(extraHeaders.device ? { 'X-Onramper-Device': extraHeaders.device } : {}),
      },
      body: JSON.stringify(body),
    });

    if (res.status >= 200 && res.status < 300) {
      return parseJsonBody<TokenResponse>(res.body);
    }

    const parsed = safeJsonBody(res.body);
    const serverNonce = readDpopNonce(res.headers);
    const isNonceChallenge =
      (parsed as DpopNonceChallengeBody | undefined)?.error === 'use_dpop_nonce' && serverNonce && !dpopNonce;
    if (isNonceChallenge) {
      return this.tokenRequest(body, extraHeaders, serverNonce);
    }
    throw mapOAuthError(res.status, parsed);
  }
}
