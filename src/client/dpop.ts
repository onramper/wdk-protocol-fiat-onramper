import type { CryptoAdapter, ES256KeyHandle } from '../adapters/types.ts';
import { OnramperError, OnramperErrorCode } from '../errors.ts';
import { bytesToBase64Url, jsonToBase64Url, randomId } from '../utils/format.ts';

/** The minimal EC public JWK carried in a DPoP header (RFC 9449 / RFC 7517). */
interface EcPublicJwk {
  /** Key type; always `'EC'` for DPoP. */
  kty: 'EC';
  /** Curve; always `'P-256'` for ES256. */
  crv: 'P-256';
  /** Base64url-encoded x-coordinate. */
  x: string;
  /** Base64url-encoded y-coordinate. */
  y: string;
}

/**
 * Normalise an exported JWK to exactly the members a DPoP header may carry.
 * WebCrypto adds `ext`/`key_ops`; including them would change the RFC 7638
 * thumbprint and break the `cnf.jkt` match the server enforces.
 *
 * @param jwk - The JWK exported by a `CryptoAdapter`.
 * @returns The JWK restricted to the EC P-256 members.
 * @throws {OnramperError} `INVALID_CONFIG` when an injected crypto adapter
 *   exports a public key that isn't an EC P-256 JWK.
 */
function toEcPublicJwk(jwk: JsonWebKey): EcPublicJwk {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw new OnramperError(OnramperErrorCode.INVALID_CONFIG, 'DPoP requires an EC P-256 public JWK');
  }
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

/**
 * RFC 7638 JWK thumbprint: SHA-256 over the canonical JSON of the required EC
 * members in lexicographic key order (`crv,kty,x,y`), base64url-encoded. Must
 * equal the access token's `cnf.jkt` for the server to accept the proof.
 *
 * @param crypto - Digest provider used to hash the canonical JSON.
 * @param jwk - The EC P-256 public JWK to fingerprint.
 * @returns The base64url-encoded thumbprint.
 */
export async function jwkThumbprint(crypto: CryptoAdapter, jwk: EcPublicJwk): Promise<string> {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
  const digest = await crypto.sha256(new TextEncoder().encode(canonical));
  return bytesToBase64Url(digest);
}

export interface DpopProofInput {
  /** HTTP method, uppercased (the `htm` claim). */
  method: string;
  /**
   * The request URL, with or without query/fragment — `buildDpopProof` strips
   * both before setting the `htu` claim, since DPoP compares `htu` against the
   * bare endpoint.
   */
  url: string;
  /** Present once an access token exists, to bind the proof to it via `ath`. */
  accessToken?: string;
  /** Server-supplied DPoP nonce, echoed back when the server demands one. */
  nonce?: string;
}

/** The DPoP JWS payload claims (RFC 9449 §4.2). */
interface DpopClaims {
  /** Unique proof identifier, fresh per call, used for server-side replay detection. */
  jti: string;
  /** The bound HTTP method (uppercased). */
  htm: string;
  /** The bound request URL, without query/fragment. */
  htu: string;
  /** Issued-at time, in seconds since the Unix epoch. */
  iat: number;
  /** Access-token binding: base64url(SHA-256(access token)), present once a token exists. */
  ath?: string;
  /** Server-issued nonce, echoed back when the server demands one. */
  nonce?: string;
}

/**
 * Build a DPoP proof JWS (compact ES256). Each call produces a fresh `jti` and
 * `iat`, so proofs are single-use and replay-checked server-side.
 *
 * @param crypto - Signing primitive used for the proof's ES256 signature.
 * @param key - The DPoP key pair; its public JWK is embedded in the header.
 * @param input - The request the proof binds to.
 * @returns The compact-serialized DPoP JWS.
 * @throws {OnramperError} `INVALID_CONFIG` when `crypto.exportPublicJwk` returns
 *   a public key that isn't an EC P-256 JWK.
 */
export async function buildDpopProof(
  crypto: CryptoAdapter,
  key: ES256KeyHandle,
  input: DpopProofInput,
): Promise<string> {
  const jwk = toEcPublicJwk(await crypto.exportPublicJwk(key));
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk };

  const payload: DpopClaims = {
    jti: randomId('jti'),
    htm: input.method.toUpperCase(),
    htu: stripUrl(input.url),
    iat: Math.floor(Date.now() / 1000),
  };
  if (input.accessToken) {
    // `ath` binds the proof to a specific access token (base64url(SHA-256(token))).
    payload.ath = bytesToBase64Url(await crypto.sha256(new TextEncoder().encode(input.accessToken)));
  }
  if (input.nonce) {
    payload.nonce = input.nonce;
  }

  const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`;
  const signature = await crypto.signEs256(key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${bytesToBase64Url(signature)}`;
}

/**
 * Drop query and fragment — `htu` is compared against the bare endpoint.
 *
 * @param url - The full request URL.
 * @returns `url` without its query string or fragment.
 */
function stripUrl(url: string): string {
  const hashIndex = url.indexOf('#');
  const noHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = noHash.indexOf('?');
  return queryIndex === -1 ? noHash : noHash.slice(0, queryIndex);
}
