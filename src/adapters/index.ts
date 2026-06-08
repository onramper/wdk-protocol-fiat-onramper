import { OnramperError, OnramperErrorCode } from '../errors/index.ts';
import type { OnramperChannel } from '../types/onramper.ts';
import { createWebCryptoAdapter } from './crypto/webcrypto.ts';
import { createPersistedFingerprintAdapter } from './fingerprint/persisted.ts';
import { createWebFingerprintAdapter } from './fingerprint/web.ts';
import { createFetchHttpAdapter } from './http/fetch.ts';
import { createMemoryStorageAdapter } from './storage/memory.ts';
import type { Adapters } from './types.ts';

export type RuntimeKind = 'web' | 'node' | 'react-native';

/** Best-effort runtime detection. Order matters: RN reports a `navigator`, so check it first. */
export function detectRuntime(): RuntimeKind {
  const nav = (globalThis as { navigator?: { product?: string } }).navigator;
  if (nav?.product === 'ReactNative') {
    return 'react-native';
  }
  if (typeof (globalThis as { window?: unknown }).window !== 'undefined' && globalThis.crypto?.subtle) {
    return 'web';
  }
  return 'node';
}

/** Maps a runtime to its reported `X-Onramper-Channel` value (WDK family). */
export function channelForRuntime(runtime: RuntimeKind): OnramperChannel {
  switch (runtime) {
    case 'web':
      return 'wdk-web';
    case 'react-native':
      return 'wdk-rn';
    case 'node':
      return 'wdk-node';
  }
}

/**
 * Builds the full adapter set, applying any consumer overrides over the
 * per-runtime defaults. React Native has no WebCrypto and no fully-featured
 * default yet (v0.2), so it requires an injected `crypto` adapter — we fail
 * loudly rather than silently degrade security.
 */
export function resolveAdapters(runtime: RuntimeKind, overrides?: Partial<Adapters>): Adapters {
  const storage = overrides?.storage ?? createMemoryStorageAdapter();
  const http = overrides?.http ?? createFetchHttpAdapter();

  let crypto = overrides?.crypto;
  if (!crypto) {
    if (runtime === 'react-native') {
      throw new OnramperError(
        OnramperErrorCode.INVALID_CONFIG,
        'React Native has no built-in WebCrypto. Provide config.adapters.crypto (a @noble/curves-backed adapter ships in v0.2).',
      );
    }
    crypto = createWebCryptoAdapter();
  }

  const fingerprint =
    overrides?.fingerprint ??
    (runtime === 'web' ? createWebFingerprintAdapter(crypto) : createPersistedFingerprintAdapter(storage));

  return { crypto, storage, http, fingerprint };
}
