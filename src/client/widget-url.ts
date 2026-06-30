import { OnramperError, OnramperErrorCode } from '../errors/index.ts';
import type { SignUrl, SignUrlParams } from '../types/onramper.ts';
import type { OnramperRequestConfig } from '../types/wdk.ts';

/**
 * buy()/sell() hand off to the consumer's `signUrl` callback, whose backend
 * builds and signs the widget URL (the signing key never reaches the client),
 * mirroring @tetherto/wdk-protocol-fiat-moonpay. Amounts here are already decimal
 * strings — the protocol converts the WDK base-unit inputs using each asset's
 * decimals before calling in.
 */
interface WidgetUrlInput {
  fiatCurrency: string;
  cryptoAsset: string;
  /** Decimal amount string, already converted from base units. */
  fiatAmount?: string;
  cryptoAmount?: string;
  /** Recipient (buy) or refund (sell) address; omitted when none is known. */
  address?: string;
  config?: OnramperRequestConfig;
}

function toParams(direction: 'buy' | 'sell', apiKey: string, input: WidgetUrlInput): SignUrlParams {
  return {
    direction,
    apiKey,
    fiatCurrency: input.fiatCurrency,
    cryptoAsset: input.cryptoAsset,
    fiatAmount: input.fiatAmount,
    cryptoAmount: input.cryptoAmount,
    address: input.address,
    networkCode: input.config?.networkCode,
    memo: input.config?.memo,
    paymentMethod: input.config?.paymentMethod,
    country: input.config?.country,
    quoteId: input.config?.quoteId,
  };
}

/**
 * Invoke the partner `signUrl` callback, keeping the SDK's typed-error contract:
 * a thrown `OnramperError` passes through; anything else (the partner backend's
 * own failure) is wrapped as `UPSTREAM_ERROR`, preserving the cause — the same
 * discipline applied to the `getSessionToken` callback.
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

/** Builds the signed buy widget URL via the consumer's `signUrl` callback. */
export async function buildBuyUrl(signUrl: SignUrl, apiKey: string, input: WidgetUrlInput): Promise<string> {
  return sign(signUrl, toParams('buy', apiKey, input));
}

/** Builds the signed sell widget URL via the consumer's `signUrl` callback. */
export async function buildSellUrl(signUrl: SignUrl, apiKey: string, input: WidgetUrlInput): Promise<string> {
  return sign(signUrl, toParams('sell', apiKey, input));
}
