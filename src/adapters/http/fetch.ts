import { OnramperError, OnramperErrorCode } from '../../errors/index.ts';
import type { HttpAdapter, HttpRequest, HttpResponse } from '../types.ts';

/**
 * `fetch`-based HTTP adapter. `fetch` is global on web, Node 18+ and RN/Hermes,
 * so this is the default everywhere. Network-level failures map to NETWORK_ERROR;
 * HTTP status interpretation is left to callers (they know which wire format the
 * endpoint speaks).
 */
export function createFetchHttpAdapter(fetchImpl: typeof fetch = globalThis.fetch): HttpAdapter {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No global fetch available; provide an http adapter or a fetch implementation');
  }
  return {
    async request(req: HttpRequest): Promise<HttpResponse> {
      let response: Response;
      try {
        response = await fetchImpl(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
          // Never follow redirects: an unexpected redirect on an authenticated
          // call is a security smell (SSRF / token leak to another origin).
          redirect: 'error',
        });
      } catch (cause) {
        throw new OnramperError(OnramperErrorCode.NETWORK_ERROR, `Network request to ${req.url} failed`, { cause });
      }
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return { status: response.status, headers, body: await response.text() };
    },
  };
}
