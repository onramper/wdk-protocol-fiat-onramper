import type { IWalletAccount, IWalletAccountReadOnly } from '@tetherto/wdk-wallet';
import { FiatProtocol } from '@tetherto/wdk-wallet/protocols';
import { channelForRuntime, detectRuntime, resolveAdapters } from './adapters/index.ts';
import { Endpoints } from './client/endpoints.ts';
import { AuthorizedClient } from './client/http-client.ts';
import { SessionManager } from './client/session-manager.ts';
import { buildBuyUrl, buildSellUrl } from './client/widget-url.ts';
import { DEFAULT_CACHE_TIME_MS, ENVIRONMENT_URLS, validateConfig } from './config.ts';
import { OnramperError, OnramperErrorCode } from './errors.ts';
import { toFiatQuote } from './transforms/quote.ts';
import {
  findSupportedPair,
  toSupportedCountries,
  toSupportedCryptoAssets,
  toSupportedFiatCurrencies,
} from './transforms/supported.ts';
import { toFiatTransactionDetail } from './transforms/transaction.ts';
import type { AmountXor, OnramperChannel, OnramperFiatConfig } from './types/onramper.ts';
import type {
  BuyResult,
  FiatDirection,
  OnramperBuyOptions,
  OnramperFiatQuote,
  OnramperQuoteBuyOptions,
  OnramperQuoteSellOptions,
  OnramperRequestConfig,
  OnramperSellOptions,
  OnramperTransactionDetail,
  SellResult,
  SupportedCountry,
  SupportedCryptoAsset,
  SupportedFiatCurrency,
} from './types/wdk.ts';
import { TtlCache } from './utils/cache.ts';
import { toBaseUnitBigInt, toDecimalString } from './utils/units.ts';

type WdkAccount = IWalletAccount | IWalletAccountReadOnly;

/**
 * The WDK amount XOR before it's resolved to a single side. Mirrors the
 * `?: never` XOR the WDK's own `Buy`/`SellOptions` use, so a caller can't
 * supply both amounts.
 */
type AmountInput =
  | { cryptoAmount: number | bigint; fiatAmount?: never }
  | { fiatAmount: number | bigint; cryptoAmount?: never };

/** The WDK amount XOR resolved to a single side and its value. */
interface AmountSelection {
  /** Which amount field the caller populated. */
  side: 'crypto' | 'fiat';
  /** The base/minor-unit amount from that field. */
  value: number | bigint;
}

/** A pair's crypto + fiat decimals, resolved from the supported payload. */
interface AssetDecimals {
  /** On-chain base-unit decimals for the crypto asset. */
  cryptoDecimals: number;
  /** Minor-unit decimals for the fiat currency. */
  fiatDecimals: number;
}

/** Decimal amount string in the widget's expected form, on the side the caller specified. */
type WidgetAmounts = AmountXor<'fiatAmount', 'cryptoAmount'>;

/**
 * Onramper's WDK fiat protocol — extends `FiatProtocol` from
 * `@tetherto/wdk-wallet` so any WDK wallet can wire Onramper in behind the same
 * `IFiatProtocol` it uses for every other provider.
 *
 * Three request paths:
 *   - `buy` / `sell` build a signed widget deep link via the consumer's
 *     `signUrl` callback. They read the cached supported list once to render the
 *     base-unit amount in the widget's decimal form; no other backend call.
 *   - `quote*` / `getSupported*` hit the public data endpoints with the
 *     publishable apiKey alone — no session.
 *   - `getTransactionDetail` reads the session transaction and is the one call
 *     gated by a session token + DPoP envelope (needs `getSessionToken`).
 *
 * @see https://www.rfc-editor.org/rfc/rfc9449 (DPoP) for the session-token envelope
 */
export class OnramperFiatProtocol extends FiatProtocol {
  private readonly config: OnramperFiatConfig;
  private readonly endpoints: Endpoints;
  private readonly client: AuthorizedClient;
  private readonly supportedCache: TtlCache<unknown>;
  private readonly countriesCache: TtlCache<unknown>;

