import { channelForRuntime, detectRuntime, resolveAdapters } from '../adapters/index.ts';
import { Endpoints } from '../client/endpoints.ts';
import { AuthorizedClient } from '../client/http-client.ts';
import { SessionManager } from '../client/session-manager.ts';
import { buildBuyUrl, buildSellUrl } from '../client/widget-url.ts';
import { DEFAULT_CACHE_TIME_MS, ENVIRONMENT_URLS } from '../config/defaults.ts';
import { validateConfig } from '../config/schema.ts';
import { OnramperError, OnramperErrorCode } from '../errors/index.ts';
import { toFiatQuote } from '../transforms/quote.ts';
import { toSupportedCountries, toSupportedCryptoAssets, toSupportedFiatCurrencies } from '../transforms/supported.ts';
import { toFiatTransactionDetail } from '../transforms/transaction.ts';
import type { OnramperChannel, OnramperFiatConfig, WdkAccount } from '../types/onramper.ts';
import type {
  BuyOptions,
  BuyResult,
  FiatDirection,
  FiatQuote,
  FiatTransactionDetail,
  IFiatProtocol,
  QuoteBuyOptions,
  QuoteSellOptions,
  SellOptions,
  SellResult,
  SupportedCountry,
  SupportedCryptoAsset,
  SupportedFiatCurrency,
} from '../types/wdk.ts';
import { TtlCache } from '../utils/cache.ts';

/**
 * Onramper's implementation of the Tether WDK `IFiatProtocol`.
 *
 * Three distinct paths by design:
 *   - `buy`/`sell` build a request signing signed widget deep link via the consumer's
 *     `signUrl` callback — no backend call, no session.
 *   - `quote*` / `getSupported*` hit the existing public data endpoints with the
 *     publishable apiKey alone — no session.
 *   - `getTransactionDetail` reads the checkout session session transaction and is the
 *     one call gated by a session token + DPoP envelope (requires
 *     `getSessionToken` in the config).
 *
 * @see https://www.rfc-editor.org/rfc/rfc9449 (DPoP) for the session-token envelope
 * @see {@link IFiatProtocol} for the WDK contract this implements
 */
export class OnramperFiatProtocol implements IFiatProtocol {
  private readonly config: OnramperFiatConfig;
  private readonly endpoints: Endpoints;
  private readonly client: AuthorizedClient;
  private readonly supportedCache: TtlCache<unknown>;
  private readonly countriesCache: TtlCache<unknown>;

  constructor(account: WdkAccount | undefined, config: OnramperFiatConfig) {
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

    // `account` is accepted for WDK signature parity and reserved for deriving a
    // default recipient/refund address (wired in a later phase).
    void account;
  }

  async quoteBuy(options: QuoteBuyOptions): Promise<FiatQuote> {
    const raw = await this.fetchQuote('buy', options.fiatCurrency, options.cryptoAsset, options.fiatAmount, options);
    return toFiatQuote(raw, {
      direction: 'buy',
      fiatCurrency: options.fiatCurrency,
      cryptoAsset: options.cryptoAsset,
      fiatAmount: String(options.fiatAmount),
    });
  }

  async quoteSell(options: QuoteSellOptions): Promise<FiatQuote> {
    const raw = await this.fetchQuote('sell', options.cryptoAsset, options.fiatCurrency, options.cryptoAmount, options);
    return toFiatQuote(raw, {
      direction: 'sell',
      fiatCurrency: options.fiatCurrency,
      cryptoAsset: options.cryptoAsset,
      cryptoAmount: String(options.cryptoAmount),
    });
  }

  /** Builds a request signing signed buy widget URL via `config.signUrl`. No backend call. */
  async buy(options: BuyOptions): Promise<BuyResult> {
    return { buyUrl: await buildBuyUrl(this.config.signUrl, this.config.apiKey, options) };
  }

  /** Builds a request signing signed sell widget URL via `config.signUrl`. No backend call. */
  async sell(options: SellOptions): Promise<SellResult> {
    return { sellUrl: await buildSellUrl(this.config.signUrl, this.config.apiKey, options) };
  }

  /**
   * Reads the checkout session session transaction detail. The only session-gated
   * call: requires `getSessionToken` in the config.
   *
   * @param txId - The checkout session session id returned by the intent call.
   * @throws {OnramperError} With code `OnramperErrorCode.INVALID_CONFIG` when the
   *   `getSessionToken` callback was not supplied in `OnramperFiatConfig`.
   */
  async getTransactionDetail(txId: string, _direction?: FiatDirection): Promise<FiatTransactionDetail> {
    if (typeof this.config.getSessionToken !== 'function') {
      throw new OnramperError(
        OnramperErrorCode.INVALID_CONFIG,
        'getTransactionDetail requires the getSessionToken callback in OnramperFiatConfig',
      );
    }
    const raw = await this.client.getWithSession<unknown>(this.endpoints.checkoutTransaction(txId));
    return toFiatTransactionDetail(raw);
  }

  /** Public data endpoint; the `GET /supported` payload is TTL-cached and shared with `getSupportedFiatCurrencies`. */
  async getSupportedCryptoAssets(): Promise<SupportedCryptoAsset[]> {
    return toSupportedCryptoAssets(await this.fetchSupported());
  }

  /** Public data endpoint; reuses the same TTL-cached `GET /supported` payload as `getSupportedCryptoAssets`. */
  async getSupportedFiatCurrencies(): Promise<SupportedFiatCurrency[]> {
    return toSupportedFiatCurrencies(await this.fetchSupported());
  }

  /** Public data endpoint; the country list is TTL-cached separately from the supported-assets payload. */
  async getSupportedCountries(): Promise<SupportedCountry[]> {
    return toSupportedCountries(await this.cached(this.countriesCache, this.endpoints.supportedCountries()));
  }

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

  private async fetchQuote(
    type: FiatDirection,
    source: string,
    destination: string,
    amount: number | string,
    options: Pick<QuoteBuyOptions, 'networkCode' | 'paymentMethod' | 'country'>,
  ): Promise<unknown> {
    const url = new URL(this.endpoints.quote(source, destination));
    url.searchParams.set('type', type);
    url.searchParams.set('amount', String(amount));
    if (options.paymentMethod) {
      url.searchParams.set('paymentMethod', options.paymentMethod);
    }
    if (options.networkCode) {
      url.searchParams.set('network', options.networkCode);
    }
    if (options.country) {
      url.searchParams.set('country', options.country);
    }
    return this.client.getWithApiKey<unknown>(url.toString());
  }
}
