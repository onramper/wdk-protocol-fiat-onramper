import type { SignUrl, SignUrlParams } from '../types/onramper.ts';
import type { BuyOptions, SellOptions } from '../types/wdk.ts';
import { toOptionalString } from '../utils/coerce.ts';

/**
 * buy()/sell() are pure signed-URL builders — no backend call, no session. We
 * assemble the widget params and hand them to the consumer's `signUrl` callback,
 * whose backend produces the request signing signed widget URL. This mirrors the
 * MoonPay WDK protocol: partners already create signed URLs of ours.
 */

/**
 * Builds the signed buy widget URL via the consumer's `signUrl` callback,
 * mapping `BuyOptions` to widget params (recipient → address). Returns the
 * request signing signed widget URL.
 */
export async function buildBuyUrl(signUrl: SignUrl, apiKey: string, options: BuyOptions): Promise<string> {
  const params: SignUrlParams = {
    direction: 'buy',
    apiKey,
    fiatCurrency: options.fiatCurrency,
    cryptoAsset: options.cryptoAsset,
    networkCode: options.networkCode,
    fiatAmount: toOptionalString(options.fiatAmount),
    address: options.recipient,
    memo: options.memo,
    paymentMethod: options.paymentMethod,
    country: options.country,
    quoteId: options.quoteId,
  };
  return signUrl(params);
}

/**
 * Builds the signed sell widget URL via the consumer's `signUrl` callback,
 * mapping `SellOptions` to widget params (refundAddress → address). Returns the
 * request signing signed widget URL.
 */
export async function buildSellUrl(signUrl: SignUrl, apiKey: string, options: SellOptions): Promise<string> {
  const params: SignUrlParams = {
    direction: 'sell',
    apiKey,
    fiatCurrency: options.fiatCurrency,
    cryptoAsset: options.cryptoAsset,
    networkCode: options.networkCode,
    cryptoAmount: toOptionalString(options.cryptoAmount),
    address: options.refundAddress,
    memo: options.memo,
    paymentMethod: options.paymentMethod,
    country: options.country,
    quoteId: options.quoteId,
  };
  return signUrl(params);
}
