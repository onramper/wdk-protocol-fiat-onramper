/** Decode the payload segment of a DPoP proof (`header.payload.signature`). */
export function decodeProofPayload(proof: string): Record<string, unknown> {
  const payload = proof.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

/** Decode the JWS header segment of a DPoP proof, carrying the embedded public `jwk`. */
export function decodeProofHeader(proof: string): Record<string, unknown> {
  const header = proof.split('.')[0];
  return JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
}

/** Verify a DPoP proof's ECDSA signature against its own embedded public JWK. */
export async function verifyProofSignature(proof: string): Promise<boolean> {
  const [headerSeg, payloadSeg, sigSeg] = proof.split('.');
  const jwk = (decodeProofHeader(proof) as { jwk: JsonWebKey }).jwk;
  const publicKey = await globalThis.crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  return globalThis.crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    Buffer.from(sigSeg as string, 'base64url'),
    new TextEncoder().encode(`${headerSeg}.${payloadSeg}`),
  );
}

/**
 * Independent RFC 7638 thumbprint over an EC JWK's canonical members
 * (lexicographic key order: crv, kty, x, y). Computed locally — not imported
 * from the SDK — so the test verifies the proof's `jwk` is canonical/stable
 * by an outside measure, not by re-running the SDK's own logic on itself.
 */
export async function ecJwkThumbprint(jwk: { crv: string; kty: string; x: string; y: string }): Promise<string> {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Buffer.from(digest).toString('base64url');
}
