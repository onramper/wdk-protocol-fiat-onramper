import { describe, expect, it } from 'vitest';
import { OnramperError, OnramperErrorCode } from '../src/errors.ts';
import { OnramperFiatProtocol } from '../src/index.ts';
import type { SignUrlParams } from '../src/types/onramper.ts';
import { decodeProofHeader, decodeProofPayload, ecJwkThumbprint, verifyProofSignature } from './dpop-helpers.ts';
import { baseConfig, json, mockHttp, supportedRoute, tokenRoute } from './helpers.ts';

/** Raw (possibly non-JSON) response, for malformed-body tests. */
const raw = (status: number, body: string, headers: Record<string, string> = {}) => ({ status, headers, body });
const txOk = {
  match: '/checkout/session/',
  handler: () =>
    json(200, { valid: true, transactionInformation: { transactionId: 'tx_1', status: 'pending', onramp: 'p-a' } }),
};
const proto = (over = {}) => new OnramperFiatProtocol(undefined, baseConfig(over));
/** A copy-paste bug setting the wrong message on the right code must fail a test — assert both. */
const reject = (code: OnramperErrorCode, messageMatch: RegExp) => ({
  code,
  message: expect.stringMatching(messageMatch),
});

describe('decode errors — a 2xx body that is not JSON surfaces DECODE_ERROR, never a raw SyntaxError', () => {
  it('getWithApiKey (supported) on a malformed 200 body', async () => {
    const http = mockHttp([{ match: '/supported', handler: () => raw(200, '<html>gateway</html>') }]);
    await expect(
      new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).getSupportedCryptoAssets(),
    ).rejects.toMatchObject(reject(OnramperErrorCode.DECODE_ERROR, /Failed to decode response body/));
  });

  it('getWithSession (transaction) on a malformed 200 body', async () => {
    const http = mockHttp([tokenRoute, { match: '/checkout/session/', handler: () => raw(200, 'not json {') }]);
    await expect(
      new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).getTransactionDetail('s'),
    ).rejects.toMatchObject(reject(OnramperErrorCode.DECODE_ERROR, /Failed to decode response body/));
  });

  it('token exchange on a malformed 200 body', async () => {
    const http = mockHttp([{ match: 'client-sessions/tokens', handler: () => raw(200, '{truncated') }, txOk]);
    await expect(
      new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).getTransactionDetail('s'),
    ).rejects.toMatchObject(reject(OnramperErrorCode.DECODE_ERROR, /Failed to decode response body/));
  });
});

describe('HTTP error mapping — every failure surfaces a typed OnramperError', () => {
  it('5xx on a public-data call → upstream_error (empty body)', async () => {
    const http = mockHttp([{ match: '/supported', handler: () => raw(500, '') }]);
    await expect(
      new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).getSupportedFiatCurrencies(),
    ).rejects.toMatchObject({
      ...reject(OnramperErrorCode.UPSTREAM_ERROR, /Request failed with status 500/),
      httpStatus: 500,
    });
  });

  it('quotes 503 → upstream_error', async () => {
    const http = mockHttp([supportedRoute, { match: '/quotes/', handler: () => raw(503, 'Service Unavailable') }]);
    await expect(
      new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).quoteBuy({
        fiatCurrency: 'eur',
        cryptoAsset: 'btc',
        fiatAmount: 100_00n,
      }),
    ).rejects.toMatchObject(reject(OnramperErrorCode.UPSTREAM_ERROR, /Request failed with status 503/));
  });

  it('transaction 401 INVALID_SDK_SESSION → refresh once, then the retried call succeeds', async () => {
    let txCalls = 0;
    const http = mockHttp([
      tokenRoute,
      {
        match: '/checkout/session/',
        handler: () => {
          txCalls += 1;
          return txCalls === 1
            ? json(401, { errorCode: 40102, errorMessage: 'session expired' })
            : json(200, {
                valid: true,
                transactionInformation: { transactionId: 'tx_1', status: 'completed', onramp: 'p' },
              });
        },
      },
    ]);
    const detail = await new OnramperFiatProtocol(
      undefined,
      baseConfig({ adapters: http.adapters() }),
    ).getTransactionDetail('s');
    expect(detail).toEqual({
      status: 'completed',
      cryptoAsset: '',
      fiatCurrency: '',
      metadata: { status: 'completed', provider: 'p' },
    });
    expect(txCalls).toBe(2); // exactly one retry
  });

  it('transaction keeps 401-ing with a session error → gives up after one retry (no infinite loop)', async () => {
    let txCalls = 0;
    const http = mockHttp([
      tokenRoute,
      {
        match: '/checkout/session/',
        handler: () => {
          txCalls += 1;
          return json(401, { errorCode: 40102, errorMessage: 'expired' });
        },
      },
    ]);
    await expect(
      new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).getTransactionDetail('s'),
    ).rejects.toMatchObject(reject(OnramperErrorCode.INVALID_SDK_SESSION, /expired/));
    expect(txCalls).toBe(2); // initial + one refresh retry, then stop
  });
});

