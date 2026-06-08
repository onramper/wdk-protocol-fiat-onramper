import { channelForRuntime, detectRuntime, resolveAdapters } from '../adapters/index.ts';
import { Endpoints } from '../client/endpoints.ts';
import { AuthorizedClient } from '../client/http-client.ts';
import { SessionManager } from '../client/session-manager.ts';
import { buildBuyUrl, buildSellUrl } from '../client/widget-url.ts';
import { DEFAULT_CACHE_TIME_MS, ENVIRONMENT_URLS } from '../config/defaults.ts';
import { validateConfig } from '../config/schema.ts';
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
 * Two distinct paths by design:
 *   - `buy`/`sell` build a Security V2 signed widget deep link via the consumer's
 *     `signUrl` callback — no backend call, no session.
 *   - `quote*` / `getSupported*` / `getTransactionDetail` are authenticated data
 *     calls gated by a Tier-1 (non-attested) session token + DPoP envelope.
 */
export class OnramperFiatProtocol implements IFiatProtocol {
  private readonly config: OnramperFiatConfig;
  private readonly endpoints: Endpoints;
  private readonly client: AuthorizedClient;
  private readonly supportedCache: TtlCache<unknown>;

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
      getSessionToken: config.getSessionToken,
    });
    this.client = new AuthorizedClient({ adapters, session, apiKey: config.apiKey, channel });
    this.supportedCache = new TtlCache<unknown>(config.cacheTime ?? DEFAULT_CACHE_TIME_MS);

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

  async buy(options: BuyOptions): Promise<BuyResult> {
    return { buyUrl: await buildBuyUrl(this.config.signUrl, this.config.apiKey, options) };
  }

  async sell(options: SellOptions): Promise<SellResult> {
    return { sellUrl: await buildSellUrl(this.config.signUrl, this.config.apiKey, options) };
  }

  async getTransactionDetail(txId: string, _direction?: FiatDirection): Promise<FiatTransactionDetail> {
    const raw = await this.client.getJson<unknown>(this.endpoints.transaction(txId));
    return toFiatTransactionDetail(raw);
  }

  async getSupportedCryptoAssets(): Promise<SupportedCryptoAsset[]> {
    return toSupportedCryptoAssets(await this.fetchSupported());
  }

  async getSupportedFiatCurrencies(): Promise<SupportedFiatCurrency[]> {
    return toSupportedFiatCurrencies(await this.fetchSupported());
  }

  async getSupportedCountries(): Promise<SupportedCountry[]> {
    return toSupportedCountries(await this.fetchSupported());
  }

  private async fetchSupported(): Promise<unknown> {
    const cached = this.supportedCache.get();
    if (cached !== undefined) {
      return cached;
    }
    const raw = await this.client.getJson<unknown>(this.endpoints.supported());
    this.supportedCache.set(raw);
    return raw;
  }

  private async fetchQuote(
    type: FiatDirection,
    source: string,
    destination: string,
    amount: number | string,
    options: { networkCode?: string; paymentMethod?: string; country?: string },
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
    return this.client.getJson<unknown>(url.toString());
  }
}
