/**
 * Platform abstraction seam. The protocol and client layers only ever touch
 * these four interfaces, never a platform API directly — this is what lets one
 * package run on web and Node.
 *
 * Each adapter has a per-platform default (see `src/adapters/index.ts`) and can
 * be overridden via `OnramperFiatConfig.adapters` — RN consumers inject their own
 * storage/crypto here.
 */

/**
 * Opaque handle to an ES256 (P-256) key pair used for DPoP proof-of-possession.
 * The private key is intentionally non-serialisable: on web/Node it is a
 * non-extractable `CryptoKey`/`KeyObject` so it cannot be exfiltrated by XSS;
 * a future React Native adapter would hold it in JS memory (no Secure Enclave).
 *
 * @see https://www.rfc-editor.org/rfc/rfc9449 (OAuth 2.0 DPoP)
 */
export interface ES256KeyHandle {
  /** Non-extractable (where the platform supports it) ECDSA P-256 private key. */
  readonly privateKey: unknown;
  /** Extractable ECDSA P-256 public key, exported to JWK for the DPoP header. */
  readonly publicKey: unknown;
}

/**
 * Platform-agnostic ES256 signing primitive. Implementations must keep the
 * private key non-extractable where the platform allows it — see
 * {@link createWebCryptoAdapter} for why that property matters for DPoP.
 */
export interface CryptoAdapter {
  /** Generates a fresh, non-extractable-where-possible ES256 key pair. */
  generateEs256KeyPair(): Promise<ES256KeyHandle>;
  /**
   * Exports ONLY the public key as a JWK.
   *
   * @param handle - The key pair to export the public half of.
   * @returns The public key as an EC P-256 JWK (`kty` `EC`, `crv` `P-256`, plus `x`/`y`).
   */
  exportPublicJwk(handle: ES256KeyHandle): Promise<JsonWebKey>;
  /**
   * Signs `data` with the private key, returning the raw IEEE-P1363 r||s
   * signature (64 bytes) — NOT DER. JOSE compact serialization requires r||s,
   * and WebCrypto already produces it; any injected adapter must match.
   *
   * @param handle - The key pair whose private key signs `data`.
   * @param data - The exact bytes to sign (the DPoP JWS signing input).
   * @returns The raw 64-byte r||s signature.
   */
  signEs256(handle: ES256KeyHandle, data: Uint8Array): Promise<Uint8Array>;
  /**
   * Computes a SHA-256 digest, used for DPoP `ath`, fingerprints and the JWK
   * thumbprint.
   *
   * @param data - The bytes to digest.
   * @returns The 32-byte digest.
   */
  sha256(data: Uint8Array): Promise<Uint8Array>;
}

/** Minimal key/value store for the session/refresh tokens and DPoP key material. */
export interface StorageAdapter {
  /**
   * Reads a previously stored value.
   *
   * @param key - The storage key.
   * @returns The stored value, or `null` if `key` was never set.
   */
  get(key: string): Promise<string | null>;
  /**
   * Writes a value, replacing any existing one for `key`.
   *
   * @param key - The storage key.
   * @param value - The value to store.
   */
  set(key: string, value: string): Promise<void>;
  /**
   * Removes a stored value, if present.
   *
   * @param key - The storage key.
   */
  delete(key: string): Promise<void>;
}

/** One HTTP exchange as seen by the protocol layer; status interpretation is the caller's job. */
export interface HttpResponse {
  /** HTTP status code of the response. */
  status: number;
  /** Response headers, keyed by header name as returned by the transport. */
  headers: Record<string, string>;
  /** Raw response body, undecoded. */
  body: string;
}

/** An outbound request the protocol layer hands to the HTTP adapter. */
export interface HttpRequest {
  /** HTTP verb, upper-case (e.g. 'GET', 'POST'). */
  method: string;
  /** Full request URL, including query string. */
  url: string;
  /** Request headers to send. */
  headers: Record<string, string>;
  /** Request body, when the method carries one (e.g. `POST`). */
  body?: string;
}

/** Transport seam: performs one request and resolves the raw response. */
export interface HttpAdapter {
  /**
   * Performs one HTTP request.
   *
   * @param req - The request to send.
   * @returns The raw response; the caller interprets the status.
   */
  request(req: HttpRequest): Promise<HttpResponse>;
}

/**
 * Produces a stable per-install device fingerprint. This is a soft signal (it is
 * spoofable), not a root of trust.
 */
export interface FingerprintAdapter {
  /** Resolves the device fingerprint, computing and caching it on first call. */
  get(): Promise<string>;
}

/** The resolved per-runtime adapter set the protocol/client layers consume. */
export interface Adapters {
  /** ES256 signing primitive backing DPoP proofs. */
  crypto: CryptoAdapter;
  /** Key/value store for session tokens and DPoP key material. */
  storage: StorageAdapter;
  /** Transport used for every API call. */
  http: HttpAdapter;
  /** Device-fingerprint source sent on session-gated requests. */
  fingerprint: FingerprintAdapter;
}
