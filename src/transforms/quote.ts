import { OnramperError, OnramperErrorCode } from '../errors/index.ts';
import type { FiatDirection, FiatQuote } from '../types/wdk.ts';

/**
 * Shape of a single quote entry from the quotes endpoint. NOTE: the precise wire
 * fields must be confirmed against the live quotes API during verification — the
 * mapping below is defensive (optional fields, string coercion) so partial or
 * renamed payloads degrade rather than throw.
 */
interface RawQuote {
  quoteId?: string;
  ramp?: string;
  rate?: number | string;
  networkFee?: number | string;
  transactionFee?: number | string;
  payout?: number | string;
  paymentMethod?: string;
  errors?: unknown[];
}

function str(value: number | string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'number' ? String(value) : value;
}

/**
 * Pick the best quote (first error-free entry) and map it to a `FiatQuote`.
 * `fiatAmount`/`cryptoAmount` are echoed from the request since the quote list
 * is keyed by the requested amount.
 */
export function toFiatQuote(
  raw: unknown,
  context: {
    direction: FiatDirection;
    fiatCurrency: string;
    cryptoAsset: string;
    fiatAmount?: string;
    cryptoAmount?: string;
  },
): FiatQuote {
  const list: RawQuote[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { quotes?: RawQuote[] })?.quotes)
      ? (raw as { quotes: RawQuote[] }).quotes
      : [];
  // Require a priced entry, not just an error-free one: a rate-less item maps to
  // a quote with a blank `rate` (the same silent-empty trap the countries
  // transform fell into), so treat it as no-quote.
  const best = list.find((q) => (!q.errors || q.errors.length === 0) && q.rate != null);
  if (!best) {
    throw new OnramperError(OnramperErrorCode.QUOTE_UNAVAILABLE, 'No quote available for the requested pair');
  }

  const payout = str(best.payout);
  return {
    direction: context.direction,
    fiatCurrency: context.fiatCurrency,
    cryptoAsset: context.cryptoAsset,
    fiatAmount: context.fiatAmount ?? (context.direction === 'buy' ? '' : (payout ?? '')),
    cryptoAmount: context.cryptoAmount ?? (context.direction === 'buy' ? (payout ?? '') : ''),
    rate: str(best.rate) ?? '',
    networkFee: str(best.networkFee),
    transactionFee: str(best.transactionFee),
    paymentMethod: best.paymentMethod,
    provider: best.ramp,
    quoteId: best.quoteId,
  };
}
