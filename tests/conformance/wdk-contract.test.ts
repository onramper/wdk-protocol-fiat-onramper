import { describe, expect, it } from 'vitest';
import { OnramperFiatProtocol } from '../../src/index.ts';
import { decodeProofPayload } from '../dpop-helpers.ts';
import { baseConfig, json, mockHttp, supportedRoute, tokenRoute } from '../helpers.ts';

const WDK_METHODS = [
  'quoteBuy',
  'buy',
  'quoteSell',
  'sell',
  'getTransactionDetail',
  'getSupportedCryptoAssets',
  'getSupportedFiatCurrencies',
  'getSupportedCountries',
] as const;

describe('IFiatProtocol contract', () => {
  it('exposes every WDK method', () => {
    const http = mockHttp([tokenRoute]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
    for (const method of WDK_METHODS) {
      expect(typeof (proto as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });

  it('buy() returns a signed widget URL, reading only the public supported list', async () => {
    const http = mockHttp([supportedRoute, tokenRoute]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    const { buyUrl } = await proto.buy({
      fiatCurrency: 'usd',
      cryptoAsset: 'eth',
      fiatAmount: 100_00n, // 100.00 USD in minor units
      recipient: '0xabc',
    });

    expect(buyUrl).toBe('https://buy.stg.onramper.com/?apiKey=pk_test_abc123&mode=buy&asset=eth&address=0xabc');
    // No session bootstrap — buy() only reads the public supported list to format the amount.
    expect(http.calls.some((c) => c.url.includes('client-sessions/tokens'))).toBe(false);
    expect(http.calls.every((c) => c.url.includes('/supported'))).toBe(true);
  });

  it('sell() returns a signed widget URL', async () => {
    const http = mockHttp([supportedRoute, tokenRoute]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    const { sellUrl } = await proto.sell({
      fiatCurrency: 'usd',
      cryptoAsset: 'btc',
      cryptoAmount: 1_000_000n, // 0.01 BTC in base units (8 decimals)
      refundAddress: 'bc1xyz',
    });

    expect(sellUrl).toBe('https://buy.stg.onramper.com/?apiKey=pk_test_abc123&mode=sell&asset=btc&address=bc1xyz');
  });

  it('getSupportedCryptoAssets() calls the public supported endpoint with the apiKey alone', async () => {
    const http = mockHttp([
      tokenRoute,
      {
        match: '/supported',
        handler: () =>
          json(200, {
            message: {
              crypto: [{ code: 'eth', network: 'ethereum', decimals: 18, name: 'Ethereum' }],
              fiat: [{ code: 'usd', decimals: 2, name: 'US Dollar' }],
            },
          }),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    const assets = await proto.getSupportedCryptoAssets();

    expect(assets).toEqual([{ code: 'eth', networkCode: 'ethereum', decimals: 18, name: 'Ethereum' }]);
    // Public data path: no session bootstrap, no SDK envelope — apiKey only.
    expect(http.calls.some((c) => c.url.includes('client-sessions/tokens'))).toBe(false);
    const supportedCall = http.calls.find((c) => c.url.includes('/supported'));
    expect(supportedCall?.headers.Authorization).toBe('pk_test_abc123');
    expect(supportedCall?.headers['X-Onramper-SDK-Session']).toBeUndefined();
  });

  it('caches the supported response across calls', async () => {
    const http = mockHttp([
      tokenRoute,
      {
        match: '/supported',
        handler: () => json(200, { message: { crypto: [], fiat: [{ code: 'eur', decimals: 2, name: 'Euro' }] } }),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    await proto.getSupportedFiatCurrencies();
    await proto.getSupportedFiatCurrencies();

    expect(http.calls.filter((c) => c.url.includes('/supported'))).toHaveLength(1);
  });

  it('getSupportedCountries() maps the live countryCode/countryName wire shape', async () => {
    const http = mockHttp([
      {
        // Real /supported/countries items are {countryCode, countryName} with no
        // buy/sell flags — mirror that exactly so the mapping can't silently blank.
        match: '/supported/countries',
        handler: () =>
          json(200, {
            message: [
              { countryCode: 'AD', countryName: 'Andorra' },
              { countryCode: 'US', countryName: 'United States' },
            ],
          }),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    const countries = await proto.getSupportedCountries();

    expect(countries).toEqual([
      { code: 'AD', name: 'Andorra', isBuyAllowed: true, isSellAllowed: true },
      { code: 'US', name: 'United States', isBuyAllowed: true, isSellAllowed: true },
    ]);
    // Public data path: apiKey only — no session bootstrap, no SDK envelope.
    const countriesCall = http.calls.find((c) => c.url.includes('/supported/countries'));
    expect(countriesCall?.headers.Authorization).toBe('pk_test_abc123');
    expect(countriesCall?.headers['X-Onramper-SDK-Session']).toBeUndefined();
    expect(http.calls.some((c) => c.url.includes('client-sessions/tokens'))).toBe(false);
  });

  it('quoteBuy() returns a WDK FiatQuote — base-unit bigints, rate string, provider under metadata', async () => {
    const http = mockHttp([
      supportedRoute,
      {
        match: '/quotes/usd/eth',
        handler: () => json(200, [{ rate: 3000, payout: 0.033, ramp: 'provider-a', paymentMethod: 'creditcard' }]),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    const quote = await proto.quoteBuy({ fiatCurrency: 'usd', cryptoAsset: 'eth', fiatAmount: 100_00n });

    expect(quote).toEqual({
      fiatAmount: 100_00n, // exact, echoed from the request (USD minor units)
      cryptoAmount: 33_000_000_000_000_000n, // 0.033 ETH at 18 decimals
      fee: 0n, // no fee fields on this quote
      rate: '3000',
      metadata: { provider: 'provider-a', paymentMethod: 'creditcard' },
    });
    const call = http.calls.find((c) => c.url.includes('/quotes/usd/eth'));
    expect(call?.url).toContain('type=buy');
    expect(call?.url).toContain('amount=100'); // 10000 minor units rendered as 100.00 → "100"
    expect(call?.headers.Authorization).toBe('pk_test_abc123');
    expect(call?.headers['X-Onramper-DPoP']).toBeUndefined();
  });

  it('getTransactionDetail() carries the SDK session envelope to the session transaction', async () => {
    const http = mockHttp([
      tokenRoute,
      {
        match: '/checkout/session/sess_abc/transaction',
        handler: () =>
          json(200, {
            valid: true,
            transactionInformation: { transactionId: 'tx_1', status: 'pending', onramp: 'provider-a' },
          }),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    const detail = await proto.getTransactionDetail('sess_abc');

    // pending → in_progress (WDK 3-state); provider moves under metadata.
    expect(detail).toEqual({
      status: 'in_progress',
      cryptoAsset: '',
      fiatCurrency: '',
      metadata: { status: 'pending', provider: 'provider-a' },
    });
    // Session-gated path: token exchange first, then the enveloped call.
    expect(http.calls.some((c) => c.url.includes('client-sessions/tokens'))).toBe(true);
    const txCall = http.calls.find((c) => c.url.includes('/checkout/session/'));
    expect(txCall?.headers['X-Onramper-SDK-Session']).toBe('Bearer at_test_token');
    const proof = decodeProofPayload(txCall?.headers['X-Onramper-DPoP'] as string);
    expect(proof.htm).toBe('GET');
    expect(proof.htu).toBe('https://api-stg.onramper.com/checkout/session/sess_abc/transaction');

    // The bootstrap exchange must send the fingerprint as the X-Onramper-Device
    // HEADER (the API requires it as a header), and the SAME fingerprint must
    // ride the authenticated call.
    const tokenCall = http.calls.find((c) => c.url.includes('client-sessions/tokens'));
    expect(tokenCall?.headers['X-Onramper-Device']).toBeTruthy();
    expect(tokenCall?.headers['X-Onramper-Device']).toBe(txCall?.headers['X-Onramper-Device']);
    const bootstrapBody = JSON.parse(tokenCall?.body ?? '{}');
    expect(bootstrapBody.grant_type).toBe('session_token');
    expect(bootstrapBody.attestation).toEqual({ type: 'none' });
    expect('device_fingerprint' in bootstrapBody).toBe(false);
  });

  it('refresh grant resends session_id and refresh_token', async () => {
    let mintCount = 0;
    const http = mockHttp([
      {
        match: 'client-sessions/tokens',
        handler: () => {
          mintCount += 1;
          // First mint = bootstrap (long-lived); second = refresh response.
          return json(200, {
            access_token: `at_${mintCount}`,
            refresh_token: 'rt_test_token',
            expires_in: mintCount === 1 ? -1 : 900, // force the next call to refresh
            device_id: 'dev_test',
            tier: 1,
          });
        },
      },
      {
        match: '/checkout/session/sess_abc/transaction',
        handler: () =>
          json(200, {
            valid: true,
            transactionInformation: { transactionId: 'tx_1', status: 'pending', onramp: 'provider-a' },
          }),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    await proto.getTransactionDetail('sess_abc');
    await proto.getTransactionDetail('sess_abc');

    const tokenCalls = http.calls.filter((c) => c.url.includes('client-sessions/tokens'));
    const refreshCall = tokenCalls.find((c) => {
      const b = JSON.parse(c.body ?? '{}');
      return b.grant_type === 'refresh_token';
    });
    expect(tokenCalls).toHaveLength(2); // 1 bootstrap + 1 refresh
    expect(refreshCall).toBeDefined();
    const refreshBody = JSON.parse(refreshCall?.body ?? '{}');
    expect(refreshBody.refresh_token).toBe('rt_test_token');
    expect(refreshBody.session_id).toBe('sess_test');
  });

  it('getTransactionDetail() without getSessionToken fails fast with a config error', async () => {
    const http = mockHttp([]);
    const proto = new OnramperFiatProtocol(
      undefined,
      baseConfig({ adapters: http.adapters(), getSessionToken: undefined }),
    );

    await expect(proto.getTransactionDetail('sess_abc')).rejects.toMatchObject({ code: 'invalid_config' });
    expect(http.calls).toHaveLength(0);
  });

  it('quoteBuy() forwards optional config (paymentMethod/networkCode/country) onto the quotes URL', async () => {
    const http = mockHttp([
      supportedRoute,
      {
        match: '/quotes/usd/eth',
        handler: () => json(200, [{ rate: 3000, payout: 0.033, ramp: 'provider-a', paymentMethod: 'creditcard' }]),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    await proto.quoteBuy({
      fiatCurrency: 'usd',
      cryptoAsset: 'eth',
      fiatAmount: 100_00n,
      config: { paymentMethod: 'creditcard', networkCode: 'ethereum', country: 'US' },
    });

    const call = http.calls.find((c) => c.url.includes('/quotes/usd/eth'));
    expect(call?.url).toBe(
      'https://api-stg.onramper.com/quotes/usd/eth?type=buy&amount=100&paymentMethod=creditcard&network=ethereum&country=US',
    );
  });

  it('quoteSell() forwards optional config with type=sell', async () => {
    const http = mockHttp([
      supportedRoute,
      {
        match: '/quotes/eth/usd',
        handler: () => json(200, [{ rate: 3000, payout: 300, ramp: 'provider-b', paymentMethod: 'sepa' }]),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    await proto.quoteSell({
      fiatCurrency: 'usd',
      cryptoAsset: 'eth',
      cryptoAmount: 100_000_000_000_000_000n, // 0.1 ETH
      config: { paymentMethod: 'sepa', networkCode: 'ethereum', country: 'US' },
    });

    const call = http.calls.find((c) => c.url.includes('/quotes/eth/usd'));
    expect(call?.url).toBe(
      'https://api-stg.onramper.com/quotes/eth/usd?type=sell&amount=0.1&paymentMethod=sepa&network=ethereum&country=US',
    );
  });

  it('re-fetches supported once the cache TTL has elapsed (cacheTime 0 never hits)', async () => {
    let hits = 0;
    const http = mockHttp([
      {
        match: '/supported',
        handler: () => {
          hits += 1;
          return json(200, { message: { crypto: [], fiat: [] } });
        },
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ cacheTime: 0, adapters: http.adapters() }));

    await proto.getSupportedFiatCurrencies();
    await proto.getSupportedFiatCurrencies();

    expect(hits).toBe(2);
    expect(http.calls.filter((c) => c.url.includes('/supported'))).toHaveLength(2);
  });

  it('caches the countries response across calls', async () => {
    let hits = 0;
    const http = mockHttp([
      {
        match: '/supported/countries',
        handler: () => {
          hits += 1;
          return json(200, { message: [{ countryCode: 'AD', countryName: 'Andorra' }] });
        },
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    const first = await proto.getSupportedCountries();
    const second = await proto.getSupportedCountries();

    expect(second).toEqual(first);
    expect(hits).toBe(1);
  });
});
