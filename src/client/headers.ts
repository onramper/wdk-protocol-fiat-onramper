import type { OnramperChannel } from '../types/onramper.ts';
import { randomId } from '../utils/format.ts';

/**
 * Version reported in `X-Onramper-SDK-Version` (server expects `<platform>-<semver>`).
 * Must equal `package.json` version — a unit test asserts it so the two can't drift.
 */
export const SDK_VERSION = '0.2.0';

/** Inputs to a single session-gated request's security envelope. */
export interface EnvelopeInput {
  /** Publishable partner API key. */
  apiKey: string;
  /** Client channel reported to the server. */
  channel: OnramperChannel;
  /** The session's current bearer access token. */
  accessToken: string;
  /** Compact DPoP proof JWS bound to this request's method and URL. */
  dpopProof: string;
  /** Device fingerprint from the active `FingerprintAdapter`. */
  deviceFingerprint: string;
  /** Fresh per-request replay-protection value (see {@link newNonce}). */
  nonce: string;
}

/**
 * Maps the channel to the runtime platform token used in the SDK-version header.
 * The server cross-checks the channel's runtime suffix against this token, so
 * `wdk-web` → `web` yields `X-Onramper-SDK-Version: web-<semver>`.
 *
 * @param channel - The client channel to map.
 * @returns The platform token (`'web'` or `'node'`).
 */
function platformForChannel(channel: OnramperChannel): string {
  return channel === 'wdk-web' ? 'web' : 'node';
}

/**
 * The per-request security envelope enforced by the API. Every authenticated
 * data call carries a fresh DPoP proof, nonce, timestamp, and device
 * fingerprint. The returned headers:
 * - `Authorization` — the publishable partner API key.
 * - `X-Onramper-SDK-Session` — `Bearer <accessToken>`.
 * - `X-Onramper-DPoP` — the compact DPoP proof JWS bound to this request.
 * - `X-Onramper-Nonce` — fresh per-request replay-protection value.
 * - `X-Onramper-Timestamp` — the request's ISO-8601 issue time.
 * - `X-Onramper-Device` — the active `FingerprintAdapter`'s device fingerprint.
 * - `X-Onramper-Channel` / `X-Onramper-SDK-Version` — client platform + version.
 *
 * @param input - The per-request values to embed in the envelope.
 * @returns The headers to attach to the session-gated request, keyed by
 *   header name — pass straight through to an `HttpAdapter`.
 */
export function buildEnvelopeHeaders(input: EnvelopeInput): Record<string, string> {
  return {
    Authorization: input.apiKey,
    'X-Onramper-SDK-Session': `Bearer ${input.accessToken}`,
    'X-Onramper-DPoP': input.dpopProof,
    'X-Onramper-Nonce': input.nonce,
    'X-Onramper-Timestamp': new Date().toISOString(),
    'X-Onramper-Device': input.deviceFingerprint,
    'X-Onramper-Channel': input.channel,
    'X-Onramper-SDK-Version': `${platformForChannel(input.channel)}-${SDK_VERSION}`,
  };
}

/**
 * Fresh per-request value for the `X-Onramper-Nonce` replay-protection header.
 *
 * @returns A random nonce, unique per call.
 */
export function newNonce(): string {
  return randomId('nonce');
}

/**
 * Case-insensitive read of the server's DPoP nonce challenge header. The
 * built-in `fetch` adapter normalises header names to lowercase, but a
 * custom-injected `HttpAdapter` isn't required to — so this scans every key
 * rather than checking a fixed pair of casings.
 *
 * @param headers - The response headers to search.
 * @returns The `DPoP-Nonce` header value, if present.
 */
export function readDpopNonce(headers: Record<string, string>): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'dpop-nonce') {
      return value;
    }
  }
  return undefined;
}