  /**
   * Creates an Onramper fiat protocol instance.
   *
   * @param account - The wallet account to bind, used for the default recipient/refund address.
   * @param config - Onramper-specific configuration (apiKey, signUrl, environment, adapters).
   * @throws {OnramperError} `INVALID_CONFIG` when `config` fails validation (see `validateConfig`).
   */
  constructor(account: WdkAccount | undefined, config: OnramperFiatConfig) {
    super(account);
    this.config = validateConfig(config);

    const runtime = detectRuntime();
    const channel: OnramperChannel = config.channel ?? channelForRuntime(runtime);
    const adapters = resolveAdapters(runtime, config.adapters);

    const env = config.environment ?? 'production';
    const urls = ENVIRONMENT_URLS[env];
    const apiBaseUrl = config.baseUrl ?? urls.apiBaseUrl;

    this.endpoints = new Endpoints(apiBaseUrl);
    const session = new SessionManager({
      adapters,
      endpoints: this.endpoints,
      apiKey: config.apiKey,
      channel,
      getSessionToken:
        config.getSessionToken ??
        (() => {
          throw new OnramperError(
            OnramperErrorCode.INVALID_CONFIG,
            'getSessionToken is required for getTransactionDetail',
          );
        }),
    });
    this.client = new AuthorizedClient({ adapters, session, apiKey: config.apiKey, channel });
    const cacheTtl = config.cacheTime ?? DEFAULT_CACHE_TIME_MS;
    this.supportedCache = new TtlCache<unknown>(cacheTtl);
    this.countriesCache = new TtlCache<unknown>(cacheTtl);
  }

  /**
   * Prices a buy: spend an exact `fiatAmount` (fiat minor units) to receive crypto.
   *
   * @param options - The exact-fiat-spend buy quote request.
   * @returns The priced quote, with Onramper's provider/fee data under `metadata`.
   * @throws {OnramperError} `INVALID_ARGUMENT` if both amounts or a non-integer
   *   amount are given; `UNSUPPORTED_OPERATION` if only `cryptoAmount` is given
   *   (Onramper prices buys by fiat spend, not an exact crypto target);
   *   `UNSUPPORTED_ASSET` for an unknown pair; `QUOTE_UNAVAILABLE` when no priced
   *   quote exists.
   */
  async quoteBuy(options: OnramperQuoteBuyOptions): Promise<OnramperFiatQuote> {
    const { side, value } = OnramperFiatProtocol.selectAmount(options);
    if (side !== 'fiat') {
      throw new OnramperError(
        OnramperErrorCode.UNSUPPORTED_OPERATION,
        "quoteBuy supports an exact 'fiatAmount' spend only; quoting an exact crypto target isn't supported by Onramper's quotes API",
      );
    }
    const fiatBaseUnits = toBaseUnitBigInt(value);
    const { cryptoDecimals, fiatDecimals } = await this.assetDecimals(options.cryptoAsset, options.fiatCurrency);
    const amount = toDecimalString(fiatBaseUnits, fiatDecimals);
    const raw = await this.fetchQuote('buy', options.fiatCurrency, options.cryptoAsset, amount, options.config);
    return toFiatQuote(raw, { fiatDecimals, cryptoDecimals, requestedBaseUnits: fiatBaseUnits, requestedSide: 'fiat' });
  }

  /**
   * Prices a sell: sell an exact `cryptoAmount` (base units) for fiat.
   *
   * @param options - The exact-crypto-amount sell quote request.
   * @returns The priced quote, with Onramper's provider/fee data under `metadata`.
   * @throws {OnramperError} `INVALID_ARGUMENT` if both amounts or a non-integer
   *   amount are given; `UNSUPPORTED_OPERATION` if only `fiatAmount` is given;
   *   `UNSUPPORTED_ASSET` for an unknown pair; `QUOTE_UNAVAILABLE` when no priced
   *   quote exists.
   */
  async quoteSell(options: OnramperQuoteSellOptions): Promise<OnramperFiatQuote> {
    const { side, value } = OnramperFiatProtocol.selectAmount(options);
    if (side !== 'crypto') {
      throw new OnramperError(
        OnramperErrorCode.UNSUPPORTED_OPERATION,
        "quoteSell supports an exact 'cryptoAmount' only; quoting for an exact fiat target isn't supported by Onramper's quotes API",
      );
    }
    const cryptoBaseUnits = toBaseUnitBigInt(value);
    const { cryptoDecimals, fiatDecimals } = await this.assetDecimals(options.cryptoAsset, options.fiatCurrency);
    const amount = toDecimalString(cryptoBaseUnits, cryptoDecimals);
    const raw = await this.fetchQuote('sell', options.cryptoAsset, options.fiatCurrency, amount, options.config);
    return toFiatQuote(raw, {
      fiatDecimals,
      cryptoDecimals,
      requestedBaseUnits: cryptoBaseUnits,
      requestedSide: 'crypto',
    });
  }

