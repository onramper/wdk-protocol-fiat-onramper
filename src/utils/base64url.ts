/**
 * Base64url helpers with no `Buffer` dependency, so the same code runs in the
 * browser and Node. `btoa`/`atob` are available in both
 * (RN/Hermes included).
 */

const encoder = new TextEncoder();

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function utf8ToBase64Url(value: string): string {
  return bytesToBase64Url(encoder.encode(value));
}

/** Base64url of a JSON value — the building block for JWS header/payload segments. */
export function jsonToBase64Url(value: unknown): string {
  return utf8ToBase64Url(JSON.stringify(value));
}
