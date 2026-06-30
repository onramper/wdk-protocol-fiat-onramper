import { OnramperError, OnramperErrorCode } from '../errors.ts';

/** UUID when the runtime exposes one, else a prefixed time+random fallback. */
export function randomId(prefix: string): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  );
}

/** Coerce an optional number/string to its decimal string form, preserving `undefined`. */
export function toOptionalString(value: number | string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'number' ? String(value) : value;
}

const encoder = new TextEncoder();

/** Encodes raw bytes as an unpadded base64url string (RFC 4648 §5 alphabet, trailing `=` stripped). */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes an unpadded (or padded) base64url string back to raw bytes; missing `=` padding is restored before decoding. */
export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Encodes a UTF-8 string as an unpadded base64url string. */
function utf8ToBase64Url(value: string): string {
  return bytesToBase64Url(encoder.encode(value));
}

/** Base64url of a JSON value — the building block for JWS header/payload segments. */
export function jsonToBase64Url(value: unknown): string {
  return utf8ToBase64Url(JSON.stringify(value));
}

/**
 * Decode a body that is expected to be JSON. A 2xx response can still carry a
 * non-JSON payload — a proxy/CDN interstitial returned with status 200, a
 * truncated transfer — so we surface the library's one error type
 * (`DECODE_ERROR`) instead of letting a raw `SyntaxError` escape the contract.
 *
 * `T` is an unchecked assertion: callers must validate the returned shape
 * before trusting it.
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
