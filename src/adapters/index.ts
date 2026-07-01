import { OnramperError, OnramperErrorCode } from '../errors.ts';
import type { OnramperChannel } from '../types/onramper.ts';
import { createWebCryptoAdapter } from './crypto/webcrypto.ts';
import { createPersistedFingerprintAdapter } from './fingerprint/persisted.ts';
import { createWebFingerprintAdapter } from './fingerprint/web.ts';
import { createFetchHttpAdapter } from './http/fetch.ts';
import { createMemoryStorageAdapter } from './storage/memory.ts';
import type { Adapters } from './types.ts';

export type RuntimeKind = 'web' | 'node';

/**
 * Best-effort runtime detection. React Native (which also reports a
 * `navigator`) is unsupported — runtimes without WebCrypto fail at adapter
 * resolution with a clear error rather than being misdetected as web.
 *
 * @returns `'web'` when a `window` with WebCrypto is present, else `'node'`.
 */
export function detectRuntime(): RuntimeKind {
  if (typeof (globalThis as { window?: unknown }).window !== 'undefined' && globalThis.crypto?.subtle) {
    return 'web';
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
  return runtime === 'web' ? 'wdk-web' : 'wdk-node';
}

/**
 * Builds the full adapter set, applying any consumer overrides over the
 * per-runtime defaults. Environments without WebCrypto must inject a `crypto`
 * adapter — we fail loudly rather than silently degrade security.
 *
 * @param runtime - The runtime to pick per-runtime defaults for.
 * @param overrides - Consumer-supplied adapters that take precedence over the defaults.
 * @returns The resolved adapter set.
 * @throws {OnramperError} `INVALID_CONFIG` when no `crypto` override was given
 *   and the runtime exposes no WebCrypto (`crypto.subtle`).
 */
export function resolveAdapters(runtime: RuntimeKind, overrides?: Partial<Adapters>): Adapters {
  const storage = overrides?.storage ?? createMemoryStorageAdapter();
  const http = overrides?.http ?? createFetchHttpAdapter();

  let crypto = overrides?.crypto;
  if (!crypto) {
    if (!globalThis.crypto?.subtle) {
      throw new OnramperError(
        OnramperErrorCode.INVALID_CONFIG,
        'This runtime has no WebCrypto (crypto.subtle). Provide config.adapters.crypto.',
      );
    }
    crypto = createWebCryptoAdapter();
  }

  const fingerprint =
    overrides?.fingerprint ??
    (runtime === 'web' ? createWebFingerprintAdapter(crypto) : createPersistedFingerprintAdapter(storage));

  return { crypto, storage, http, fingerprint };
}
