import { OnramperError, OnramperErrorCode } from '../errors.ts';
import type { SignUrl, SignUrlParams } from '../types/onramper.ts';
import type { OnramperRequestConfig } from '../types/wdk.ts';

/**
 * buy()/sell() hand off to the consumer's `signUrl` callback, whose backend
 * builds and signs the widget URL (the signing key never reaches the client),
 * mirroring @tetherto/wdk-protocol-fiat-moonpay. Amounts here are already decimal
 * strings — the protocol converts the WDK base-unit inputs using each asset's
 * decimals before calling in.
 */

/** The widget amount, on whichever side the caller specified — decimal strings, already converted from base units. */
type WidgetUrlAmount = { fiatAmount: string; cryptoAmount?: never } | { cryptoAmount: string; fiatAmount?: never };

/** Common (non-amount) fields for a buy/sell widget URL. */
type WidgetUrlCommon = {
  /** The currency's ISO 4217 code (e.g. 'USD'). */
  fiatCurrency: string;
  /** The provider-specific code of the crypto asset. */
  cryptoAsset: string;
  /** Recipient (buy) or refund (sell) address; omitted when none is known. */
  address?: string;
  /** Onramper-specific widget knobs (network, payment method, country, memo, pinned quote). */
  config?: OnramperRequestConfig;
};

type WidgetUrlInput = WidgetUrlCommon & WidgetUrlAmount;

/**
 * Builds the `SignUrlParams` the consumer's `signUrl` callback receives.
 *
 * @param direction - Whether this is a buy or sell widget URL.
 * @param apiKey - The publishable partner API key.
 * @param input - The widget parameters resolved by the protocol layer.
 * @returns The parameters to hand to `signUrl`.
 */
function toParams(direction: 'buy' | 'sell', apiKey: string, input: WidgetUrlInput): SignUrlParams {
  const { fiatAmount, cryptoAmount } = input;
  return {
    direction,
    apiKey,
    fiatCurrency: input.fiatCurrency,
    cryptoAsset: input.cryptoAsset,
    address: input.address,
    networkCode: input.config?.networkCode,
    memo: input.config?.memo,
    paymentMethod: input.config?.paymentMethod,
    country: input.config?.country,
    quoteId: input.config?.quoteId,
    ...(fiatAmount !== undefined ? { fiatAmount } : { cryptoAmount: cryptoAmount as string }),
  };
}

/**
 * Invoke the partner `signUrl` callback, keeping the SDK's typed-error contract:
 * a thrown `OnramperError` passes through; anything else (the partner backend's
 * own failure) is wrapped as `UPSTREAM_ERROR`, preserving the cause — the same
 * discipline applied to the `getSessionToken` callback.
 *
 * @param signUrl - The consumer's signing callback.
 * @param params - The widget parameters to sign.
 * @returns The signed widget URL.
 * @throws {OnramperError} Passes through a thrown `OnramperError` unchanged;
 *   wraps any other thrown value as `UPSTREAM_ERROR`.
 */
async function sign(signUrl: SignUrl, params: SignUrlParams): Promise<string> {
  try {
    return await signUrl(params);
  } catch (err) {
    if (err instanceof OnramperError) {
      throw err;
    }
    throw new OnramperError(OnramperErrorCode.UPSTREAM_ERROR, 'The signUrl callback failed', { cause: err });
  }
}

/**
 * Builds the signed buy widget URL via the consumer's `signUrl` callback.
 *
 * @param signUrl - The consumer's signing callback.
 * @param apiKey - The publishable partner API key.
 * @param input - The buy widget parameters resolved by the protocol layer.
 * @returns The signed buy widget URL.
 * @throws {OnramperError} See {@link sign}.
 */
export async function buildBuyUrl(signUrl: SignUrl, apiKey: string, input: WidgetUrlInput): Promise<string> {
  return sign(signUrl, toParams('buy', apiKey, input));
}

/**
 * Builds the signed sell widget URL via the consumer's `signUrl` callback.
 *
 * @param signUrl - The consumer's signing callback.
 * @param apiKey - The publishable partner API key.
 * @param input - The sell widget parameters resolved by the protocol layer.
 * @returns The signed sell widget URL.
 * @throws {OnramperError} See {@link sign}.
 */
export async function buildSellUrl(signUrl: SignUrl, apiKey: string, input: WidgetUrlInput): Promise<string> {
  return sign(signUrl, toParams('sell', apiKey, input));
}
