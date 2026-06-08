/**
 * Platform abstraction seam. The protocol and client layers only ever touch
 * these four interfaces, never a platform API directly — this is what lets one
 * package run on web, Node and React Native. It mirrors the dependency-injection
 * seam the Swift SDK uses (BFFClient / TokenStorage / AppAttestService protocols).
 *
 * Each adapter has a per-platform default (see `src/adapters/index.ts`) and can
 * be overridden via `OnramperFiatConfig.adapters` — RN consumers inject their own
 * storage/crypto here.
 */

/**
 * Opaque handle to an ES256 (P-256) key pair used for DPoP proof-of-possession.
 * The private key is intentionally non-serialisable: on web/Node it is a
 * non-extractable `CryptoKey`/`KeyObject` so it cannot be exfiltrated by XSS;
 * on React Native it lives in JS memory (documented caveat — no Secure Enclave).
 */
export interface Es256KeyHandle {
  readonly privateKey: unknown;
  readonly publicKey: unknown;
}

export interface CryptoAdapter {
  /** Generate a fresh, non-extractable-where-possible ES256 key pair. */
  generateEs256KeyPair(): Promise<Es256KeyHandle>;
  /** Export ONLY the public key as a JWK ({ kty:'EC', crv:'P-256', x, y }). */
  exportPublicJwk(handle: Es256KeyHandle): Promise<JsonWebKey>;
  /**
   * Sign `data` with the private key, returning the raw IEEE-P1363 r||s
   * signature (64 bytes) — NOT DER. JOSE compact serialization requires r||s,
   * and WebCrypto already produces it; the noble adapter must match.
   */
  signEs256(handle: Es256KeyHandle, data: Uint8Array): Promise<Uint8Array>;
  /** SHA-256 digest, used for DPoP `ath`, fingerprints and the JWK thumbprint. */
  sha256(data: Uint8Array): Promise<Uint8Array>;
}

/** Minimal key/value store for the session/refresh tokens and DPoP key material. */
export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpAdapter {
  request(req: HttpRequest): Promise<HttpResponse>;
}

/**
 * Produces a stable per-install device fingerprint. This is a soft signal (it is
 * spoofable), bound into the access token's `did` claim server-side and used as
 * one input to abuse heuristics — it is not a root of trust.
 */
export interface FingerprintAdapter {
  get(): Promise<string>;
}

export interface Adapters {
  crypto: CryptoAdapter;
  storage: StorageAdapter;
  http: HttpAdapter;
  fingerprint: FingerprintAdapter;
}
