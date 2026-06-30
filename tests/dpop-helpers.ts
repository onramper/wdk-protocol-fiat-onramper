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
