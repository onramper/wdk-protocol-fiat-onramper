import { bytesToBase64Url } from '../../utils/base64url.ts';
import type { CryptoAdapter, FingerprintAdapter } from '../types.ts';

/**
 * Browser device fingerprint. A coarse, stable-per-browser hash of low-entropy
 * signals (UA, platform, language, screen, timezone). It is a soft abuse signal
 * bound into the access token `did` claim — not a security boundary — so we
 * avoid invasive techniques (canvas/WebGL) that hurt privacy for little gain.
 */
export function createWebFingerprintAdapter(crypto: CryptoAdapter): FingerprintAdapter {
  return {
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
