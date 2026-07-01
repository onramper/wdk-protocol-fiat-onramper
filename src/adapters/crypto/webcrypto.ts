import { OnramperError, OnramperErrorCode } from '../../errors.ts';
import type { CryptoAdapter, ES256KeyHandle } from '../types.ts';

/**
 * Resolves the runtime's `SubtleCrypto` instance.
 *
 * @throws {OnramperError} `INVALID_CONFIG` when the runtime exposes no
 *   `crypto.subtle` and no override was supplied via `config.adapters.crypto`.
 */
function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new OnramperError(OnramperErrorCode.INVALID_CONFIG, 'WebCrypto SubtleCrypto is unavailable in this runtime');
  }
  return subtle;
}

/**
 * WebCrypto-backed crypto adapter, shared by the web and Node defaults (Node 20+
 * exposes the same `globalThis.crypto.subtle`).
 *
 * Why this is the secure default: for asymmetric key generation WebCrypto always
 * marks the PUBLIC key extractable but honours the `extractable` flag for the
 * PRIVATE key. Generating with `extractable: false` therefore gives us a private
 * key that XSS cannot export, while still letting us export the public JWK for
 * the DPoP header. A stolen access token is then useless without this key.
 */
export function createWebCryptoAdapter(): CryptoAdapter {
  return {
    /** Generates the key pair with the private key marked non-extractable — see the class doc above. */
    async generateEs256KeyPair(): Promise<ES256KeyHandle> {
      const pair = await getSubtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
      return { privateKey: pair.privateKey, publicKey: pair.publicKey };
    },

    /** Exports the public half of `handle` as a JWK; the private key stays opaque. */
    async exportPublicJwk(handle: ES256KeyHandle): Promise<JsonWebKey> {
      return getSubtle().exportKey('jwk', handle.publicKey as CryptoKey);
    },

    /** Signs `data`, converting WebCrypto's raw IEEE-P1363 r||s output (already JOSE-compatible) to bytes. */
    async signEs256(handle: ES256KeyHandle, data: Uint8Array): Promise<Uint8Array> {
      const sig = await getSubtle().sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        handle.privateKey as CryptoKey,
        data as BufferSource,
      );
      return new Uint8Array(sig);
    },

    /** Digests `data` with SHA-256. */
    async sha256(data: Uint8Array): Promise<Uint8Array> {
      const digest = await getSubtle().digest('SHA-256', data as BufferSource);
      return new Uint8Array(digest);
    },
  };
}
