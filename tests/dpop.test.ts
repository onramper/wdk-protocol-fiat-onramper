import { describe, expect, it } from 'vitest';
import { createWebCryptoAdapter } from '../src/adapters/crypto/webcrypto.ts';
import { buildDpopProof, jwkThumbprint } from '../src/client/dpop.ts';
import { base64UrlToBytes } from '../src/utils/base64url.ts';

const decoder = new TextDecoder();

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(decoder.decode(base64UrlToBytes(segment)));
}

describe('DPoP proof', () => {
  it('produces a verifiable ES256 JWS with the expected claims', async () => {
    const crypto = createWebCryptoAdapter();
    const key = await crypto.generateEs256KeyPair();

    const proof = await buildDpopProof(crypto, key, {
      method: 'get',
      url: 'https://api.stg.onramper.com/v1/supported?foo=bar#frag',
      accessToken: 'at_test',
    });

    const [headerSeg, payloadSeg, sigSeg] = proof.split('.');
    const header = decodeSegment(headerSeg as string);
    const payload = decodeSegment(payloadSeg as string);

    expect(header.typ).toBe('dpop+jwt');
    expect(header.alg).toBe('ES256');
    expect((header.jwk as Record<string, unknown>).crv).toBe('P-256');
    expect((header.jwk as Record<string, unknown>).kty).toBe('EC');
    // htm uppercased, htu stripped of query + fragment.
    expect(payload.htm).toBe('GET');
    expect(payload.htu).toBe('https://api.stg.onramper.com/v1/supported');
    expect(payload.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // ath = base64url(SHA-256('at_test')) — the access-token binding the server enforces.
    expect(payload.ath).toBe('o7NISW7rpXoPt8ttNdRBDEeIaMoETNyPA99WKYZLqXo');
    const nowSec = Math.floor(Date.now() / 1000);
    expect(payload.iat).toBeGreaterThanOrEqual(nowSec - 5);
    expect(payload.iat).toBeLessThanOrEqual(nowSec + 1);

    // The signature must verify against the embedded public JWK.
    const jwk = header.jwk as JsonWebKey;
    const publicKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const signingInput = new TextEncoder().encode(`${headerSeg}.${payloadSeg}`);
    const ok = await globalThis.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      base64UrlToBytes(sigSeg as string),
      signingInput,
    );
    expect(ok).toBe(true);
  });

  it('computes a stable RFC 7638 thumbprint over canonical members', async () => {
    const crypto = createWebCryptoAdapter();
    const tp = await jwkThumbprint(crypto, { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' });
    // RFC 7638 thumbprint over {"crv":"P-256","kty":"EC","x":"AAA","y":"BBB"}; base64url, no '=' or '+'.
    expect(tp).toBe('i1UpPK86aAbPsZ4k7q-iPFEaeHZoKHij5aFPKk8XWTM');
  });

  it('omits the ath claim when no access token is supplied', async () => {
    const crypto = createWebCryptoAdapter();
    const key = await crypto.generateEs256KeyPair();
    const proof = await buildDpopProof(crypto, key, { method: 'get', url: 'https://api.stg.onramper.com/x' });
    const payload = decodeSegment(proof.split('.')[1] as string);
    expect(payload.ath).toBeUndefined();
  });
});
