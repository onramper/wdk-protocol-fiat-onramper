import { OnramperError, OnramperErrorCode } from '../errors/index.ts';

/**
 * Decode a body that is expected to be JSON. A 2xx response can still carry a
 * non-JSON payload — a proxy/CDN interstitial returned with status 200, a
 * truncated transfer — so we surface the library's one error type
 * (`DECODE_ERROR`) instead of letting a raw `SyntaxError` escape the contract.
 *
 * `T` is an unchecked assertion: callers must validate the returned shape (e.g.
 * with the corresponding zod schema) before trusting it.
 *
 * @throws {OnramperError} With code `OnramperErrorCode.DECODE_ERROR` when `body`
 *   is not valid JSON.
 */
export function parseJsonBody<T>(body: string): T {
  try {
    return JSON.parse(body) as T;
  } catch (cause) {
    throw new OnramperError(OnramperErrorCode.DECODE_ERROR, 'Failed to decode response body', { cause });
  }
}

/** Best-effort parse of an error body (parsed for error mapping), `undefined` when it isn't JSON. */
export function safeJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
