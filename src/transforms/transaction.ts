import type { FiatTransactionStatus, OnramperTransactionDetail } from '../types/wdk.ts';
import { toOptionalString } from '../utils/format.ts';

/**
 * Shape from `GET /checkout/session/{sessionId}/transaction`: a `{valid,
 * transactionInformation}` envelope where `transactionInformation` is an open,
 * provider-specific record. The mapping is defensive — known aliases are tried
 * in order and anything missing degrades rather than throws.
 */
interface RawTransaction {
  /** Currently unused by the mapping; kept for shape documentation. */
  transactionId?: string;
  /** Raw provider status string, normalised by {@link normaliseStatus}. */
  status?: string;
  /** Preferred crypto-asset field. */
  cryptoAsset?: string;
  /** Fallback crypto-asset field, used only when `cryptoAsset` is absent. */
  crypto?: string;
  /** Preferred fiat-currency field. */
  fiatCurrency?: string;
  /** Fallback fiat-currency field, used only when `fiatCurrency` is absent. */
  fiat?: string;
  /** Provider-reported fiat amount, in major units. */
  fiatAmount?: number | string;
  /** Provider-reported crypto amount, in major units. */
  cryptoAmount?: number | string;
  /** On-chain transaction hash, once settled. */
  txHash?: string;
  /** Preferred provider-name field. */
  provider?: string;
  /** First fallback provider-name field, used only when `provider` is absent. */
  ramp?: string;
  /** Second fallback provider-name field, used only when `provider` and `ramp` are absent. */
  onramp?: string;
}

/**
 * Collapse provider status strings into the WDK's three states. Anything not
 * explicitly succeeded or failed is treated as still in progress — matching
 * @tetherto/wdk-protocol-fiat-moonpay's default, so a new in-flight status does
 * not error a pollable transaction. The raw string is preserved under
 * `metadata.status`, so an unmapped (possibly terminal) value stays inspectable.
 * `expired` maps to `failed`: a lapsed ramp never completes.
 *
 * @param raw - The provider's raw status string.
 * @returns The normalised WDK transaction status.
 */
function normaliseStatus(raw: string | undefined): FiatTransactionStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'completed':
    case 'success':
    case 'paid':
      return 'completed';
    case 'failed':
    case 'declined':
    case 'cancelled':
    case 'canceled':
    case 'expired':
      return 'failed';
    default:
      return 'in_progress';
  }
}

/**
 * Map a `GET /checkout/session/{sessionId}/transaction` envelope onto the WDK
 * `FiatTransactionDetail` (status + asset + currency), with the raw status, hash,
 * provider and resolved amounts surfaced under `metadata`. Field aliases
 * (cryptoAsset/crypto, fiatCurrency/fiat, provider/ramp/onramp) are resolved in
 * that order — the first field listed wins when both are present. If the
 * response carries no `transactionInformation` envelope, `raw` itself is tried
 * as the transaction record before falling back to an empty object.
 *
 * @param raw - The raw session-transaction response body.
 * @returns The mapped transaction detail.
 */
export function toFiatTransactionDetail(raw: unknown): OnramperTransactionDetail {
  const envelope = raw as { transactionInformation?: RawTransaction } | undefined;
  const tx = envelope?.transactionInformation ?? (raw as RawTransaction) ?? {};
  return {
    status: normaliseStatus(tx.status),
    cryptoAsset: tx.cryptoAsset ?? tx.crypto ?? '',
    fiatCurrency: tx.fiatCurrency ?? tx.fiat ?? '',
    metadata: {
      status: tx.status,
      txHash: tx.txHash,
      provider: tx.provider ?? tx.ramp ?? tx.onramp,
      fiatAmount: toOptionalString(tx.fiatAmount),
      cryptoAmount: toOptionalString(tx.cryptoAmount),
    },
  };
}
