import { describe, expect, it } from 'vitest';
import { createNobleCryptoAdapter } from '../src/adapters/crypto/noble.ts';
import { channelForRuntime, detectRuntime, resolveAdapters } from '../src/adapters/index.ts';
import { buildDpopProof } from '../src/client/dpop.ts';
import { decodeProofHeader, ecJwkThumbprint, verifyProofSignature } from './dpop-helpers.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
type EcJwk = { crv: string; kty: string; x: string; y: string };

describe('noble crypto adapter (Bare default)', () => {
  it('exports a bare EC P-256 JWK with only kty/crv/x/y', async () => {
    const noble = createNobleCryptoAdapter();
    const key = await noble.generateEs256KeyPair();
    const jwk = await noble.exportPublicJwk(key);
    // Minimal-JWK hygiene: noble emits only the four EC members, so the public
    // key needs no normalising before DPoP embeds it (WebCrypto adds ext/key_ops
    // that toEcPublicJwk must strip; noble never emits them).
    expect(Object.keys(jwk).sort()).toEqual(['crv', 'kty', 'x', 'y']);
    expect(jwk.kty).toBe('EC');
    expect(jwk.crv).toBe('P-256');
    // A 32-byte coordinate is 43 chars of unpadded base64url.
    expect(jwk.x).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(jwk.y).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('signs P1363 r||s that WebCrypto verifies (byte-compatible with the WebCrypto adapter)', async () => {
    const noble = createNobleCryptoAdapter();
    const key = await noble.generateEs256KeyPair();
    const data = enc('header.payload');
    const sig = await noble.signEs256(key, data);
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(64);

    const jwk = await noble.exportPublicJwk(key);
    const pub = await globalThis.crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'verify',
    ]);
    const ok = await globalThis.crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, data);
    expect(ok).toBe(true);
  });

  it('computes the same SHA-256 digest as WebCrypto (used for ath and the JWK thumbprint)', async () => {
    const noble = createNobleCryptoAdapter();
    const data = enc('onramper');
    const got = await noble.sha256(data);
    const want = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data));
    expect(Buffer.from(got)).toEqual(Buffer.from(want));
  });

  it('builds a DPoP proof that verifies under WebCrypto and reuses a stable RFC 7638 thumbprint', async () => {
    const noble = createNobleCryptoAdapter();
    const key = await noble.generateEs256KeyPair();
    const p1 = await buildDpopProof(noble, key, {
      method: 'GET',
      url: 'https://api-stg.onramper.com/checkout/session/s1',
    });
    const p2 = await buildDpopProof(noble, key, { method: 'POST', url: 'https://api-stg.onramper.com/x' });

    await expect(verifyProofSignature(p1)).resolves.toBe(true);
    await expect(verifyProofSignature(p2)).resolves.toBe(true);

    const [t1, t2] = await Promise.all([p1, p2].map((p) => ecJwkThumbprint(decodeProofHeader(p).jwk as EcJwk)));
    expect(t1).toBe(t2);
  });
});

describe('runtime → crypto adapter wiring', () => {
  it("resolveAdapters('bare') defaults to the pure-JS adapter, not WebCrypto", async () => {
    const adapters = resolveAdapters('bare');
    const key = await adapters.crypto.generateEs256KeyPair();
    // Noble holds the private key as a JS scalar; WebCrypto would hold a CryptoKey.
    expect(key.privateKey).toBeInstanceOf(Uint8Array);
  });

  it('web/Node default to WebCrypto (a non-extractable CryptoKey private key)', async () => {
    const key = await resolveAdapters('node').crypto.generateEs256KeyPair();
    expect(key.privateKey).toBeInstanceOf(CryptoKey);
  });

  it('channelForRuntime reports Bare as wdk-node (server has no bare platform token yet)', () => {
    expect(channelForRuntime('bare')).toBe('wdk-node');
    expect(channelForRuntime('node')).toBe('wdk-node');
    expect(channelForRuntime('web')).toBe('wdk-web');
  });

  it('detectRuntime returns bare when a Bare global is present', () => {
    const g = globalThis as { Bare?: unknown };
    expect(g.Bare).toBeUndefined();
    try {
      g.Bare = { versions: {} };
      expect(detectRuntime()).toBe('bare');
    } finally {
      delete g.Bare;
    }
  });
});