describe('session bootstrap — getSessionToken callback failures stay typed', () => {
  it('a raw throw is wrapped as upstream_error and preserves the cause', async () => {
    const cause = new Error('network down');
    const http = mockHttp([txOk]);
    try {
      await new OnramperFiatProtocol(
        undefined,
        baseConfig({
          adapters: http.adapters(),
          getSessionToken: async () => {
            throw cause;
          },
        }),
      ).getTransactionDetail('s');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(OnramperError);
      expect((e as OnramperError).code).toBe(OnramperErrorCode.UPSTREAM_ERROR);
      expect((e as OnramperError).message).toMatch(/getSessionToken callback failed/);
      expect((e as OnramperError).cause).toBe(cause);
    }
  });

  it('an OnramperError thrown by the callback passes through unchanged', async () => {
    const original = new OnramperError(OnramperErrorCode.INVALID_CONFIG, 'partner backend said no');
    const http = mockHttp([txOk]);
    await expect(
      new OnramperFiatProtocol(
        undefined,
        baseConfig({
          adapters: http.adapters(),
          getSessionToken: async () => {
            throw original;
          },
        }),
      ).getTransactionDetail('s'),
    ).rejects.toBe(original);
  });
});

describe('token lifecycle', () => {
  it('refresh failure falls back to a fresh bootstrap', async () => {
    let mint = 0;
    let refused = false;
    const http = mockHttp([
      {
        match: 'client-sessions/tokens',
        handler: (req) => {
          const grant = JSON.parse(req.body ?? '{}').grant_type;
          if (grant === 'refresh_token') {
            refused = true;
            return json(400, { error: 'invalid_grant' });
          }
          mint += 1;
          // First bootstrap mints an already-expired token to force the refresh path next.
          return json(200, {
            access_token: `at_${mint}`,
            refresh_token: 'rt',
            expires_in: mint === 1 ? -1 : 900,
            tier: 1,
          });
        },
      },
      txOk,
    ]);
    const p = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
    await p.getTransactionDetail('s'); // bootstrap (expired)
    await p.getTransactionDetail('s'); // refresh refused → re-bootstrap
    expect(refused).toBe(true);
    expect(mint).toBe(2); // bootstrapped twice (initial + after refresh failure)
  });

  it('DPoP nonce challenge → retry once echoing the server nonce', async () => {
    let calls = 0;
    const http = mockHttp([
      {
        match: 'client-sessions/tokens',
        handler: () => {
          calls += 1;
          return calls === 1
            ? raw(400, JSON.stringify({ error: 'use_dpop_nonce' }), { 'dpop-nonce': 'srv-nonce-xyz' })
            : json(200, { access_token: 'at', refresh_token: 'rt', expires_in: 900, tier: 1 });
        },
      },
      txOk,
    ]);
    await new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).getTransactionDetail('s');
    expect(calls).toBe(2);
    const second = http.calls.filter((c) => c.url.includes('client-sessions/tokens'))[1];
    expect(decodeProofPayload(second.headers['X-Onramper-DPoP'] as string).nonce).toBe('srv-nonce-xyz');
  });

  it('DPoP nonce challenge is recognised regardless of header casing', async () => {
    // Casing not covered by a hardcoded 'dpop-nonce' / 'DPoP-Nonce' check —
    // guards the case-insensitive scan in readDpopNonce against regression.
    let calls = 0;
    const http = mockHttp([
      {
        match: 'client-sessions/tokens',
        handler: () => {
          calls += 1;
          return calls === 1
            ? raw(400, JSON.stringify({ error: 'use_dpop_nonce' }), { 'DPOP-NONCE': 'srv-nonce-upper' })
            : json(200, { access_token: 'at', refresh_token: 'rt', expires_in: 900, tier: 1 });
        },
      },
      txOk,
    ]);
    await new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).getTransactionDetail('s');
    expect(calls).toBe(2);
    const second = http.calls.filter((c) => c.url.includes('client-sessions/tokens'))[1];
    expect(decodeProofPayload(second.headers['X-Onramper-DPoP'] as string).nonce).toBe('srv-nonce-upper');
  });

  it('DPoP proofs are well-formed ES256 JWS, bind ath only once an access token exists, and reuse one key per session', async () => {
    const http = mockHttp([tokenRoute, txOk]);
    const p = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
    await p.getTransactionDetail('s1');
    await p.getTransactionDetail('s2');

    const mintCall = http.calls.find((c) => c.url.includes('client-sessions/tokens'));
    const txCalls = http.calls.filter((c) => c.url.includes('/checkout/session/'));
    const mintProof = mintCall?.headers['X-Onramper-DPoP'] as string;
    const txProofs = txCalls.map((c) => c.headers['X-Onramper-DPoP'] as string);
    const jtiPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    for (const [i, proof] of [mintProof, ...txProofs].entries()) {
      const header = decodeProofHeader(proof);
      const payload = decodeProofPayload(proof);
      const call = [mintCall, ...txCalls][i];
      expect(header.typ).toBe('dpop+jwt');
      expect(header.alg).toBe('ES256');
      expect((header.jwk as { kty: string }).kty).toBe('EC');
      expect((header.jwk as { crv: string }).crv).toBe('P-256');
      await expect(verifyProofSignature(proof)).resolves.toBe(true);

      // htm is the uppercased request method; htu is the request URL with no
      // query/fragment — both must match the call the SDK actually issued.
      expect(payload.htm).toBe(call?.method);
      expect(payload.htu).toBe(call?.url);
      expect(payload.jti).toMatch(jtiPattern);
      const nowSec = Math.floor(Date.now() / 1000);
      expect(payload.iat).toBeGreaterThanOrEqual(nowSec - 5);
      expect(payload.iat).toBeLessThanOrEqual(nowSec + 1);
    }

    // The bootstrap mint has no access token yet; the session-gated calls do.
    expect(decodeProofPayload(mintProof).ath).toBeUndefined();
    // ath = base64url(SHA-256(access_token)); 'at_test_token' is the fixed
    // fixture token minted by tokenRoute, so this hash is a known constant.
    for (const proof of txProofs) {
      expect(decodeProofPayload(proof).ath).toBe('-mGyOiFTbLojM09saeg6_QOXFhzLaQ0UA7GFOYBxzGs');
    }

    // Same DPoP key (cnf.jkt binding) reused across calls in one protocol instance,
    // verified by an independently computed RFC 7638 thumbprint, not just raw x/y equality.
    const [first, second] = await Promise.all(
      txProofs.map((p) =>
        ecJwkThumbprint(decodeProofHeader(p).jwk as { crv: string; kty: string; x: string; y: string }),
      ),
    );
    expect(first).toBe(second);
  });

  it('a raw network throw during the token exchange surfaces as OnramperError', async () => {
    const http = mockHttp([
      {
        match: 'client-sessions/tokens',
        handler: () => {
          throw new Error('ECONNRESET');
        },
      },
      txOk,
    ]);
    await expect(
      new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).getTransactionDetail('s'),
    ).rejects.toMatchObject(reject(OnramperErrorCode.UPSTREAM_ERROR, /Failed to obtain access token/));
  });

  it('a raw failure during refresh surfaces as OnramperError, not a native throw', async () => {
    let mint = 0;
    const http = mockHttp([
      {
        match: 'client-sessions/tokens',
        handler: (req) => {
          if (JSON.parse(req.body ?? '{}').grant_type === 'refresh_token') {
            throw new Error('socket hang up');
          }
          mint += 1;
          return json(200, { access_token: 'at', refresh_token: 'rt', expires_in: -1, tier: 1 });
        },
      },
      txOk,
    ]);
    const p = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
    await p.getTransactionDetail('s'); // bootstrap mints an already-expired token
    await expect(p.getTransactionDetail('s')).rejects.toMatchObject(
      reject(OnramperErrorCode.UPSTREAM_ERROR, /Failed to obtain access token/),
    );
    expect(mint).toBe(1); // refresh failed raw → not re-bootstrapped (session preserved)
  });

  it('a malformed refresh response surfaces DECODE_ERROR, not a silent re-bootstrap', async () => {
    let mint = 0;
    const http = mockHttp([
      {
        match: 'client-sessions/tokens',
        handler: (req) => {
          if (JSON.parse(req.body ?? '{}').grant_type === 'refresh_token') {
            return raw(200, '{bad json');
          }
          mint += 1;
          return json(200, { access_token: 'at', refresh_token: 'rt', expires_in: -1, tier: 1 });
        },
      },
      txOk,
    ]);
    const p = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
    await p.getTransactionDetail('s'); // bootstrap mints an already-expired token
    await expect(p.getTransactionDetail('s')).rejects.toMatchObject(
      reject(OnramperErrorCode.DECODE_ERROR, /Failed to decode response body/),
    );
    expect(mint).toBe(1); // surfaced, NOT masked by a re-bootstrap
  });

  it('concurrent callers coalesce into a single token exchange (single-flight)', async () => {
    let mints = 0;
    const http = mockHttp([
      {
        match: 'client-sessions/tokens',
        handler: () => {
          mints += 1;
          return json(200, { access_token: 'at', refresh_token: 'rt', expires_in: 900, tier: 1 });
        },
      },
      txOk,
    ]);
    const p = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
    await Promise.all([p.getTransactionDetail('a'), p.getTransactionDetail('b'), p.getTransactionDetail('c')]);
    expect(mints).toBe(1);
  });
});

