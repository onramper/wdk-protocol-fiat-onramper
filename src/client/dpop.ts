import type { CryptoAdapter, Es256KeyHandle } from '../adapters/types.ts';
import { bytesToBase64Url, jsonToBase64Url } from '../utils/base64url.ts';
import { randomId } from '../utils/random.ts';

/** The minimal EC public JWK carried in a DPoP header (RFC 9449 / RFC 7517). */
interface EcPublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

/**
 * Normalise an exported JWK to exactly the members a DPoP header may carry.
 * WebCrypto adds `ext`/`key_ops`; including them would change the RFC 7638
 * thumbprint and break the `cnf.jkt` match the server enforces.
 */
function toEcPublicJwk(jwk: JsonWebKey): EcPublicJwk {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw new Error('DPoP requires an EC P-256 public JWK');
  }
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

/**
 * RFC 7638 JWK thumbprint: SHA-256 over the canonical JSON of the required EC
 * members in lexicographic key order (`crv,kty,x,y`), base64url-encoded. Must
 * equal the access token's `cnf.jkt` for the server to accept the proof.
 */
export async function jwkThumbprint(crypto: CryptoAdapter, jwk: EcPublicJwk): Promise<string> {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}","y":"${jwk.y}"}`;
  const digest = await crypto.sha256(new TextEncoder().encode(canonical));
  return bytesToBase64Url(digest);
}

export interface DpopProofInput {
  /** HTTP method, uppercased (the `htm` claim). */
  method: string;
  /** Full request URL without query/fragment (the `htu` claim). */
  url: string;
  /** Present once an access token exists, to bind the proof to it via `ath`. */
  accessToken?: string;
  /** Server-supplied DPoP nonce, echoed back when the server demands one. */
  nonce?: string;
}

/**
 * Build a DPoP proof JWS (compact ES256). Each call produces a fresh `jti` and
 * `iat`, so proofs are single-use and replay-checked server-side. Mirrors the
 * iOS SDK's `the proof builder`.
 */
export async function buildDpopProof(
  crypto: CryptoAdapter,
  key: Es256KeyHandle,
  input: DpopProofInput,
): Promise<string> {
  const jwk = toEcPublicJwk(await crypto.exportPublicJwk(key));
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk };

  const payload: Record<string, unknown> = {
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

/** Drop query and fragment — `htu` is compared against the bare endpoint. */
function stripUrl(url: string): string {
  const hashIndex = url.indexOf('#');
  const noHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = noHash.indexOf('?');
  return queryIndex === -1 ? noHash : noHash.slice(0, queryIndex);
}
