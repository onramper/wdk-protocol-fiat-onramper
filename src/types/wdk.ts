/**
 * Types mirroring Tether's WDK `IFiatProtocol` contract.
 *
 * Source of truth: https://github.com/tetherto/wdk-wallet `src/protocols/fiat-protocol.js`.
 * We re-express the (untyped) JS contract in TypeScript so Onramper plugs into
 * WDK wallets identically to `@tetherto/wdk-protocol-fiat-moonpay`. Method names,
 * argument shapes, and the `buyUrl`/`sellUrl` return fields must stay aligned
 * with that interface — drift breaks WDK consumers.
 */

/** Direction of a fiat ramp, used where buy and sell share a code path. */
export type FiatDirection = 'buy' | 'sell';

/** Lifecycle of a ramp transaction, normalised across Onramper providers. */
export type FiatTxStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'expired' | 'unknown';

/** A priced quote for a buy or sell. Amounts are decimal strings to avoid float loss. */
export interface FiatQuote {
  direction: FiatDirection;
  fiatCurrency: string;
  cryptoAsset: string;
  fiatAmount: string;
  cryptoAmount: string;
  rate: string;
  networkFee?: string;
  transactionFee?: string;
  paymentMethod?: string;
  provider?: string;
  quoteId?: string;
  /** Unix seconds after which the quote must be re-fetched, when the provider supplies it. */
  expiresAt?: number;
}

/** Result of `buy()` — the widget URL the consumer opens to complete the purchase. */
export interface BuyResult {
  buyUrl: string;
}

/** Result of `sell()` — the widget URL the consumer opens to complete the sale. */
export interface SellResult {
  sellUrl: string;
}

/** Resolved detail for a single ramp transaction. */
export interface FiatTransactionDetail {
  status: FiatTxStatus;
  cryptoAsset: string;
  fiatCurrency: string;
  fiatAmount?: string;
  cryptoAmount?: string;
  txHash?: string;
  provider?: string;
}

/** One crypto asset Onramper can ramp, with its network and on-chain decimals. */
export interface SupportedCryptoAsset {
  code: string;
  networkCode: string;
  decimals: number;
  name: string;
}

/** One fiat currency Onramper supports, with its minor-unit decimals. */
export interface SupportedFiatCurrency {
  code: string;
  decimals: number;
  name: string;
}

/** One supported country with its buy/sell allow-flags. */
export interface SupportedCountry {
  code: string;
  isBuyAllowed: boolean;
  isSellAllowed: boolean;
  name: string;
}

/** Quote inputs for a buy: spend `fiatAmount` of `fiatCurrency` to receive `cryptoAsset`. */
export interface QuoteBuyOptions {
  fiatCurrency: string;
  cryptoAsset: string;
  fiatAmount: number | string;
  networkCode?: string;
  paymentMethod?: string;
  country?: string;
}

/** Quote inputs for a sell: sell `cryptoAmount` of `cryptoAsset` for `fiatCurrency`. */
export interface QuoteSellOptions {
  fiatCurrency: string;
  cryptoAsset: string;
  cryptoAmount: number | string;
  networkCode?: string;
  paymentMethod?: string;
  country?: string;
}

/** `buy()` additionally needs the crypto recipient address. */
export interface BuyOptions extends QuoteBuyOptions {
  recipient: string;
  memo?: string;
  quoteId?: string;
}

/** `sell()` additionally needs the address to refund to if the sale fails. */
export interface SellOptions extends QuoteSellOptions {
  refundAddress: string;
  memo?: string;
  quoteId?: string;
}

/**
 * The WDK fiat-protocol contract. `quoteBuy`/`quoteSell` omit the address field
 * (recipient/refundAddress) since a quote does not move funds. Every method
 * rejects with `OnramperError` (never a raw `Error`).
 *
 * @see https://github.com/tetherto/wdk-wallet `src/protocols/fiat-protocol.js`
 */
export interface IFiatProtocol {
  /** Prices a buy. @throws {OnramperError} `QUOTE_UNAVAILABLE` if no priced quote exists; `UPSTREAM_ERROR`/`DECODE_ERROR` from the quotes call. */
  quoteBuy(options: QuoteBuyOptions): Promise<FiatQuote>;
  /** Builds the signed buy widget URL via `signUrl`. No backend call. */
  buy(options: BuyOptions): Promise<BuyResult>;
  /** Prices a sell. @throws {OnramperError} `QUOTE_UNAVAILABLE` if no priced quote exists; `UPSTREAM_ERROR`/`DECODE_ERROR` from the quotes call. */
  quoteSell(options: QuoteSellOptions): Promise<FiatQuote>;
  /** Builds the signed sell widget URL via `signUrl`. No backend call. */
  sell(options: SellOptions): Promise<SellResult>;
  /**
   * Resolves status/amounts for one ramp transaction via the checkout session session.
   * @param direction - Disambiguates buy vs sell lookups; inferred when omitted.
   * @throws {OnramperError} `INVALID_CONFIG` when `getSessionToken` is not configured; `UPSTREAM_ERROR`/`DECODE_ERROR` from the session call.
   */
  getTransactionDetail(txId: string, direction?: FiatDirection): Promise<FiatTransactionDetail>;
  /** Public data endpoint (TTL-cached). @throws {OnramperError} `UPSTREAM_ERROR`/`DECODE_ERROR` on a failed request. */
  getSupportedCryptoAssets(): Promise<SupportedCryptoAsset[]>;
  /** Public data endpoint (TTL-cached). @throws {OnramperError} `UPSTREAM_ERROR`/`DECODE_ERROR` on a failed request. */
  getSupportedFiatCurrencies(): Promise<SupportedFiatCurrency[]>;
  /** Public data endpoint (TTL-cached). @throws {OnramperError} `UPSTREAM_ERROR`/`DECODE_ERROR` on a failed request. */
  getSupportedCountries(): Promise<SupportedCountry[]>;
}
