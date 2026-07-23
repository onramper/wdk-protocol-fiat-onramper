import { describe, expect, it } from 'vitest';
import { OnramperFiatProtocol } from '../src/index.ts';
import type { FiatTransactionStatus } from '../src/types/wdk.ts';
import { decodeProofPayload } from './dpop-helpers.ts';
import { baseConfig, json, mockHttp, supportedRoute, tokenRoute } from './helpers.ts';

const txRoute = {
  match: '/checkout/session/',
  handler: () =>
    json(200, {
      valid: true,
      transactionInformation: { transactionId: 'tx_1', status: 'pending', onramp: 'provider-a' },
    }),
};

describe('happy paths not covered by the conformance suite', () => {
  it('quoteSell() hits /quotes/{crypto}/{fiat}?type=sell and maps the best quote', async () => {
    // sell flips source/destination vs buy: source = crypto, destination = fiat.
    const http = mockHttp([
      supportedRoute,
      {
        match: '/quotes/eth/usd',
        handler: () => json(200, [{ rate: 3000, payout: 300, ramp: 'provider-b', paymentMethod: 'sepa' }]),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    const quote = await proto.quoteSell({
      fiatCurrency: 'usd',
      cryptoAsset: 'eth',
      cryptoAmount: 100_000_000_000_000_000n, // 0.1 ETH
    });

    expect(quote).toEqual({
      cryptoAmount: 100_000_000_000_000_000n, // exact, echoed from the request
      fiatAmount: 30_000n, // 300 USD payout at 2 decimals
      fee: 0n,
      rate: '3000',
      metadata: { provider: 'provider-b', paymentMethod: 'sepa' },
    });
    const call = http.calls.find((c) => c.url.includes('/quotes/eth/usd'));
    expect(call?.url).toBe('https://api-stg.onramper.com/quotes/eth/usd?type=sell&amount=0.1');
    expect(call?.headers.Authorization).toBe('pk_test_abc123');
    expect(call?.headers['X-Onramper-DPoP']).toBeUndefined(); // public data path, no envelope
  });

  it('getSupportedFiatCurrencies() maps the fiat list from the {message} envelope', async () => {
    const http = mockHttp([
      {
        match: '/supported',
        handler: () =>
          json(200, {
            message: {
              crypto: [{ code: 'eth', network: 'ethereum', decimals: 18, name: 'Ethereum' }],
              fiat: [
                { code: 'eur', decimals: 2, name: 'Euro' },
                { code: 'gbp', decimals: 2, name: 'British Pound' },
              ],
            },
          }),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    const fiats = await proto.getSupportedFiatCurrencies();

    expect(fiats).toEqual([
      { code: 'eur', decimals: 2, name: 'Euro' },
      { code: 'gbp', decimals: 2, name: 'British Pound' },
    ]);
  });

  it('a valid access token is reused — a second session-gated call does not re-exchange', async () => {
    let mints = 0;
    const http = mockHttp([
      {
        match: 'client-sessions/tokens',
        handler: () => {
          mints += 1;
          return json(200, { access_token: 'at', refresh_token: 'rt', expires_in: 900, tier: 1 });
        },
      },
      txRoute,
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    await proto.getTransactionDetail('a');
    await proto.getTransactionDetail('b'); // sequential — the cached, unexpired token is reused

    expect(mints).toBe(1);
  });

  it('the authenticated session call binds its DPoP proof to the exact request URL + access token', async () => {
    const http = mockHttp([tokenRoute, txRoute]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    await proto.getTransactionDetail('sess_abc');

    const txCall = http.calls.find((c) => c.url.includes('/checkout/session/'));
    expect(txCall?.url).toBe('https://api-stg.onramper.com/checkout/session/sess_abc/transaction');
    const dpop = txCall?.headers['X-Onramper-DPoP'] as string;
    expect(dpop.split('.')).toHaveLength(3); // compact JWS: header.payload.signature
    const proof = decodeProofPayload(dpop);
    expect(proof.htm).toBe('GET');
    expect(proof.htu).toBe('https://api-stg.onramper.com/checkout/session/sess_abc/transaction');
    // ath = base64url(SHA-256('at_test_token')) — binds the proof to the minted access token.
    expect(proof.ath).toBe('-mGyOiFTbLojM09saeg6_QOXFhzLaQ0UA7GFOYBxzGs');
    expect(txCall?.headers['X-Onramper-SDK-Session']).toBe('Bearer at_test_token');
  });

  describe('environment -> base URL selection', () => {
    const supportedHandler = {
      match: '/supported',
      handler: () => json(200, { message: { crypto: [], fiat: [] } }),
    };
    const signUrl = async () => 'https://signed.example';

    it('defaults to production when environment is omitted', async () => {
      const http = mockHttp([supportedHandler]);
      const proto = new OnramperFiatProtocol(undefined, {
        apiKey: 'pk_test_abc123',
        signUrl,
        adapters: http.adapters(),
      });
      await proto.getSupportedCryptoAssets();
      expect(http.calls.find((c) => c.url.includes('/supported'))?.url).toBe('https://api.onramper.com/supported');
    });

    it('uses the staging host for environment "staging"', async () => {
      const http = mockHttp([supportedHandler]);
      const proto = new OnramperFiatProtocol(undefined, {
        apiKey: 'pk_test_abc123',
        signUrl,
        environment: 'staging',
        adapters: http.adapters(),
      });
      await proto.getSupportedCryptoAssets();
      expect(http.calls.find((c) => c.url.includes('/supported'))?.url).toBe('https://api-stg.onramper.com/supported');
    });

    it('honours an explicit baseUrl override', async () => {
      const http = mockHttp([supportedHandler]);
      const proto = new OnramperFiatProtocol(undefined, {
        apiKey: 'pk_test_abc123',
        signUrl,
        baseUrl: 'https://custom.example.com',
        adapters: http.adapters(),
      });
      await proto.getSupportedCryptoAssets();
      expect(http.calls.find((c) => c.url.includes('/supported'))?.url).toBe('https://custom.example.com/supported');
    });
  });

  describe('getTransactionDetail() status normalisation', () => {
    // Provider statuses collapse onto the WDK three-state vocabulary.
    const cases: Array<[string, FiatTransactionStatus]> = [
      ['success', 'completed'],
      ['paid', 'completed'],
      ['completed', 'completed'],
      ['declined', 'failed'],
      ['cancelled', 'failed'],
      ['canceled', 'failed'],
      ['failed', 'failed'],
      ['expired', 'failed'], // terminal: a lapsed ramp never completes
      ['in_progress', 'in_progress'],
      ['processing', 'in_progress'],
      ['pending', 'in_progress'],
      ['new', 'in_progress'],
      ['created', 'in_progress'],
      ['weird_state', 'in_progress'], // unknown defaults to in_progress
    ];

    it.each(cases)('maps provider status %s -> %s', async (rawStatus, expected) => {
      const http = mockHttp([
        tokenRoute,
        {
          match: '/checkout/session/',
          handler: () =>
            json(200, {
              valid: true,
              transactionInformation: { transactionId: 'tx_1', status: rawStatus, onramp: 'p' },
            }),
        },
      ]);
      const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
      const detail = await proto.getTransactionDetail('s');
      expect(detail.status).toBe(expected);
    });
  });

  describe('quote selection and mapping', () => {
    it('skips errored entries and maps the first priced quote with all fee fields', async () => {
      const http = mockHttp([
        supportedRoute,
        {
          match: '/quotes/usd/eth',
          handler: () =>
            json(200, [
              { ramp: 'bad', errors: [{ errorId: 1 }] },
              {
                rate: 2000,
                payout: 0.05,
                ramp: 'provider-b',
                networkFee: 1,
                transactionFee: 2,
                quoteId: 'q9',
                paymentMethod: 'creditcard',
              },
            ]),
        },
      ]);
      const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
      const quote = await proto.quoteBuy({ fiatCurrency: 'usd', cryptoAsset: 'eth', fiatAmount: 100_00n });
      expect(quote).toEqual({
        fiatAmount: 100_00n,
        cryptoAmount: 50_000_000_000_000_000n, // 0.05 ETH
        fee: 300n, // (1 + 2) USD * 100
        rate: '2000',
        metadata: {
          provider: 'provider-b',
          quoteId: 'q9',
          paymentMethod: 'creditcard',
          networkFee: '1',
          transactionFee: '2',
        },
      });
    });

    it('reads the alternative {quotes:[...]} wrapper shape', async () => {
      const http = mockHttp([
        supportedRoute,
        { match: '/quotes/usd/eth', handler: () => json(200, { quotes: [{ rate: 1000, payout: 0.01, ramp: 'p' }] }) },
      ]);
      const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
      const quote = await proto.quoteBuy({ fiatCurrency: 'usd', cryptoAsset: 'eth', fiatAmount: 100_00n });
      expect(quote.metadata.provider).toBe('p');
      expect(quote.rate).toBe('1000');
      expect(quote.cryptoAmount).toBe(10_000_000_000_000_000n); // 0.01 ETH
    });

    it('echoes payout into fiatAmount for sell', async () => {
      const http = mockHttp([
        supportedRoute,
        { match: '/quotes/eth/usd', handler: () => json(200, [{ rate: 3000, payout: 250, ramp: 'provider-b' }]) },
      ]);
      const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
      const quote = await proto.quoteSell({
        fiatCurrency: 'usd',
        cryptoAsset: 'eth',
        cryptoAmount: 80_000_000_000_000_000n, // 0.08 ETH
      });
      expect(quote.fiatAmount).toBe(25_000n); // 250 USD
      expect(quote.cryptoAmount).toBe(80_000_000_000_000_000n);
    });
  });

  describe('getTransactionDetail() field mapping', () => {
    it('maps populated fields onto status/asset/currency + metadata, honouring the ramp alias', async () => {
      const http = mockHttp([
        tokenRoute,
        {
          match: '/checkout/session/',
          handler: () =>
            json(200, {
              valid: true,
              transactionInformation: {
                transactionId: 'tx_1',
                status: 'completed',
                crypto: 'eth',
                fiat: 'usd',
                fiatAmount: 100,
                cryptoAmount: 0.033,
                txHash: '0xdead',
                ramp: 'provider-b',
              },
            }),
        },
      ]);
      const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
      const detail = await proto.getTransactionDetail('s');
      expect(detail).toEqual({
        status: 'completed',
        cryptoAsset: 'eth',
        fiatCurrency: 'usd',
        metadata: {
          status: 'completed',
          fiatAmount: '100',
          cryptoAmount: '0.033',
          txHash: '0xdead',
          provider: 'provider-b',
        },
      });
    });

    it('falls back to the bare record when the transactionInformation envelope is absent', async () => {
      const http = mockHttp([
        tokenRoute,
        {
          match: '/checkout/session/',
          handler: () => json(200, { transactionId: 'tx_1', status: 'pending', onramp: 'p' }),
        },
      ]);
      const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
      const detail = await proto.getTransactionDetail('s');
      expect(detail).toEqual({
        status: 'in_progress',
        cryptoAsset: '',
        fiatCurrency: '',
        metadata: { status: 'pending', provider: 'p' },
      });
    });
  });

  it('maps an unwrapped supported payload with default decimals and id/name fallbacks', async () => {
    const http = mockHttp([
      {
        match: '/supported',
        handler: () => json(200, { crypto: [{ id: 'btc', network: 'bitcoin' }], fiat: [{ id: 'eur' }] }),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    expect(await proto.getSupportedCryptoAssets()).toEqual([
      { code: 'btc', networkCode: 'bitcoin', decimals: 18, name: 'btc' },
    ]);
    expect(await proto.getSupportedFiatCurrencies()).toEqual([{ code: 'eur', decimals: 2, name: 'eur' }]);
  });
});
