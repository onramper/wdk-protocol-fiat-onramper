import type { Adapters } from '../adapters/types.ts';
import { mapCheckoutError, OnramperError, OnramperErrorCode } from '../errors/index.ts';
import type { OnramperChannel } from '../types/onramper.ts';
import { buildDpopProof } from './dpop.ts';
import { buildEnvelopeHeaders, newNonce } from './headers.ts';
import type { SessionManager } from './session-manager.ts';

interface AuthorizedClientDeps {
  adapters: Adapters;
  session: SessionManager;
  apiKey: string;
  channel: OnramperChannel;
}

/**
 * Issues authenticated GET data calls (quotes, supported, transactions) carrying
 * the full SDK envelope. Recovers once from an expired session (401 →
 * invalidate + refresh) and once from a DPoP nonce challenge, then gives up.
 */
export class AuthorizedClient {
  constructor(private readonly deps: AuthorizedClientDeps) {}

  async getJson<T>(url: string): Promise<T> {
    let allowSessionRetry = true;
    let dpopNonce: string | undefined;

    for (;;) {
      const accessToken = await this.deps.session.getAccessToken();
      const [key, fingerprint] = await Promise.all([this.deps.session.getKey(), this.deps.session.getFingerprint()]);
      const dpopProof = await buildDpopProof(this.deps.adapters.crypto, key, {
        method: 'GET',
        url,
        accessToken,
        nonce: dpopNonce,
      });

      const res = await this.deps.adapters.http.request({
        method: 'GET',
        url,
        headers: buildEnvelopeHeaders({
          apiKey: this.deps.apiKey,
          channel: this.deps.channel,
          accessToken,
          dpopProof,
          deviceFingerprint: fingerprint,
          nonce: newNonce(),
        }),
      });

      if (res.status >= 200 && res.status < 300) {
        return JSON.parse(res.body) as T;
      }

      const parsed = safeJson(res.body);

      // DPoP nonce challenge: retry once echoing the server-provided nonce.
      const serverNonce = res.headers['dpop-nonce'] ?? res.headers['DPoP-Nonce'];
      if (serverNonce && !dpopNonce) {
        dpopNonce = serverNonce;
        continue;
      }

      // Stale session: refresh once, then retry the call.
      const error = mapCheckoutError(res.status, parsed);
      if (res.status === 401 && allowSessionRetry && error.code === OnramperErrorCode.INVALID_SDK_SESSION) {
        allowSessionRetry = false;
        this.deps.session.invalidateAccessToken();
        continue;
      }
      throw error;
    }
  }
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Narrow helper used by transforms to assert a present field. */
export function requireField<T>(value: T | undefined | null, name: string): T {
  if (value === undefined || value === null) {
    throw new OnramperError(OnramperErrorCode.DECODE_ERROR, `Expected field "${name}" missing in response`);
  }
  return value;
}
