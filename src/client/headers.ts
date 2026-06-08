import type { OnramperChannel } from '../types/onramper.ts';

/** Version reported in `X-Onramper-SDK-Version`. Server regex expects `<platform>-<semver>`. */
export const SDK_VERSION = '0.1.0';

export interface EnvelopeInput {
  apiKey: string;
  channel: OnramperChannel;
  accessToken: string;
  dpopProof: string;
  deviceFingerprint: string;
  nonce: string;
}

/**
 * Maps the channel to the runtime platform token used in the SDK-version header.
 * The server cross-checks the channel's runtime suffix against this token, so
 * `wdk-web` → `web` yields `X-Onramper-SDK-Version: web-<semver>`.
 */
function platformForChannel(channel: OnramperChannel): string {
  switch (channel) {
    case 'wdk-web':
      return 'web';
    case 'wdk-rn':
      return 'rn';
    case 'wdk-node':
      return 'node';
  }
}

/**
 * The per-request security envelope enforced by headless `sdkAuth` middleware.
 * Every authenticated data call carries a fresh DPoP proof + nonce + timestamp;
 * the device fingerprint must hash to the access token's `did` claim.
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

export function newNonce(): string {
  return globalThis.crypto?.randomUUID?.() ?? `nonce_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
