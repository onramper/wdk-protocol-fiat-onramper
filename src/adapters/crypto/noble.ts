import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToBase64Url } from '../../utils/format.ts';
import type { CryptoAdapter, ES256KeyHandle } from '../types.ts';

/** Byte offsets of X/Y inside a 65-byte uncompressed P-256 point (`0x04 ‖ X ‖ Y`). */
const UNCOMPRESSED_X = 1;
const UNCOMPRESSED_Y = 33;
const UNCOMPRESSED_END = 65;

/**
 * Pure-JS ES256 (P-256) adapter for runtimes whose WebCrypto lacks ECDSA — the
 * Bare default, since `bare-crypto`'s `crypto.subtle` implements only HMAC,
 * Ed25519, PBKDF2 and SHA (no ECDSA/P-256), so {@link createWebCryptoAdapter}
 * throws `NotSupportedError` there at key generation.
 *
 * Security trade-off vs. the WebCrypto default: the private key is a JS-held
 * scalar (`Uint8Array`), so it is extractable in-process rather than a
 * non-extractable `CryptoKey`. That is acceptable only under Bare's server/
 * embedded threat model (no DOM, no XSS); on web the WebCrypto adapter's
 * non-extractable key stays the default. Consumers wanting hardware-backed keys
 * inject their own adapter via `config.adapters.crypto`.
 */
export function createNobleCryptoAdapter(): CryptoAdapter {
  return {
    /** Generates a P-256 key pair; the private key is held as a JS scalar (extractable). */
    async generateEs256KeyPair(): Promise<ES256KeyHandle> {
      const privateKey = p256.utils.randomSecretKey();
      // Uncompressed so exportPublicJwk can slice the raw X/Y coordinates.
      const publicKey = p256.getPublicKey(privateKey, false);
      return { privateKey, publicKey };
    },

    /** Exports the public point as a bare EC P-256 JWK (`x`/`y` only — no `ext`/`key_ops` to normalise away). */
    async exportPublicJwk(handle: ES256KeyHandle): Promise<JsonWebKey> {
      const point = handle.publicKey as Uint8Array;
      return {
        kty: 'EC',
        crv: 'P-256',
        x: bytesToBase64Url(point.slice(UNCOMPRESSED_X, UNCOMPRESSED_Y)),
        y: bytesToBase64Url(point.slice(UNCOMPRESSED_Y, UNCOMPRESSED_END)),
      };
    },

    /**
     * Signs `data`, hashing with SHA-256 and emitting raw IEEE-P1363 r||s — the
     * same bytes WebCrypto's `ECDSA`/`SHA-256` produces, so DPoP proofs verify
     * identically across adapters. `prehash: true` makes noble do the SHA-256
     * internally, matching WebCrypto's sign-the-digest semantics.
     */
    async signEs256(handle: ES256KeyHandle, data: Uint8Array): Promise<Uint8Array> {
      return p256.sign(data, handle.privateKey as Uint8Array, { prehash: true });
    },

    /** Digests `data` with SHA-256. */
    async sha256(data: Uint8Array): Promise<Uint8Array> {
      return sha256(data);
    },
  };
}
