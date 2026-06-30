/**
 * Canonical WDK fiat-protocol contract, re-exported verbatim from
 * `@tetherto/wdk-wallet`, plus Onramper's provider-specific extensions layered
 * on top via the `config` (input) / `metadata` (output) pattern that
 * `@tetherto/wdk-protocol-fiat-moonpay` uses. The base shapes are the source of
 * truth — never redeclared here, so they cannot drift from the contract a WDK
 * wallet relies on.
 */

export type {
  BuyOptions,
  BuyResult,
  FiatQuote,
  FiatTransactionDetail,
  FiatTransactionStatus,
  IFiatProtocol,
  SellOptions,
  SellResult,
  SupportedCountry,
  SupportedCryptoAsset,
  SupportedFiatCurrency,
} from '@tetherto/wdk-wallet/protocols';

import type { BuyOptions, FiatQuote, FiatTransactionDetail, SellOptions } from '@tetherto/wdk-wallet/protocols';

/** Internal buy/sell discriminator. Not part of the WDK surface. */
export type FiatDirection = 'buy' | 'sell';

/**
 * Onramper-specific widget/quote knobs, carried under `config` so the base
 * Buy/Sell options stay exactly WDK-shaped — a wallet that only knows the WDK
 * contract simply omits `config`.
 */
export interface OnramperRequestConfig {
  /** Network/chain code when a crypto asset spans several chains. */
  networkCode?: string;
  /** Preferred payment (buy) or payout (sell) method. */
  paymentMethod?: string;
  /** ISO-3166 country used for availability and pricing. */
  country?: string;
  /** Destination memo/tag for chains that require one. */
  memo?: string;
  /** Pins buy/sell to a quote previously returned by quoteBuy/quoteSell. */
  quoteId?: string;
}

export type OnramperBuyOptions = BuyOptions & { config?: OnramperRequestConfig };
export type OnramperSellOptions = SellOptions & { config?: OnramperRequestConfig };
export type OnramperQuoteBuyOptions = Omit<BuyOptions, 'recipient'> & { config?: OnramperRequestConfig };
export type OnramperQuoteSellOptions = Omit<SellOptions, 'refundAddress'> & { config?: OnramperRequestConfig };

/**
 * Raw Onramper quote data surfaced under `FiatQuote.metadata` for callers that
 * need the chosen provider, fee breakdown or payment method — none of which the
 * WDK `FiatQuote` carries.
 */
export interface OnramperQuoteMetadata {
  quoteId?: string;
  provider?: string;
  paymentMethod?: string;
  /** Provider network fee as a major-unit decimal string (e.g. "0.50" USD) — NOT the base-unit `fee` bigint on FiatQuote. */
  networkFee?: string;
  /** Provider transaction fee as a major-unit decimal string, not base/minor units. */
  transactionFee?: string;
}

/** Onramper quote: the WDK `FiatQuote` plus provider data under `metadata`. */
export type OnramperFiatQuote = FiatQuote & { metadata: OnramperQuoteMetadata };

/** Extra transaction fields Onramper resolves, surfaced under `metadata`. */
export interface OnramperTransactionMetadata {
  /** The raw provider status string, before normalisation to the WDK 3-state. */
  status?: string;
  txHash?: string;
  provider?: string;
  /** Provider-reported fiat amount as a major-unit decimal string (e.g. "100.00"), not minor units. */
  fiatAmount?: string;
  /** Provider-reported crypto amount as a major-unit decimal string (e.g. "0.05"), not base units. */
  cryptoAmount?: string;
}

/** Onramper transaction detail: the WDK shape plus extras under `metadata`. */
export type OnramperTransactionDetail = FiatTransactionDetail & { metadata: OnramperTransactionMetadata };
