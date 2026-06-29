import type { FiatTransactionDetail, FiatTxStatus } from '../types/wdk.ts';
import { toOptionalString } from '../utils/coerce.ts';

/**
 * Shape from `GET /checkout/session/{sessionId}/transaction`: a `{valid,
 * transactionInformation}` envelope where `transactionInformation` is an open,
 * provider-specific record. The mapping is defensive: known aliases are tried
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

/** Normalise provider-specific status strings into the WDK status vocabulary. */
function normaliseStatus(raw: string | undefined): FiatTxStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'completed':
    case 'success':
    case 'paid':
      return 'completed';
    case 'failed':
    case 'declined':
    case 'cancelled':
    case 'canceled':
      return 'failed';
    case 'expired':
      return 'expired';
    case 'pending':
    case 'new':
    case 'created':
      return 'pending';
    case 'processing':
    case 'in_progress':
    case 'inprogress':
      return 'processing';
    default:
      return 'unknown';
  }
}

/**
 * Maps a `GET /checkout/session/{sessionId}/transaction` envelope to a WDK
 * `FiatTransactionDetail`, normalising provider status and resolving field
 * aliases (crypto/cryptoAsset, fiat/fiatCurrency, provider/ramp/onramp).
 */
export function toFiatTransactionDetail(raw: unknown): FiatTransactionDetail {
  const envelope = raw as { transactionInformation?: RawTransaction } | undefined;
  const tx = envelope?.transactionInformation ?? (raw as RawTransaction) ?? {};
  return {
    status: normaliseStatus(tx.status),
    cryptoAsset: tx.cryptoAsset ?? tx.crypto ?? '',
    fiatCurrency: tx.fiatCurrency ?? tx.fiat ?? '',
    fiatAmount: toOptionalString(tx.fiatAmount),
    cryptoAmount: toOptionalString(tx.cryptoAmount),
    txHash: tx.txHash,
    provider: tx.provider ?? tx.ramp ?? tx.onramp,
  };
}