  /**
   * Builds a signed buy widget URL via `config.signUrl`. The recipient defaults
   * to the wallet account's address when omitted.
   *
   * @param options - The buy widget request (exact fiat spend or exact crypto target).
   * @returns The signed buy widget URL.
   * @throws {OnramperError} `INVALID_ARGUMENT` if both amounts or a non-integer
   *   amount are given, or neither is given; `UNSUPPORTED_ASSET` for an unknown
   *   pair; `UPSTREAM_ERROR` if `config.signUrl` throws.
   */
  async buy(options: OnramperBuyOptions): Promise<BuyResult> {
    const amounts = await this.toWidgetAmounts(options);
    const address = options.recipient ?? (await this.accountAddress());
    return {
      buyUrl: await buildBuyUrl(this.config.signUrl, this.config.apiKey, {
        fiatCurrency: options.fiatCurrency,
        cryptoAsset: options.cryptoAsset,
        ...amounts,
        address,
        config: options.config,
      }),
    };
  }

  /**
   * Builds a signed sell widget URL via `config.signUrl`. The refund address defaults to the account's.
   *
   * @param options - The sell widget request (exact crypto amount or exact fiat target).
   * @returns The signed sell widget URL.
   * @throws {OnramperError} `INVALID_ARGUMENT` if both amounts or a non-integer
   *   amount are given, or neither is given; `UNSUPPORTED_ASSET` for an unknown
   *   pair; `UPSTREAM_ERROR` if `config.signUrl` throws.
   */
  async sell(options: OnramperSellOptions): Promise<SellResult> {
    const amounts = await this.toWidgetAmounts(options);
    const address = options.refundAddress ?? (await this.accountAddress());
    return {
      sellUrl: await buildSellUrl(this.config.signUrl, this.config.apiKey, {
        fiatCurrency: options.fiatCurrency,
        cryptoAsset: options.cryptoAsset,
        ...amounts,
        address,
        config: options.config,
      }),
    };
  }

  /**
   * Reads the session transaction detail. The only session-gated call: requires
   * `getSessionToken` in the config; Onramper resolves buy vs sell server-side.
   *
   * @param txId - The session id returned by the intent call.
   * @returns The transaction detail, with the raw status/hash/provider under `metadata`.
   * @throws {OnramperError} `INVALID_CONFIG` when `getSessionToken` was not
   *   supplied; otherwise mapped from the session call (see `AuthorizedClient.getWithSession`).
   */
  async getTransactionDetail(txId: string): Promise<OnramperTransactionDetail> {
    if (typeof this.config.getSessionToken !== 'function') {
      throw new OnramperError(
        OnramperErrorCode.INVALID_CONFIG,
        'getTransactionDetail requires the getSessionToken callback in OnramperFiatConfig',
      );
    }
    const raw = await this.client.getWithSession<unknown>(this.endpoints.checkoutTransaction(txId));
    return toFiatTransactionDetail(raw);
  }

  /**
   * Public data endpoint; the `GET /supported` payload is TTL-cached and shared with `getSupportedFiatCurrencies`.
   *
   * @returns The supported crypto assets.
   * @throws {OnramperError} Mapped from a non-2xx response (see `OnramperErrorCode`).
   */
  async getSupportedCryptoAssets(): Promise<SupportedCryptoAsset[]> {
    return toSupportedCryptoAssets(await this.fetchSupported());
  }

  /**
   * Public data endpoint; reuses the same TTL-cached `GET /supported` payload as `getSupportedCryptoAssets`.
   *
   * @returns The supported fiat currencies.
   * @throws {OnramperError} Mapped from a non-2xx response (see `OnramperErrorCode`).
   */
  async getSupportedFiatCurrencies(): Promise<SupportedFiatCurrency[]> {
    return toSupportedFiatCurrencies(await this.fetchSupported());
  }

  /**
   * Public data endpoint; the country list is TTL-cached separately from the supported-assets payload.
   *
   * @returns The supported countries.
   * @throws {OnramperError} Mapped from a non-2xx response (see `OnramperErrorCode`).
   */
  async getSupportedCountries(): Promise<SupportedCountry[]> {
    return toSupportedCountries(await this.cached(this.countriesCache, this.endpoints.supportedCountries()));
  }

  /** Reads a default address from the bound wallet account, when there is one. */
  private async accountAddress(): Promise<string | undefined> {
    return this._account ? this._account.getAddress() : undefined;
  }

