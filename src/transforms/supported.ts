import type { SupportedCountry, SupportedCryptoAsset, SupportedFiatCurrency } from '../types/wdk.ts';

/**
 * Shapes from the supported API. Every response is wrapped in a `{message}`
 * envelope: `GET /supported` carries `{crypto, fiat}`, `GET /supported/countries`
 * carries the country array directly. Mapping stays defensive (an unwrapped
 * payload is also accepted) with sensible fallbacks — default 18 decimals for
 * crypto, 2 for fiat.
 */
interface RawCrypto {
  code?: string;
  id?: string;
  network?: string;
  networkCode?: string;
  decimals?: number;
  name?: string;
}

interface RawFiat {
  code?: string;
  id?: string;
  decimals?: number;
  name?: string;
}

interface RawCountry {
  // The live wire keys are `countryCode`/`countryName`; the rest are accepted as
  // fallbacks so a future shape change degrades instead of blanking every entry.
  countryCode?: string;
  countryName?: string;
  code?: string;
  id?: string;
  name?: string;
  isBuyAllowed?: boolean;
  isSellAllowed?: boolean;
}

interface RawSupported {
  crypto?: RawCrypto[];
  fiat?: RawFiat[];
}

function unwrap(raw: unknown): unknown {
  const message = (raw as { message?: unknown } | undefined)?.message;
  return message !== undefined ? message : raw;
}

export function toSupportedCryptoAssets(raw: unknown): SupportedCryptoAsset[] {
  const list = (unwrap(raw) as RawSupported)?.crypto ?? [];
  return list.map((c) => ({
    code: c.code ?? c.id ?? '',
    networkCode: c.networkCode ?? c.network ?? '',
    decimals: c.decimals ?? 18,
    name: c.name ?? c.code ?? c.id ?? '',
  }));
}

export function toSupportedFiatCurrencies(raw: unknown): SupportedFiatCurrency[] {
  const list = (unwrap(raw) as RawSupported)?.fiat ?? [];
  return list.map((f) => ({
    code: f.code ?? f.id ?? '',
    decimals: f.decimals ?? 2,
    name: f.name ?? f.code ?? f.id ?? '',
  }));
}

export function toSupportedCountries(raw: unknown): SupportedCountry[] {
  const unwrapped = unwrap(raw);
  const list: RawCountry[] = Array.isArray(unwrapped) ? unwrapped : [];
  return list.map((c) => ({
    code: c.countryCode ?? c.code ?? c.id ?? '',
    name: c.countryName ?? c.name ?? c.code ?? c.id ?? '',
    // /supported/countries carries no per-country buy/sell flags — presence in the
    // list means supported, so both default on.
    isBuyAllowed: c.isBuyAllowed ?? true,
    isSellAllowed: c.isSellAllowed ?? true,
  }));
}
