import type { Adapters, Es256KeyHandle } from '../adapters/types.ts';
import { mapOAuthError, OnramperError, OnramperErrorCode, REBOOTSTRAP_CODES } from '../errors/index.ts';
import type { GetSessionToken, OnramperChannel } from '../types/onramper.ts';
import { parseJsonBody, safeJsonBody } from '../utils/json.ts';
import { buildDpopProof } from './dpop.ts';
import type { Endpoints } from './endpoints.ts';
import { newNonce, readDpopNonce } from './headers.ts';

/** Refresh this many seconds before expiry, matching the iOS SDK's proactive skew. */
const PROACTIVE_REFRESH_SKEW_SEC = 60;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  device_id?: string;
  tier?: number;
}

interface SessionManagerDeps {
  adapters: Adapters;
  endpoints: Endpoints;
  apiKey: string;
  channel: OnramperChannel;
  getSessionToken: GetSessionToken;
}

/**
 * Owns the SDK session lifecycle for the non-attested path: it mints a
 * DPoP key, bootstraps an access token from a backend-issued session token
 * (sending `attestation.type:'none'`), and refreshes it. Concurrent callers are
 * coalesced via a single in-flight promise so we never run two exchanges at once.
 */
export class SessionManager {
  private key?: Es256KeyHandle;
  private fingerprint?: string;
  private accessToken?: string;
  private accessTokenExpSec = 0;
  private refreshToken?: string;
  /** Session id (`sid`) the partner backend issued alongside the session token.
   *  the API's refresh grant requires it and never echoes it back, so it's
   *  captured at bootstrap and resent on every refresh (mirrors the iOS SDK). */
  private sessionId?: string;
  private inFlight?: Promise<string>;

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
  async getKey(): Promise<Es256KeyHandle> {
    if (!this.key) {
      this.key = await this.deps.adapters.crypto.generateEs256KeyPair();
    }
    return this.key;
  }

  /** The device fingerprint (resolved lazily, then cached). It hashes to the access token's `did` claim, so it must stay stable for the session. */
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
    // getSessionToken is consumer-supplied (it makes the partner's request signing
    // call), so any throw — fetch rejection, timeout — must still reach callers
    // as the library's one error type, not a raw exception.
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
    // The device fingerprint rides on the X-Onramper-Device HEADER;
    // the API hard-rejects the exchange without it and its body schema has
    // no device field, so a body-only fingerprint is silently dropped.
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
    // the API's refresh grant requires session_id (the refresh schema) and
    // resolves the session row by it; the refresh token alone is insufficient.
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
   * `extraHeaders` carries request-specific headers — the bootstrap exchange
   * adds `device` (the X-Onramper-Device fingerprint); refresh sends none.
   */
  private async tokenRequest(
    body: Record<string, unknown>,
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
      (parsed as { error?: string } | undefined)?.error === 'use_dpop_nonce' && serverNonce && !dpopNonce;
    if (isNonceChallenge) {
      return this.tokenRequest(body, extraHeaders, serverNonce);
    }
    throw mapOAuthError(res.status, parsed);
  }
}
