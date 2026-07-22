import BigNumber from 'bignumber.js';
import { OnramperError, OnramperErrorCode } from '../errors.ts';

/**
 * Convert a provider's decimal amount (e.g. `"1.5"` ETH) to a base-unit integer
 * (e.g. `1500000000000000000n`) using the asset's on-chain / minor-unit
 * `decimals`. Truncates toward zero so rounding never over-credits the user.
 *
 * @param decimalAmount - The decimal amount, in major units.
 * @param decimals - The asset's base-unit decimal places.
 * @returns The amount as a base-unit integer.
 * @throws {SyntaxError} When `decimalAmount` is missing, non-finite, or not
 *   numeric (e.g. `"N/A"`) — `BigInt()` rejects the resulting `"NaN"` string.
 *   Use {@link toBaseUnitsOrNull} to handle that case without a try/catch.
 */
export function toBaseUnits(decimalAmount: number | string, decimals: number): bigint {
  return BigInt(new BigNumber(decimalAmount).shiftedBy(decimals).toFixed(0, BigNumber.ROUND_DOWN));
}

/**
 * Like {@link toBaseUnits} but total: returns `null` for a missing, non-finite,
 * or non-numeric value (e.g. `"N/A"`, `"Infinity"`, `"NaN"`) instead of throwing,
 * so a caller can skip a degenerate quote rather than crash on `BigInt("NaN")`.
 * A finite sub-unit decimal still floors to `0n` — the caller decides whether `0`
 * is acceptable.
 *
 * @param value - The decimal amount, in major units, or `undefined`.
 * @param decimals - The asset's base-unit decimal places.
 * @returns The amount as a base-unit integer, or `null` if `value` can't be converted.
 */
export function toBaseUnitsOrNull(value: number | string | undefined, decimals: number): bigint | null {
  if (value == null) {
    return null;
  }
  const n = new BigNumber(value);
  if (!n.isFinite()) {
    return null;
  }
  return BigInt(n.shiftedBy(decimals).toFixed(0, BigNumber.ROUND_DOWN));
}

/**
 * Convert a base-unit integer amount (e.g. `10000n` cents) to the decimal string
 * the quotes API and widget expect (e.g. `"100"`), at the asset's `decimals`.
 * Truncates excess precision toward zero and emits no trailing zeros.
 *
 * @param baseUnits - The base-unit amount.
 * @param decimals - The asset's base-unit decimal places.
 * @returns The decimal string, in major units.
 */
export function toDecimalString(baseUnits: bigint | number | string, decimals: number): string {
  return new BigNumber(baseUnits.toString())
    .shiftedBy(-decimals)
    .decimalPlaces(decimals, BigNumber.ROUND_DOWN)
    .toFixed();
}

/**
 * Sum a set of decimal amounts (e.g. network + transaction fees) and convert the
 * total to a base-unit integer at `decimals`. Missing or non-finite entries
 * count as zero so a partial fee payload never throws. Truncates toward zero.
 *
 * @param decimalAmounts - The decimal amounts to sum, in major units.
 * @param decimals - The fiat currency's minor-unit decimal places.
 * @returns The summed amount as a base-unit integer.
 */
export function sumToBaseUnits(decimalAmounts: (number | string | undefined)[], decimals: number): bigint {
  const total = decimalAmounts.reduce<BigNumber>((acc, value) => {
    const n = new BigNumber(value ?? 0);
    return acc.plus(n.isFinite() ? n : 0);
  }, new BigNumber(0));
  return BigInt(total.shiftedBy(decimals).toFixed(0, BigNumber.ROUND_DOWN));
}

/**
 * Coerce a WDK base/minor-unit amount (`number | bigint`) to a bigint. Amounts
 * are whole, non-negative base units. A `number` must be a *safe* integer:
 * `Number.isInteger` alone admits values at or above `2^53`, where adjacent
 * integers are no longer distinctly representable as doubles, so `BigInt()` could
 * encode a rounded value with no error — oversized amounts must be passed as a
 * `bigint`. Out-of-contract input fails with a typed OnramperError rather than a
 * raw `RangeError` from `BigInt()` (quote path) or a silently truncated widget
 * amount (buy/sell).
 *
 * @param amount - The WDK base/minor-unit amount.
 * @returns `amount` as a bigint.
 * @throws {OnramperError} `INVALID_ARGUMENT` for a `number` that is not a safe
 *   integer (fractional, NaN, Infinity, or magnitude above
 *   `Number.MAX_SAFE_INTEGER`), or for a negative amount of either type.
 */
export function toBaseUnitBigInt(amount: number | bigint): bigint {
  if (typeof amount === 'number' && !Number.isSafeInteger(amount)) {
    throw new OnramperError(
      OnramperErrorCode.INVALID_ARGUMENT,
      `Amount must be a safe-integer number of base/minor units (pass a bigint above Number.MAX_SAFE_INTEGER); received ${amount}`,
    );
  }
  const value = BigInt(amount);
  if (value < 0n) {
    throw new OnramperError(
      OnramperErrorCode.INVALID_ARGUMENT,
      `Amount must be a non-negative number of base/minor units; received ${amount}`,
    );
  }
  return value;
}
