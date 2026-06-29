import type { CryptoAdapter, Es256KeyHandle } from '../types.ts';

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto SubtleCrypto is unavailable in this runtime');
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
    async generateEs256KeyPair(): Promise<Es256KeyHandle> {
      const pair = await getSubtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
      return { privateKey: pair.privateKey, publicKey: pair.publicKey };
    },

    async exportPublicJwk(handle: Es256KeyHandle): Promise<JsonWebKey> {
      return getSubtle().exportKey('jwk', handle.publicKey as CryptoKey);
    },

    async signEs256(handle: Es256KeyHandle, data: Uint8Array): Promise<Uint8Array> {
      // WebCrypto ECDSA emits the raw IEEE-P1363 r||s signature JOSE expects.
      const sig = await getSubtle().sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        handle.privateKey as CryptoKey,
        data as BufferSource,
      );
      return new Uint8Array(sig);
    },

    async sha256(data: Uint8Array): Promise<Uint8Array> {
      const digest = await getSubtle().digest('SHA-256', data as BufferSource);
      return new Uint8Array(digest);
    },
  };
}
