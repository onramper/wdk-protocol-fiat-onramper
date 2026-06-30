import { describe, expect, it } from 'vitest';
import { OnramperErrorCode } from '../src/errors/codes.ts';
import { OnramperError } from '../src/errors/errors.ts';
import { OnramperFiatProtocol } from '../src/index.ts';
import type { SignUrlParams } from '../src/types/onramper.ts';
import { decodeProofPayload } from './dpop-helpers.ts';
import { baseConfig, json, mockHttp, supportedRoute, tokenRoute } from './helpers.ts';

/** Raw (possibly non-JSON) response, for malformed-body tests. */
const raw = (status: number, body: string, headers: Record<string, string> = {}) => ({ status, headers, body });
const txOk = {
  match: '/checkout/session/',
  handler: () =>
    json(200, { valid: true, transactionInformation: { transactionId: 'tx_1', status: 'pending', onramp: 'p-a' } }),
};
const proto = (over = {}) => new OnramperFiatProtocol(undefined, baseConfig(over));

describe('decode errors — a 2xx body that is not JSON surfaces DECODE_ERROR, never a raw SyntaxError', () => {
  it('getWithApiKey (supported) on a malformed 200 body', async () => {
    const http = mockHttp([{ match: '/supported', handler: () => raw(200, '<html>gateway</html>') }]);
    await expect(
      new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).getSupportedCryptoAssets(),
    ).rejects.toMatchObject({ code: OnramperErrorCode.DECODE_ERROR });
  });

  it('getWithSession (transaction) on a malformed 200 body', async () => {
    const http = mockHttp([tokenRoute, { match: '/checkout/session/', handler: () => raw(200, 'not json {') }]);
    await expect(
      new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).getTransactionDetail('s'),
    ).rejects.toMatchObject({ code: OnramperErrorCode.DECODE_ERROR });
  });

  it('token exchange on a malformed 200 body', async () => {
    const http = mockHttp([{ match: 'client-sessions/tokens', handler: () => raw(200, '{truncated') }, txOk]);
    await expect(
      new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).getTransactionDetail('s'),
    ).rejects.toMatchObject({ code: OnramperErrorCode.DECODE_ERROR });
  });
});

describe('HTTP error mapping — every failure surfaces a typed OnramperError', () => {
  it('5xx on a public-data call → upstream_error (empty body)', async () => {
    const http = mockHttp([{ match: '/supported', handler: () => raw(500, '') }]);
    await expect(
      new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).getSupportedFiatCurrencies(),
    ).rejects.toMatchObject({ code: OnramperErrorCode.UPSTREAM_ERROR, httpStatus: 500 });
  });

  it('quotes 503 → upstream_error', async () => {
    const http = mockHttp([supportedRoute, { match: '/quotes/', handler: () => raw(503, 'Service Unavailable') }]);
    await expect(
      new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() })).quoteBuy({
        fiatCurrency: 'eur',
        cryptoAsset: 'btc',
        fiatAmount: 100_00n,
      }),
    ).rejects.toMatchObject({ code: OnramperErrorCode.UPSTREAM_ERROR });
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
    ).rejects.toMatchObject({ code: OnramperErrorCode.INVALID_SDK_SESSION });
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
    ).rejects.toMatchObject({ code: OnramperErrorCode.UPSTREAM_ERROR });
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
    await expect(p.getTransactionDetail('s')).rejects.toMatchObject({ code: OnramperErrorCode.UPSTREAM_ERROR });
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
    await expect(p.getTransactionDetail('s')).rejects.toMatchObject({ code: OnramperErrorCode.DECODE_ERROR });
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
    ).rejects.toMatchObject({ code: OnramperErrorCode.QUOTE_UNAVAILABLE });
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
    ).rejects.toMatchObject({ code: OnramperErrorCode.QUOTE_UNAVAILABLE });
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
    ).rejects.toMatchObject({ code: OnramperErrorCode.QUOTE_UNAVAILABLE });
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
    ).rejects.toMatchObject({ code: OnramperErrorCode.UPSTREAM_ERROR, cause: boom });
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
