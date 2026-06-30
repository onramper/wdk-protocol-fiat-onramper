import type { IWalletAccountReadOnly } from '@tetherto/wdk-wallet';
import { describe, expect, it } from 'vitest';
import { OnramperErrorCode } from '../src/errors.ts';
import { OnramperFiatProtocol } from '../src/index.ts';
import type { SignUrlParams } from '../src/types/onramper.ts';
import { baseConfig, json, mockHttp, supportedRoute } from './helpers.ts';

const base = { fiatCurrency: 'usd', cryptoAsset: 'eth' } as const;
const reject = (code: OnramperErrorCode, re: RegExp) => ({ code, message: expect.stringMatching(re) });
// The amount guards fire before any network call, so the supported mock is incidental here.
const proto = () =>
  new OnramperFiatProtocol(undefined, baseConfig({ adapters: mockHttp([supportedRoute]).adapters() }));

describe('amount-XOR / argument validation (INVALID_ARGUMENT)', () => {
  it('quoteBuy rejects both amounts, and a crypto-only (wrong-side) request', async () => {
    await expect(proto().quoteBuy({ ...base, fiatAmount: 100_00n, cryptoAmount: 1n })).rejects.toMatchObject(
      reject(OnramperErrorCode.INVALID_ARGUMENT, /cannot both/),
    );
    await expect(proto().quoteBuy({ ...base, cryptoAmount: 1n })).rejects.toMatchObject(
      reject(OnramperErrorCode.UNSUPPORTED_OPERATION, /'fiatAmount'/),
    );
  });

  it('quoteSell rejects both amounts, and a fiat-only (wrong-side) request', async () => {
    await expect(proto().quoteSell({ ...base, fiatAmount: 100_00n, cryptoAmount: 1n })).rejects.toMatchObject(
      reject(OnramperErrorCode.INVALID_ARGUMENT, /cannot both/),
    );
    await expect(proto().quoteSell({ ...base, fiatAmount: 100_00n })).rejects.toMatchObject(
      reject(OnramperErrorCode.UNSUPPORTED_OPERATION, /'cryptoAmount'/),
    );
  });

  it('buy rejects neither-set; sell rejects both-set', async () => {
    // @ts-expect-error WDK BuyOptions is an XOR: neither-set is a type error and a runtime guard
    await expect(proto().buy({ ...base })).rejects.toMatchObject(
      reject(OnramperErrorCode.INVALID_ARGUMENT, /Either 'cryptoAmount' or 'fiatAmount'/),
    );
    // @ts-expect-error WDK SellOptions is an XOR: both-set is a type error and a runtime guard
    await expect(proto().sell({ ...base, fiatAmount: 1n, cryptoAmount: 1n })).rejects.toMatchObject(
      reject(OnramperErrorCode.INVALID_ARGUMENT, /cannot both/),
    );
  });

  it('rejects a non-integer number amount with a typed error (not a raw RangeError)', async () => {
    await expect(proto().quoteBuy({ ...base, fiatAmount: 100.5 })).rejects.toMatchObject(
      reject(OnramperErrorCode.INVALID_ARGUMENT, /whole number/),
    );
    await expect(proto().buy({ ...base, fiatAmount: 100.5, recipient: '0xabc' })).rejects.toMatchObject(
      reject(OnramperErrorCode.INVALID_ARGUMENT, /whole number/),
    );
  });

  it('accepts a zero amount (0n must survive the `!= null` guard, not be rejected as falsy)', async () => {
    const http = mockHttp([
      supportedRoute,
      { match: '/quotes/usd/eth', handler: () => json(200, [{ rate: 3000, payout: 0.033, ramp: 'p' }]) },
    ]);
    const p = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
    const quote = await p.quoteBuy({ ...base, fiatAmount: 0n });
    expect(quote.fiatAmount).toBe(0n);
    expect(http.calls.find((c) => c.url.includes('/quotes/usd/eth'))?.url).toContain('amount=0');
  });
});