describe('quote selection requires a priced entry', () => {
  it('an error-free entry without a rate is treated as no-quote', async () => {
    const http = mockHttp([
      supportedRoute,
      { match: '/quotes/', handler: () => json(200, [{ ramp: 'p', paymentMethod: 'creditcard', quoteId: 'q1' }]) },
    ]);
    await expect(
      new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).quoteBuy({
        fiatCurrency: 'usd',
        cryptoAsset: 'eth',
        fiatAmount: 100_00n,
      }),
    ).rejects.toMatchObject(reject(OnramperErrorCode.QUOTE_UNAVAILABLE, /No quote available/));
  });

  it('a null rate is not treated as priced', async () => {
    const http = mockHttp([
      supportedRoute,
      { match: '/quotes/', handler: () => json(200, [{ ramp: 'p', rate: null, paymentMethod: 'creditcard' }]) },
    ]);
    await expect(
      new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).quoteBuy({
        fiatCurrency: 'usd',
        cryptoAsset: 'eth',
        fiatAmount: 100_00n,
      }),
    ).rejects.toMatchObject(reject(OnramperErrorCode.QUOTE_UNAVAILABLE, /No quote available/));
  });

  it('all entries errored → quote_unavailable', async () => {
    const http = mockHttp([
      supportedRoute,
      { match: '/quotes/', handler: () => json(200, [{ ramp: 'p', errors: [{ errorId: 6200 }] }]) },
    ]);
    await expect(
      new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).quoteSell({
        fiatCurrency: 'usd',
        cryptoAsset: 'eth',
        cryptoAmount: 1_000_000_000_000_000_000n, // 1 ETH
      }),
    ).rejects.toMatchObject(reject(OnramperErrorCode.QUOTE_UNAVAILABLE, /No quote available/));
  });
});

