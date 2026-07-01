import type { OnramperChannel } from '../types/onramper.ts';
import { randomId } from '../utils/format.ts';

/** Version reported in `X-Onramper-SDK-Version`. Server regex expects `<platform>-<semver>`. */
export const SDK_VERSION = '0.1.0';

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
 * The headers `buildEnvelopeHeaders` produces for one session-gated request.
 * Extends the index signature `HttpRequest.headers` expects, so the result
 * can be passed straight through to an `HttpAdapter`.
 */
export interface EnvelopeHeaders {
  [header: string]: string;
  Authorization: string;
  'X-Onramper-SDK-Session': string;
  'X-Onramper-DPoP': string;
  'X-Onramper-Nonce': string;
  'X-Onramper-Timestamp': string;
  'X-Onramper-Device': string;
  'X-Onramper-Channel': string;
  'X-Onramper-SDK-Version': string;
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
 * fingerprint.
 *
 * @param input - The per-request values to embed in the envelope.
 * @returns The headers to attach to the session-gated request.
 */
export function buildEnvelopeHeaders(input: EnvelopeInput): EnvelopeHeaders {
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
