import { OnramperError, OnramperErrorCode } from '../errors.ts';
import type { OnramperChannel } from '../types/onramper.ts';
import { createNobleCryptoAdapter } from './crypto/noble.ts';
import { createWebCryptoAdapter } from './crypto/webcrypto.ts';
import { createPersistedFingerprintAdapter } from './fingerprint/persisted.ts';
import { createWebFingerprintAdapter } from './fingerprint/web.ts';
import { createFetchHttpAdapter } from './http/fetch.ts';
import { createMemoryStorageAdapter } from './storage/memory.ts';
import type { Adapters, CryptoAdapter } from './types.ts';

export type RuntimeKind = 'web' | 'node' | 'bare';

/**
 * Best-effort runtime detection. Web is checked first: a browser always pairs
 * `window` with WebCrypto, so a stray global named `Bare` can't divert it to the
 * extractable JS key and forfeit the non-extractable-key protection. Bare has no
 * `window` and a `crypto.subtle` without ECDSA, so it falls through to the JS
 * adapter. React Native (also `navigator`-bearing) stays unsupported.
 *
 * @returns `'web'` when a `window` with WebCrypto is present, `'bare'` under the
 *   Bare runtime, else `'node'`.
 */
export function detectRuntime(): RuntimeKind {
  if (typeof (globalThis as { window?: unknown }).window !== 'undefined' && globalThis.crypto?.subtle) {
    return 'web';
  }
  if (typeof (globalThis as { Bare?: unknown }).Bare !== 'undefined') {
    return 'bare';
  }
  return 'node';
}

/**
 * Maps a runtime to its reported `X-Onramper-Channel` value (WDK family).
 *
 * @param runtime - The detected (or configured) runtime kind.
 * @returns The channel to report for that runtime.
 */
export function channelForRuntime(runtime: RuntimeKind): OnramperChannel {
  // Bare reports as wdk-node: the server's SDK-version platform token accepts
  // only ios|android|web|rn|node, so a bare-specific token would fail auth until
  // the server allows one. Detection still routes Bare to the JS crypto adapter.
  return runtime === 'web' ? 'wdk-web' : 'wdk-node';
}

/**
 * Picks the default crypto adapter for a runtime. Bare's WebCrypto has no ECDSA
 * P-256, so it gets the pure-JS adapter; web/Node use WebCrypto, whose private
 * key stays non-extractable. A runtime with neither fails loudly rather than
 * silently degrading DPoP security.
 *
 * @param runtime - The runtime to pick the crypto default for.
 * @returns The default crypto adapter for `runtime`.
 * @throws {OnramperError} `INVALID_CONFIG` on a non-Bare runtime with no
 *   WebCrypto (`crypto.subtle`).
 */
function defaultCryptoAdapter(runtime: RuntimeKind): CryptoAdapter {
  if (runtime === 'bare') {
    return createNobleCryptoAdapter();
  }
  if (!globalThis.crypto?.subtle) {
    throw new OnramperError(
      OnramperErrorCode.INVALID_CONFIG,
      'This runtime has no WebCrypto (crypto.subtle). Provide config.adapters.crypto.',
    );
  }
  return createWebCryptoAdapter();
}

/**
 * Builds the full adapter set, applying any consumer overrides over the
 * per-runtime defaults. Non-Bare environments without WebCrypto must inject a
 * `crypto` adapter — we fail loudly rather than silently degrade security.
 *
 * @param runtime - The runtime to pick per-runtime defaults for.
 * @param overrides - Consumer-supplied adapters that take precedence over the defaults.
 * @returns The resolved adapter set.
 * @throws {OnramperError} `INVALID_CONFIG` when no `crypto` override was given
 *   and a non-Bare runtime exposes no WebCrypto (`crypto.subtle`).
 */
export function resolveAdapters(runtime: RuntimeKind, overrides?: Partial<Adapters>): Adapters {
  const storage = overrides?.storage ?? createMemoryStorageAdapter();
  const http = overrides?.http ?? createFetchHttpAdapter();
  const crypto = overrides?.crypto ?? defaultCryptoAdapter(runtime);

  const fingerprint =
    overrides?.fingerprint ??
    (runtime === 'web' ? createWebFingerprintAdapter(crypto) : createPersistedFingerprintAdapter(storage));

  return { crypto, storage, http, fingerprint };
}
