import { OnramperError, OnramperErrorCode } from '../errors.ts';

/**
 * UUID when the runtime exposes one, else a prefixed time+random fallback.
 *
 * @param prefix - Prefix used only by the fallback path (e.g. `'nonce'`, `'jti'`).
 * @returns A random identifier, unique per call.
 */
export function randomId(prefix: string): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  );
}

/**
 * Coerce an optional number/string to its decimal string form, preserving `undefined`.
 *
 * @param value - The value to coerce.
 * @returns The decimal string form of `value`, or `undefined` if `value` is `undefined`.
 */
export function toOptionalString(value: number | string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'number' ? String(value) : value;
}

const encoder = new TextEncoder();

/**
 * Encodes raw bytes as an unpadded base64url string (RFC 4648 §5 alphabet, trailing `=` stripped).
 *
 * @param bytes - The bytes to encode.
 * @returns The base64url-encoded string.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes an unpadded (or padded) base64url string back to raw bytes; missing `=` padding is restored before decoding.
 *
 * @param value - The base64url string to decode.
 * @returns The decoded bytes.
 */
export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes a UTF-8 string as an unpadded base64url string.
 *
 * @param value - The string to encode.
 * @returns The base64url-encoded string.
 */
function utf8ToBase64Url(value: string): string {
  return bytesToBase64Url(encoder.encode(value));
}

/**
 * Base64url of a JSON value — the building block for JWS header/payload segments.
 *
 * @param value - The value to serialize.
 * @returns The base64url-encoded JSON.
 */
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
 * @param body - The raw response body.
 * @returns `body`, parsed as JSON and asserted to type `T`.
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

/**
 * Best-effort parse of an error body (parsed for error mapping), `undefined` when it isn't JSON.
 *
 * @param body - The raw response body.
 * @returns The parsed JSON value, or `undefined` if `body` isn't valid JSON.
 */
export function safeJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
