import { OnramperError, OnramperErrorCode } from '../errors.ts';
import type { OnramperFiatQuote } from '../types/wdk.ts';
import { toOptionalString } from '../utils/format.ts';
import { sumToBaseUnits, toBaseUnitsOrNull } from '../utils/units.ts';

/**
 * One quote entry from the quotes endpoint. The precise wire fields still need
 * confirming against the live quotes API — the mapping stays defensive (optional
 * fields, tolerant coercion) so a partial or renamed payload degrades instead of
 * throwing. `payout` is the decimal amount on the side opposite the request
 * (crypto received on a buy, fiat received on a sell).
 */
interface RawQuote {
  /** Provider-issued quote id; pins a later buy/sell to this exact price via `config.quoteId`. */
  quoteId?: string;
  /** The quoting provider's name. */
  ramp?: string;
  /** Exchange rate, as reported by the provider. */
  rate?: number | string;
  /** Provider network fee, in major units of the fiat currency. */
  networkFee?: number | string;
  /** Provider transaction fee, in major units of the fiat currency. */
  transactionFee?: number | string;
  /** Decimal amount on the side opposite the request (crypto received on a buy, fiat received on a sell). */
  payout?: number | string;
  /** The payment (buy) or payout (sell) method this quote applies to. */
  paymentMethod?: string;
  /** Present and non-empty when the provider couldn't price this entry; such entries are skipped. */
  errors?: unknown[];
}

/** The caller's exact request side and the asset decimals needed to scale the provider's `payout`. */
interface QuoteContext {
  /** Minor-unit decimals for the fiat currency. */
  fiatDecimals: number;
  /** On-chain base-unit decimals for the crypto asset. */
  cryptoDecimals: number;
  /** The exact base-unit amount the caller specified. */
  requestedBaseUnits: bigint;
  /** Which side `requestedBaseUnits` denominates. */
  requestedSide: 'fiat' | 'crypto';
}

/**
 * Pick the best quote and map it onto the WDK `FiatQuote`: amounts as base-unit
 * integers, `fee` summed in the fiat minor unit, `rate` as a string, with the raw
 * provider data under `metadata`. The requested side is exact (echoed from the
 * caller's base-unit input); the opposite side is the provider `payout` converted
 * at that asset's decimals.
 *
 * @param raw - The raw quotes-endpoint response body (an array, or an object with a `quotes` array).
 * @param context - The caller's requested side/amount and the pair's decimals.
 * @returns The best available quote, mapped onto the WDK `FiatQuote` shape.
 * @throws {OnramperError} `QUOTE_UNAVAILABLE` when no error-free entry yields a
 *   positive whole base-unit payout.
 */
export function toFiatQuote(raw: unknown, context: QuoteContext): OnramperFiatQuote {
  const quotes = (raw as { quotes?: unknown })?.quotes;
  const list: RawQuote[] = Array.isArray(raw) ? raw : Array.isArray(quotes) ? (quotes as RawQuote[]) : [];
  const payoutDecimals = context.requestedSide === 'fiat' ? context.cryptoDecimals : context.fiatDecimals;

  // A usable quote is error-free, priced, and pays out a positive WHOLE base unit.
  // `payout` is validated AFTER conversion so a sub-unit decimal (which truncates
  // to 0n) or a non-finite string (Infinity/NaN) is skipped — falling through to
  // QUOTE_UNAVAILABLE rather than emitting a zero amount or throwing on BigInt(NaN).
  let best: RawQuote | undefined;
  let payoutBaseUnits = 0n;
  for (const q of list) {
    if (q.errors && q.errors.length > 0) {
      continue;
    }
    if (q.rate == null) {
      continue;
    }
    const payout = toBaseUnitsOrNull(q.payout, payoutDecimals);
    if (payout != null && payout > 0n) {
      best = q;
      payoutBaseUnits = payout;
      break;
    }
  }
  if (!best) {
    throw new OnramperError(OnramperErrorCode.QUOTE_UNAVAILABLE, 'No quote available for the requested pair');
  }

  return {
    fiatAmount: context.requestedSide === 'fiat' ? context.requestedBaseUnits : payoutBaseUnits,
    cryptoAmount: context.requestedSide === 'crypto' ? context.requestedBaseUnits : payoutBaseUnits,
    fee: sumToBaseUnits([best.networkFee, best.transactionFee], context.fiatDecimals),
    rate: toOptionalString(best.rate) ?? '0',
    metadata: {
      quoteId: best.quoteId,
      provider: best.ramp,
      paymentMethod: best.paymentMethod,
      networkFee: toOptionalString(best.networkFee),
      transactionFee: toOptionalString(best.transactionFee),
    },
  };
}
