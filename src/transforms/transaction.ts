import type { FiatTransactionStatus, OnramperTransactionDetail } from '../types/wdk.ts';
import { toOptionalString } from '../utils/coerce.ts';

/**
 * Shape from `GET /checkout/session/{sessionId}/transaction`: a `{valid,
 * transactionInformation}` envelope where `transactionInformation` is an open,
 * provider-specific record. The mapping is defensive — known aliases are tried
 * in order and anything missing degrades rather than throws.
 */
interface RawTransaction {
  transactionId?: string;
  status?: string;
  cryptoAsset?: string;
  crypto?: string;
  fiatCurrency?: string;
  fiat?: string;
  fiatAmount?: number | string;
  cryptoAmount?: number | string;
  txHash?: string;
  provider?: string;
  ramp?: string;
  onramp?: string;
}

/**
 * Collapse provider status strings into the WDK's three states. Anything not
 * explicitly succeeded or failed is treated as still in progress — matching
 * @tetherto/wdk-protocol-fiat-moonpay's default, so a new in-flight status does
 * not error a pollable transaction. The raw string is preserved under
 * `metadata.status`, so an unmapped (possibly terminal) value stays inspectable.
 * `expired` maps to `failed`: a lapsed ramp never completes.
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
 * (crypto/cryptoAsset, fiat/fiatCurrency, provider/ramp/onramp) are resolved in
 * order.
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
