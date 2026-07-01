import { bytesToBase64Url } from '../../utils/format.ts';
import type { CryptoAdapter, FingerprintAdapter } from '../types.ts';

/**
 * Browser device fingerprint. A coarse, stable-per-browser hash of low-entropy
 * signals (UA, platform, language, screen, timezone). It is a soft abuse signal,
 * not a security boundary, so we avoid invasive techniques (canvas/WebGL) that
 * hurt privacy for little gain.
 *
 * @param crypto - Digest provider used to hash the collected signals.
 * @returns A fingerprint adapter whose `get()` recomputes the hash on every call.
 */
export function createWebFingerprintAdapter(crypto: CryptoAdapter): FingerprintAdapter {
  return {
    /**
     * Recomputes the fingerprint from the current browser signals.
     *
     * @throws {OnramperError} Propagates any failure from the underlying
     *   `crypto.sha256` call (e.g. `INVALID_CONFIG` if no WebCrypto is available).
     */
    async get(): Promise<string> {
      const nav = globalThis.navigator;
      const scr = globalThis.screen;
      const parts = [
        nav?.userAgent ?? '',
        nav?.language ?? '',
        nav?.platform ?? '',
        nav?.hardwareConcurrency ?? '',
        scr ? `${scr.width}x${scr.height}x${scr.colorDepth}` : '',
        Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
      ].join('|');
      const digest = await crypto.sha256(new TextEncoder().encode(parts));
      return bytesToBase64Url(digest);
    },
  };
}