describe('signed-URL builders', () => {
  it('buy() forwards the full widget params to the signUrl callback', async () => {
    let seen: SignUrlParams | undefined;
    const http = mockHttp([supportedRoute]);
    const p = proto({
      adapters: http.adapters(),
      signUrl: async (params) => {
        seen = params;
        return 'https://x';
      },
    });
    const result = await p.buy({
      fiatCurrency: 'usd',
      cryptoAsset: 'eth',
      fiatAmount: 100_00n,
      recipient: '0xabc',
      config: { quoteId: 'q-42' },
    });
    expect(result).toEqual({ buyUrl: 'https://x' });
    expect(seen).toEqual({
      direction: 'buy',
      apiKey: 'pk_test_abc123',
      fiatCurrency: 'usd',
      cryptoAsset: 'eth',
      networkCode: undefined,
      fiatAmount: '100', // 10000 minor units → "100"
      cryptoAmount: undefined,
      address: '0xabc',
      memo: undefined,
      paymentMethod: undefined,
      country: undefined,
      quoteId: 'q-42',
    });
  });

  it('sell() forwards the full widget params (refundAddress -> address) to the signUrl callback', async () => {
    let seen: SignUrlParams | undefined;
    const http = mockHttp([supportedRoute]);
    const p = proto({
      adapters: http.adapters(),
      signUrl: async (params) => {
        seen = params;
        return 'https://x';
      },
    });
    const result = await p.sell({
      fiatCurrency: 'usd',
      cryptoAsset: 'eth',
      cryptoAmount: 500_000_000_000_000_000n, // 0.5 ETH
      refundAddress: '0xdef',
      config: { networkCode: 'ethereum', memo: 'm1', paymentMethod: 'sepa', country: 'US', quoteId: 'q1' },
    });
    expect(result).toEqual({ sellUrl: 'https://x' });
    expect(seen).toEqual({
      direction: 'sell',
      apiKey: 'pk_test_abc123',
      fiatCurrency: 'usd',
      cryptoAsset: 'eth',
      networkCode: 'ethereum',
      fiatAmount: undefined,
      cryptoAmount: '0.5',
      address: '0xdef',
      memo: 'm1',
      paymentMethod: 'sepa',
      country: 'US',
      quoteId: 'q1',
    });
  });

  it('only the active amount side is a key on the signUrl params — the inactive side is absent, not undefined', async () => {
    let seen: SignUrlParams | undefined;
    const http = mockHttp([supportedRoute]);
    const p = proto({
      adapters: http.adapters(),
      signUrl: async (params) => {
        seen = params;
        return 'https://x';
      },
    });
    await p.buy({ fiatCurrency: 'usd', cryptoAsset: 'eth', fiatAmount: 100_00n, recipient: '0xabc' });
    expect('fiatAmount' in (seen as object)).toBe(true);
    expect('cryptoAmount' in (seen as object)).toBe(false);
  });

  it('a raw signUrl rejection is wrapped as a typed OnramperError, preserving the cause', async () => {
    const boom = new Error('sign backend 500');
    const http = mockHttp([supportedRoute]);
    const p = proto({
      adapters: http.adapters(),
      signUrl: async () => {
        throw boom;
      },
    });
    await expect(
      p.sell({ fiatCurrency: 'usd', cryptoAsset: 'btc', cryptoAmount: 10_000_000n, refundAddress: 'bc1' }),
    ).rejects.toMatchObject({
      ...reject(OnramperErrorCode.UPSTREAM_ERROR, /The signUrl callback failed/),
      cause: boom,
    });
  });

  it('an OnramperError thrown by signUrl passes through unchanged', async () => {
    const original = new OnramperError(OnramperErrorCode.INVALID_CONFIG, 'partner refused');
    const http = mockHttp([supportedRoute]);
    const p = proto({
      adapters: http.adapters(),
      signUrl: async () => {
        throw original;
      },
    });
    await expect(
      p.buy({ fiatCurrency: 'usd', cryptoAsset: 'eth', fiatAmount: 100_00n, recipient: '0xabc' }),
    ).rejects.toBe(original);
  });
});