  /**
   * Resolve the WDK XOR amount: exactly one of `cryptoAmount` / `fiatAmount` must
   * be set. `0` is a valid amount, hence the `!= null` checks rather than truthy.
   *
   * @throws {OnramperError} `INVALID_ARGUMENT` when neither or both are set.
   */
  private static selectAmount(options: AmountInput): AmountSelection {
    const { cryptoAmount, fiatAmount } = options;
    if (cryptoAmount != null && fiatAmount != null) {
      throw new OnramperError(
        OnramperErrorCode.INVALID_ARGUMENT,
        "'cryptoAmount' and 'fiatAmount' cannot both be provided",
      );
    }
    if (cryptoAmount != null) {
      return { side: 'crypto', value: cryptoAmount };
    }
    if (fiatAmount != null) {
      return { side: 'fiat', value: fiatAmount };
    }
    throw new OnramperError(
      OnramperErrorCode.INVALID_ARGUMENT,
      "Either 'cryptoAmount' or 'fiatAmount' must be provided",
    );
  }

  /**
   * Resolve a pair's crypto + fiat decimals from the supported payload in one
   * cached round-trip. Reads the RAW decimals (not the lenient display default)
   * because they scale user funds — an absent value fails loudly rather than
   * silently mis-scaling at a fabricated 18/2.
   *
   * @throws {OnramperError} `UNSUPPORTED_ASSET` when a code is unknown;
   *   `DECODE_ERROR` when a known asset omits its decimals.
   */
  private async assetDecimals(cryptoAsset: string, fiatCurrency: string): Promise<AssetDecimals> {
    const { crypto, fiat } = findSupportedPair(await this.fetchSupported(), cryptoAsset, fiatCurrency);
    if (!crypto || !fiat) {
      throw new OnramperError(OnramperErrorCode.UNSUPPORTED_ASSET, `Unsupported pair: ${cryptoAsset}/${fiatCurrency}`);
    }
    if (!Number.isFinite(crypto.decimals) || !Number.isFinite(fiat.decimals)) {
      throw new OnramperError(OnramperErrorCode.DECODE_ERROR, `Missing decimals for ${cryptoAsset}/${fiatCurrency}`);
    }
    return { cryptoDecimals: crypto.decimals as number, fiatDecimals: fiat.decimals as number };
  }

  /**
   * Validate the WDK amount XOR and convert the provided base-unit amount to the
   * widget's decimal string at that asset's decimals.
   *
   * @throws {OnramperError} `INVALID_ARGUMENT` when neither, both, or a non-integer amount is given.
   */
  private async toWidgetAmounts(options: OnramperBuyOptions | OnramperSellOptions): Promise<WidgetAmounts> {
    const { side, value } = OnramperFiatProtocol.selectAmount(options);
    const base = toBaseUnitBigInt(value);
    const { cryptoDecimals, fiatDecimals } = await this.assetDecimals(options.cryptoAsset, options.fiatCurrency);
    return side === 'crypto'
      ? { cryptoAmount: toDecimalString(base, cryptoDecimals) }
      : { fiatAmount: toDecimalString(base, fiatDecimals) };
  }

  /** Read-through TTL cache over the `GET /supported` payload, shared by the crypto/fiat list methods. */
  private fetchSupported(): Promise<unknown> {
    return this.cached(this.supportedCache, this.endpoints.supported());
  }

  /** Read-through TTL cache over an apiKey-authenticated GET. */
  private async cached(cache: TtlCache<unknown>, url: string): Promise<unknown> {
    const hit = cache.get();
    if (hit !== undefined) {
      return hit;
    }
    const raw = await this.client.getWithApiKey<unknown>(url);
    cache.set(raw);
    return raw;
  }

  /** Builds and issues the `GET /quotes/{source}/{destination}` call with the direction/amount/config query params. */
  private async fetchQuote(
    type: FiatDirection,
    source: string,
    destination: string,
    amount: string,
    config: OnramperRequestConfig | undefined,
  ): Promise<unknown> {
    const url = new URL(this.endpoints.quote(source, destination));
    url.searchParams.set('type', type);
    url.searchParams.set('amount', amount);
    if (config?.paymentMethod) {
      url.searchParams.set('paymentMethod', config.paymentMethod);
    }
    if (config?.networkCode) {
      url.searchParams.set('network', config.networkCode);
    }
    if (config?.country) {
      url.searchParams.set('country', config.country);
    }
    return this.client.getWithApiKey<unknown>(url.toString());
  }
}
