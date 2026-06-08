import type { SupportedCountry, SupportedCryptoAsset, SupportedFiatCurrency } from '../types/wdk.ts';

/**
 * Shapes from the `/supported` endpoint. NOTE: confirm field names against the
 * live supported API during verification; mapping is defensive with sensible
 * fallbacks (e.g. default 18 decimals for crypto, 2 for fiat).
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
  code?: string;
  name?: string;
  isBuyAllowed?: boolean;
  isSellAllowed?: boolean;
}

interface RawSupported {
  crypto?: RawCrypto[];
  fiat?: RawFiat[];
  countries?: RawCountry[];
}

export function toSupportedCryptoAssets(raw: unknown): SupportedCryptoAsset[] {
  const list = (raw as RawSupported)?.crypto ?? [];
  return list.map((c) => ({
    code: c.code ?? c.id ?? '',
    networkCode: c.networkCode ?? c.network ?? '',
    decimals: c.decimals ?? 18,
    name: c.name ?? c.code ?? c.id ?? '',
  }));
}

export function toSupportedFiatCurrencies(raw: unknown): SupportedFiatCurrency[] {
  const list = (raw as RawSupported)?.fiat ?? [];
  return list.map((f) => ({
    code: f.code ?? f.id ?? '',
    decimals: f.decimals ?? 2,
    name: f.name ?? f.code ?? f.id ?? '',
  }));
}

export function toSupportedCountries(raw: unknown): SupportedCountry[] {
  const list = (raw as RawSupported)?.countries ?? [];
  return list.map((c) => ({
    code: c.code ?? '',
    name: c.name ?? c.code ?? '',
    isBuyAllowed: c.isBuyAllowed ?? true,
    isSellAllowed: c.isSellAllowed ?? true,
  }));
}
