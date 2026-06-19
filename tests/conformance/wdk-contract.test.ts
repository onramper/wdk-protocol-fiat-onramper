import { describe, expect, it } from 'vitest';
import { OnramperFiatProtocol } from '../../src/index.ts';
import { baseConfig, json, mockHttp, tokenRoute } from '../helpers.ts';

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

  it('buy() returns a signed widget URL without any backend call', async () => {
    const http = mockHttp([tokenRoute]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    const { buyUrl } = await proto.buy({
      fiatCurrency: 'usd',
      cryptoAsset: 'eth',
      fiatAmount: 100,
      recipient: '0xabc',
    });

    expect(buyUrl).toContain('buy.stg.onramper.com');
    expect(buyUrl).toContain('address=0xabc');
    expect(http.calls).toHaveLength(0); // signed-URL path must not touch the network
  });

  it('sell() returns a signed widget URL', async () => {
    const http = mockHttp([tokenRoute]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    const { sellUrl } = await proto.sell({
      fiatCurrency: 'usd',
      cryptoAsset: 'btc',
      cryptoAmount: '0.01',
      refundAddress: 'bc1xyz',
    });

    expect(sellUrl).toContain('mode=sell');
    expect(sellUrl).toContain('address=bc1xyz');
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

  it('getSupportedCountries() uses the dedicated countries endpoint', async () => {
    const http = mockHttp([
      {
        match: '/supported/countries',
        handler: () => json(200, { message: [{ code: 'US', name: 'United States', isSellAllowed: false }] }),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    const countries = await proto.getSupportedCountries();

    expect(countries).toEqual([{ code: 'US', name: 'United States', isBuyAllowed: true, isSellAllowed: false }]);
  });

  it('quoteBuy() hits the public quotes endpoint and maps the best quote', async () => {
    const http = mockHttp([
      {
        match: '/quotes/usd/eth',
        handler: () => json(200, [{ rate: 3000, payout: 0.033, ramp: 'provider-a', paymentMethod: 'creditcard' }]),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    const quote = await proto.quoteBuy({ fiatCurrency: 'usd', cryptoAsset: 'eth', fiatAmount: 100 });

    expect(quote.provider).toBe('provider-a');
    expect(quote.rate).toBe('3000');
    const call = http.calls.find((c) => c.url.includes('/quotes/usd/eth'));
    expect(call?.url).toContain('type=buy');
    expect(call?.headers.Authorization).toBe('pk_test_abc123');
    expect(call?.headers['X-Onramper-DPoP']).toBeUndefined();
  });

  it('getTransactionDetail() carries the SDK session envelope to checkout v2', async () => {
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

    expect(detail.status).toBe('pending');
    expect(detail.provider).toBe('provider-a');
    // Session-gated path: token exchange first, then the enveloped call.
    expect(http.calls.some((c) => c.url.includes('client-sessions/tokens'))).toBe(true);
    const txCall = http.calls.find((c) => c.url.includes('/checkout/session/'));
    expect(txCall?.headers['X-Onramper-SDK-Session']).toBe('Bearer at_test_token');
    expect(txCall?.headers['X-Onramper-DPoP']).toBeTruthy();

    // The bootstrap exchange must send the fingerprint as the X-Onramper-Device
    // HEADER (partners-api hard-requires it and its body schema discards a body
    // field), and the SAME fingerprint must ride the authenticated call so it
    // hashes to the access token's `did` claim.
    const tokenCall = http.calls.find((c) => c.url.includes('client-sessions/tokens'));
    // Pin the full direct partners-api route: the DPoP htu is signed against this
    // exact URL, so a regression back to the headless proxy path would silently
    // break proof-of-possession — a substring match alone wouldn't catch it.
    expect(tokenCall?.url).toContain('/partners/v2/pk_test_abc123/client-sessions/tokens');
    expect(tokenCall?.url).not.toContain('/headless');
    expect(tokenCall?.headers['X-Onramper-Device']).toBeTruthy();
    expect(tokenCall?.headers['X-Onramper-Device']).toBe(txCall?.headers['X-Onramper-Device']);
    const bootstrapBody = JSON.parse(tokenCall?.body ?? '{}');
    expect(bootstrapBody.grant_type).toBe('session_token');
    expect(bootstrapBody.attestation).toEqual({ type: 'none' });
    expect('device_fingerprint' in bootstrapBody).toBe(false);
  });

  it('refresh grant resends session_id and refresh_token (partners-api requires both)', async () => {
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
    expect(refreshCall).toBeTruthy();
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
});
