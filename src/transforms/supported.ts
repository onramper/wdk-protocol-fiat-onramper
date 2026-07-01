/**
 * Shapes from the supported API. Every response is wrapped in a `{message}`
 * envelope: `GET /supported` carries `{crypto, fiat}`, `GET /supported/countries`
 * carries the country array directly. Mapping stays defensive (an unwrapped
 * payload is also accepted) with sensible fallbacks — default 18 decimals for
 * crypto, 2 for fiat.
 */
import type { SupportedCountry, SupportedCryptoAsset, SupportedFiatCurrency } from '../types/wdk.ts';

/** One crypto entry from `GET /supported`. `code` takes precedence over `id` when both are present. */
interface RawCrypto {
  /** Preferred asset-code field. */
  code?: string;
  /** Fallback asset-code field, used only when `code` is absent. */
  id?: string;
  /** Fallback network field, used only when `networkCode` is absent. */
  network?: string;
  /** Preferred network-code field. */
  networkCode?: string;
  /** On-chain base-unit decimals; defaults to 18 when absent. */
  decimals?: number;
  /** Display name; falls back to `code`/`id` when absent. */
  name?: string;
}

/** One fiat entry from `GET /supported`. `code` takes precedence over `id` when both are present. */
interface RawFiat {
  /** Preferred currency-code field. */
  code?: string;
  /** Fallback currency-code field, used only when `code` is absent. */
  id?: string;
  /** Minor-unit decimals; defaults to 2 when absent. */
  decimals?: number;
  /** Display name; falls back to `code`/`id` when absent. */
  name?: string;
}

/** One entry from `GET /supported/countries`. `countryCode`/`countryName` are the live wire keys; the rest are fallbacks for a future shape change. */
interface RawCountry {
  /** Live wire key for the ISO country code. */
  countryCode?: string;
  /** Live wire key for the country's display name. */
  countryName?: string;
  /** Fallback code field, used only when `countryCode` is absent. */
  code?: string;
  /** Fallback code field, used only when `countryCode` and `code` are absent. */
  id?: string;
  /** Fallback name field, used only when `countryName` is absent. */
  name?: string;
  /** Whether buying is supported; the API doesn't send this field today (see `toSupportedCountries`). */
  isBuyAllowed?: boolean;
  /** Whether selling is supported; the API doesn't send this field today (see `toSupportedCountries`). */
  isSellAllowed?: boolean;
}

/** The `{crypto, fiat}` payload carried by `GET /supported`. */
interface RawSupported {
  /** Supported crypto assets. */
  crypto?: RawCrypto[];
  /** Supported fiat currencies. */
  fiat?: RawFiat[];
}

/**
 * Unwraps the `{message}` envelope every supported-API response carries.
 *
 * @param raw - The raw response body.
 * @returns The `message` payload, or `raw` unchanged if it carries no `message`.
 */
function unwrap(raw: unknown): unknown {
  const message = (raw as { message?: unknown } | undefined)?.message;
  return message !== undefined ? message : raw;
}

/**
 * Maps the `crypto` block of a `GET /supported` payload to WDK crypto-asset descriptors; missing decimals default to 18.
 *
 * @param raw - The raw `GET /supported` response body (wrapped or unwrapped).
 * @returns The supported crypto assets.
 */
export function toSupportedCryptoAssets(raw: unknown): SupportedCryptoAsset[] {
  const list = (unwrap(raw) as RawSupported)?.crypto ?? [];
  return list.map((c) => ({
    code: c.code ?? c.id ?? '',
    networkCode: c.networkCode ?? c.network ?? '',
    decimals: c.decimals ?? 18,
    name: c.name ?? c.code ?? c.id ?? '',
  }));
}

/**
 * Maps the `fiat` block of a `GET /supported` payload to WDK fiat-currency descriptors; missing decimals default to 2.
 *
 * @param raw - The raw `GET /supported` response body (wrapped or unwrapped).
 * @returns The supported fiat currencies.
 */
export function toSupportedFiatCurrencies(raw: unknown): SupportedFiatCurrency[] {
  const list = (unwrap(raw) as RawSupported)?.fiat ?? [];
  return list.map((f) => ({
    code: f.code ?? f.id ?? '',
    decimals: f.decimals ?? 2,
    name: f.name ?? f.code ?? f.id ?? '',
  }));
}

/**
 * Maps a `GET /supported/countries` payload to WDK country descriptors; list presence implies both buy and sell are allowed.
 *
 * @param raw - The raw `GET /supported/countries` response body (wrapped or unwrapped).
 * @returns The supported countries.
 */
export function toSupportedCountries(raw: unknown): SupportedCountry[] {
  const unwrapped = unwrap(raw);
  const list: RawCountry[] = Array.isArray(unwrapped) ? unwrapped : [];
  return list.map((c) => ({
    code: c.countryCode ?? c.code ?? c.id ?? '',
    name: c.countryName ?? c.name ?? c.countryCode ?? c.code ?? c.id ?? '',
    // /supported/countries carries no per-country buy/sell flags — presence in the
    // list means supported, so both default on.
    isBuyAllowed: c.isBuyAllowed ?? true,
    isSellAllowed: c.isSellAllowed ?? true,
  }));
}

/** The real (undefaulted) decimals for a crypto/fiat pair, when each side was found. */
export interface SupportedPairDecimals {
  /** The matched crypto entry's real decimals; absent if the crypto code is unsupported. */
  crypto?: Pick<RawCrypto, 'decimals'>;
  /** The matched fiat entry's real decimals; absent if the fiat code is unsupported. */
  fiat?: Pick<RawFiat, 'decimals'>;
}

/**
 * Look up the raw crypto + fiat entries for a pair in a `GET /supported` payload,
 * WITHOUT the display defaults the mapping functions apply. The money path (amount
 * conversion) must use each asset's real `decimals` or fail — a fabricated 18/2
 * would silently mis-scale user funds.
 *
 * @param raw - The raw `GET /supported` response body (wrapped or unwrapped).
 * @param cryptoCode - The crypto asset code to look up.
 * @param fiatCode - The fiat currency code to look up.
 * @returns The matched entries; either side is absent if its code is unsupported.
 */
export function findSupportedPair(raw: unknown, cryptoCode: string, fiatCode: string): SupportedPairDecimals {
  const supported = (unwrap(raw) as RawSupported) ?? {};
  const crypto = (supported.crypto ?? []).find((c) => (c.code ?? c.id) === cryptoCode);
  const fiat = (supported.fiat ?? []).find((f) => (f.code ?? f.id) === fiatCode);
  return { crypto, fiat };
}