describe('account-default recipient / refundAddress', () => {
  const account = { getAddress: async () => '0xWALLET' } as unknown as IWalletAccountReadOnly;

  it('buy defaults the recipient to the bound account address', async () => {
    let seen: SignUrlParams | undefined;
    const http = mockHttp([supportedRoute]);
    const p = new OnramperFiatProtocol(
      account,
      baseConfig({
        adapters: http.adapters(),
        signUrl: async (params) => {
          seen = params;
          return 'https://x';
        },
      }),
    );
    await p.buy({ ...base, fiatAmount: 100_00n });
    expect(seen?.address).toBe('0xWALLET');
  });

  it('sell defaults the refund address to the bound account address', async () => {
    let seen: SignUrlParams | undefined;
    const http = mockHttp([supportedRoute]);
    const p = new OnramperFiatProtocol(
      account,
      baseConfig({
        adapters: http.adapters(),
        signUrl: async (params) => {
          seen = params;
          return 'https://x';
        },
      }),
    );
    await p.sell({ fiatCurrency: 'usd', cryptoAsset: 'btc', cryptoAmount: 1_000_000n });
    expect(seen?.address).toBe('0xWALLET');
  });

  it('forwards address: undefined when neither recipient nor account is supplied', async () => {
    let seen: SignUrlParams | undefined;
    const http = mockHttp([supportedRoute]);
    const p = new OnramperFiatProtocol(
      undefined,
      baseConfig({
        adapters: http.adapters(),
        signUrl: async (params) => {
          seen = params;
          return 'https://x';
        },
      }),
    );
    await p.buy({ ...base, fiatAmount: 100_00n });
    expect(seen && 'address' in seen).toBe(true);
    expect(seen?.address).toBeUndefined();
  });
});

describe('quote robustness', () => {
  it('a finite-rate but non-numeric / non-finite / zero payout falls through to QUOTE_UNAVAILABLE', async () => {
    for (const payout of ['N/A', '', 'Infinity', 0]) {
      const http = mockHttp([
        supportedRoute,
        { match: '/quotes/usd/eth', handler: () => json(200, [{ rate: 3000, payout, ramp: 'p' }]) },
      ]);
      const p = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
      await expect(p.quoteBuy({ ...base, fiatAmount: 100_00n })).rejects.toMatchObject(
        reject(OnramperErrorCode.QUOTE_UNAVAILABLE, /No quote available/),
      );
    }
  });

  it('a sub-base-unit payout (floors to 0n) is treated as no-quote, not a zero quote', async () => {
    const http = mockHttp([
      supportedRoute,
      { match: '/quotes/eth/usd', handler: () => json(200, [{ rate: 3000, payout: '0.004', ramp: 'p' }]) },
    ]);
    const p = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
    // 0.004 USD floors to 0 minor units at 2 decimals → not a usable quote.
    await expect(
      p.quoteSell({ fiatCurrency: 'usd', cryptoAsset: 'eth', cryptoAmount: 1_000_000_000_000_000_000n }),
    ).rejects.toMatchObject(reject(OnramperErrorCode.QUOTE_UNAVAILABLE, /No quote available/));
  });

  it('truncates an over-precise crypto payout toward zero (never over-credits)', async () => {
    const http = mockHttp([
      supportedRoute,
      {
        match: '/quotes/usd/btc',
        handler: () => json(200, [{ rate: 60000, payout: '0.123456789', ramp: 'p', networkFee: '0.005' }]),
      },
    ]);
    const p = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
    const quote = await p.quoteBuy({ fiatCurrency: 'usd', cryptoAsset: 'btc', fiatAmount: 100_00n });
    expect(quote.cryptoAmount).toBe(12_345_678n); // 0.123456789 BTC floored at 8 decimals
    expect(quote.fee).toBe(0n); // 0.005 USD sub-cent floored
  });

  it('a known asset missing decimals fails loudly instead of mis-scaling at a default', async () => {
    const http = mockHttp([
      {
        match: '/supported',
        handler: () =>
          json(200, {
            message: { crypto: [{ code: 'btc', networkCode: 'bitcoin' }], fiat: [{ code: 'usd', decimals: 2 }] },
          }),
      },
      { match: '/quotes/usd/btc', handler: () => json(200, [{ rate: 60000, payout: '0.01', ramp: 'p' }]) },
    ]);
    const p = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
    await expect(p.quoteBuy({ fiatCurrency: 'usd', cryptoAsset: 'btc', fiatAmount: 100_00n })).rejects.toMatchObject(
      reject(OnramperErrorCode.DECODE_ERROR, /Missing decimals/),
    );
  });

  it('resolves decimals with a single cold-cache GET /supported (no double-fetch)', async () => {
    let hits = 0;
    const http = mockHttp([
      {
        match: '/supported',
        handler: () => {
          hits += 1;
          return json(200, {
            message: {
              crypto: [{ code: 'eth', networkCode: 'ethereum', decimals: 18 }],
              fiat: [{ code: 'usd', decimals: 2 }],
            },
          });
        },
      },
      { match: '/quotes/usd/eth', handler: () => json(200, [{ rate: 3000, payout: 0.033, ramp: 'p' }]) },
    ]);
    const p = new OnramperFiatProtocol(undefined, baseConfig({ adapters: http.adapters() }));
    await p.quoteBuy({ ...base, fiatAmount: 100_00n });
    expect(hits).toBe(1);
  });
});
