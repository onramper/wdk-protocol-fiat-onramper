/** Decode the payload segment of a DPoP proof (`header.payload.signature`). */
export function decodeProofPayload(proof: string): Record<string, unknown> {
  const payload = proof.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}
