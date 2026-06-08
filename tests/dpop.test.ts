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
      url: 'https://api.stg.onramper.com/headless/v1/supported?foo=bar#frag',
      accessToken: 'at_test',
    });

    const [headerSeg, payloadSeg, sigSeg] = proof.split('.');
    const header = decodeSegment(headerSeg as string);
    const payload = decodeSegment(payloadSeg as string);

    expect(header.typ).toBe('dpop+jwt');
    expect(header.alg).toBe('ES256');
    expect((header.jwk as Record<string, unknown>).crv).toBe('P-256');
    // htm uppercased, htu stripped of query + fragment.
    expect(payload.htm).toBe('GET');
    expect(payload.htu).toBe('https://api.stg.onramper.com/headless/v1/supported');
    expect(typeof payload.jti).toBe('string');
    expect(typeof payload.ath).toBe('string');

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
    expect(typeof tp).toBe('string');
    expect(tp).not.toContain('=');
    expect(tp).not.toContain('+');
  });
});
