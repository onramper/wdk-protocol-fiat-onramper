import type { SignUrl, SignUrlParams } from '../types/onramper.ts';
import type { BuyOptions, SellOptions } from '../types/wdk.ts';

/**
 * buy()/sell() are pure signed-URL builders — no backend call, no session. We
 * assemble the widget params and hand them to the consumer's `signUrl` callback,
 * whose backend produces the Security V2 signed widget URL. This mirrors the
 * MoonPay WDK protocol: partners already create signed URLs of ours.
 */

function toAmountString(value: number | string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'number' ? String(value) : value;
}

export async function buildBuyUrl(signUrl: SignUrl, apiKey: string, options: BuyOptions): Promise<string> {
  const params: SignUrlParams = {
    direction: 'buy',
    apiKey,
    fiatCurrency: options.fiatCurrency,
    cryptoAsset: options.cryptoAsset,
    networkCode: options.networkCode,
    fiatAmount: toAmountString(options.fiatAmount),
    address: options.recipient,
    memo: options.memo,
    paymentMethod: options.paymentMethod,
    country: options.country,
    quoteId: options.quoteId,
  };
  return signUrl(params);
}

export async function buildSellUrl(signUrl: SignUrl, apiKey: string, options: SellOptions): Promise<string> {
  const params: SignUrlParams = {
    direction: 'sell',
    apiKey,
    fiatCurrency: options.fiatCurrency,
    cryptoAsset: options.cryptoAsset,
    networkCode: options.networkCode,
    cryptoAmount: toAmountString(options.cryptoAmount),
    address: options.refundAddress,
    memo: options.memo,
    paymentMethod: options.paymentMethod,
    country: options.country,
    quoteId: options.quoteId,
  };
  return signUrl(params);
}
