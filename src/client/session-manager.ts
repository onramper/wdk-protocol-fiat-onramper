import type { Adapters, Es256KeyHandle } from '../adapters/types.ts';
import { mapOAuthError, OnramperError, OnramperErrorCode } from '../errors/index.ts';
import type { GetSessionToken, OnramperChannel } from '../types/onramper.ts';
import { buildDpopProof } from './dpop.ts';
import type { Endpoints } from './endpoints.ts';
import { newNonce } from './headers.ts';

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
 * Owns the SDK session lifecycle for the non-attested (Tier-1) path: it mints a
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
  private inFlight?: Promise<string>;

  constructor(private readonly deps: SessionManagerDeps) {}

  /** Clears the whole session, forcing a fresh bootstrap on next use. */
  reset(): void {
    this.accessToken = undefined;
    this.accessTokenExpSec = 0;
    this.refreshToken = undefined;
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
    this.inFlight = this.acquire().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async acquire(): Promise<string> {
    if (this.refreshToken) {
      try {
        return await this.refresh();
      } catch (err) {
        // A failed refresh is recoverable by re-bootstrapping from a fresh
        // session token; surface anything that isn't an OAuth-level rejection.
        if (!(err instanceof OnramperError)) {
          throw err;
        }
        this.reset();
      }
    }
    return this.bootstrap();
  }

  private async bootstrap(): Promise<string> {
    const { sessionToken } = await this.deps.getSessionToken();
    const fingerprint = await this.getFingerprint();
    const response = await this.tokenRequest({
      grant_type: 'session_token',
      session_token: sessionToken,
      attestation: { type: 'none' },
      device_fingerprint: fingerprint,
    });
    this.store(response);
    return response.access_token;
  }

  private async refresh(): Promise<string> {
    if (!this.refreshToken) {
      throw new OnramperError(OnramperErrorCode.INVALID_SDK_SESSION, 'No refresh token available');
    }
    const response = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
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
   */
  private async tokenRequest(body: Record<string, unknown>, dpopNonce?: string): Promise<TokenResponse> {
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
      },
      body: JSON.stringify(body),
    });

    if (res.status >= 200 && res.status < 300) {
      return JSON.parse(res.body) as TokenResponse;
    }

    const parsed = safeJson(res.body);
    const serverNonce = res.headers['dpop-nonce'] ?? res.headers['DPoP-Nonce'];
    const isNonceChallenge =
      (parsed as { error?: string } | undefined)?.error === 'use_dpop_nonce' && serverNonce && !dpopNonce;
    if (isNonceChallenge) {
      return this.tokenRequest(body, serverNonce);
    }
    throw mapOAuthError(res.status, parsed);
  }
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
