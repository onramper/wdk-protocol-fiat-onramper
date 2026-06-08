import type { FiatTransactionDetail, FiatTxStatus } from '../types/wdk.ts';

/**
 * Shape from the transactions endpoint. NOTE: confirm field names and the
 * provider status vocabulary against the live transactions/responses API during
 * verification.
 */
interface RawTransaction {
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

function str(value: number | string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'number' ? String(value) : value;
}

export function toFiatTransactionDetail(raw: unknown): FiatTransactionDetail {
  const tx = (raw as RawTransaction) ?? {};
  return {
    status: normaliseStatus(tx.status),
    cryptoAsset: tx.cryptoAsset ?? tx.crypto ?? '',
    fiatCurrency: tx.fiatCurrency ?? tx.fiat ?? '',
    fiatAmount: str(tx.fiatAmount),
    cryptoAmount: str(tx.cryptoAmount),
    txHash: tx.txHash,
    provider: tx.provider ?? tx.ramp,
  };
}
