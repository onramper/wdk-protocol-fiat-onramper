import type { Adapters } from '../adapters/types.ts';
import { mapCheckoutError, OnramperErrorCode } from '../errors/index.ts';
import type { OnramperChannel } from '../types/onramper.ts';
import { parseJsonBody, safeJsonBody } from '../utils/json.ts';
import { buildDpopProof } from './dpop.ts';
import { buildEnvelopeHeaders, newNonce, readDpopNonce } from './headers.ts';
import type { SessionManager } from './session-manager.ts';

interface AuthorizedClientDeps {
  adapters: Adapters;
  session: SessionManager;
  apiKey: string;
  channel: OnramperChannel;
}

/**
 * Issues authenticated GET calls in two flavors:
 *   - `getWithApiKey`: the publishable apiKey alone, for the public data
 *     endpoints (supported, quotes).
 *   - `getWithSession`: the full SDK session envelope (access token + DPoP),
 *     for checkout session. Recovers once from an expired session (401 →
 *     invalidate + refresh) and once from a DPoP nonce challenge, then gives up.
 */
export class AuthorizedClient {
  constructor(private readonly deps: AuthorizedClientDeps) {}

  /** @throws {OnramperError} Mapped from the non-2xx response (see `OnramperErrorCode`). */
  async getWithApiKey<T>(url: string): Promise<T> {
    const res = await this.deps.adapters.http.request({
      method: 'GET',
      url,
      headers: { Authorization: this.deps.apiKey },
    });
    if (res.status >= 200 && res.status < 300) {
      return parseJsonBody<T>(res.body);
    }
    throw mapCheckoutError(res.status, safeJsonBody(res.body));
  }

  /** @throws {OnramperError} Mapped from the non-2xx response (see `OnramperErrorCode`) after the session-refresh and DPoP-nonce retries are exhausted. */
  async getWithSession<T>(url: string): Promise<T> {
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
        return parseJsonBody<T>(res.body);
      }

      const parsed = safeJsonBody(res.body);

      // DPoP nonce challenge: retry once echoing the server-provided nonce.
      const serverNonce = readDpopNonce(res.headers);
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
