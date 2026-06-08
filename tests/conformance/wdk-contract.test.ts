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

  it('getSupportedCryptoAssets() bootstraps a session then maps the response', async () => {
    const http = mockHttp([
      tokenRoute,
      {
        match: '/supported',
        handler: () =>
          json(200, {
            crypto: [{ code: 'eth', network: 'ethereum', decimals: 18, name: 'Ethereum' }],
            fiat: [{ code: 'usd', decimals: 2, name: 'US Dollar' }],
            countries: [{ code: 'US', name: 'United States', isBuyAllowed: true, isSellAllowed: false }],
          }),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    const assets = await proto.getSupportedCryptoAssets();

    expect(assets).toEqual([{ code: 'eth', networkCode: 'ethereum', decimals: 18, name: 'Ethereum' }]);
    // A token exchange must have happened before the data call.
    expect(http.calls.some((c) => c.url.includes('client-sessions/tokens'))).toBe(true);
    expect(http.calls.some((c) => c.url.includes('/supported'))).toBe(true);
  });

  it('caches the supported response across calls', async () => {
    const http = mockHttp([
      tokenRoute,
      {
        match: '/supported',
        handler: () => json(200, { crypto: [], fiat: [{ code: 'eur', decimals: 2, name: 'Euro' }] }),
      },
    ]);
    const proto = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));

    await proto.getSupportedFiatCurrencies();
    await proto.getSupportedCountries();

    expect(http.calls.filter((c) => c.url.includes('/supported'))).toHaveLength(1);
  });
});
