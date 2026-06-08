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

export interface SupportedCryptoAsset {
  code: string;
  networkCode: string;
  decimals: number;
  name: string;
}

export interface SupportedFiatCurrency {
  code: string;
  decimals: number;
  name: string;
}

export interface SupportedCountry {
  code: string;
  isBuyAllowed: boolean;
  isSellAllowed: boolean;
  name: string;
}

export interface QuoteBuyOptions {
  fiatCurrency: string;
  cryptoAsset: string;
  fiatAmount: number | string;
  networkCode?: string;
  paymentMethod?: string;
  country?: string;
}

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
 * (recipient/refundAddress) since a quote does not move funds.
 */
export interface IFiatProtocol {
  quoteBuy(options: QuoteBuyOptions): Promise<FiatQuote>;
  buy(options: BuyOptions): Promise<BuyResult>;
  quoteSell(options: QuoteSellOptions): Promise<FiatQuote>;
  sell(options: SellOptions): Promise<SellResult>;
  getTransactionDetail(txId: string, direction?: FiatDirection): Promise<FiatTransactionDetail>;
  getSupportedCryptoAssets(): Promise<SupportedCryptoAsset[]>;
  getSupportedFiatCurrencies(): Promise<SupportedFiatCurrency[]>;
  getSupportedCountries(): Promise<SupportedCountry[]>;
}
