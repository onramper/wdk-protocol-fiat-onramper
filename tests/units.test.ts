import { describe, expect, it } from 'vitest';
import { OnramperError, OnramperErrorCode } from '../src/errors.ts';
import {
  sumToBaseUnits,
  toBaseUnitBigInt,
  toBaseUnits,
  toBaseUnitsOrNull,
  toDecimalString,
} from '../src/utils/units.ts';

describe('units — base-unit ↔ decimal conversion', () => {
  describe('toBaseUnits / toDecimalString round-trips', () => {
    it('converts at 2 / 8 / 18 decimals', () => {
      expect(toBaseUnits('100', 2)).toBe(10_000n);
      expect(toDecimalString(10_000n, 2)).toBe('100');
      expect(toBaseUnits('0.01', 8)).toBe(1_000_000n);
      expect(toDecimalString(1_000_000n, 8)).toBe('0.01');
      expect(toBaseUnits('1.5', 18)).toBe(1_500_000_000_000_000_000n);
      expect(toDecimalString(1_500_000_000_000_000_000n, 18)).toBe('1.5');
    });

    it('round-trips a large bigint without precision loss', () => {
      const big = 123_456_789_012_345_678_901_234_567_890n;
      expect(toBaseUnits(toDecimalString(big, 18), 18)).toBe(big);
    });
  });

  describe('truncation toward zero (never over-credits)', () => {
    it('floors an over-precise decimal, never rounds up', () => {
      expect(toBaseUnits('0.0333333339', 8)).toBe(3_333_333n);
      expect(toBaseUnits('0.999999999999999999999', 18)).toBe(999_999_999_999_999_999n);
    });

    it('toDecimalString floors excess precision', () => {
      expect(toDecimalString(1_999_999_999_999_999_999n, 18)).toBe('1.999999999999999999');
    });
  });

  describe('sumToBaseUnits', () => {
    it('sums decimal fee parts to minor units', () => {
      expect(sumToBaseUnits(['1', '2'], 2)).toBe(300n);
      expect(sumToBaseUnits([1, 2.5], 2)).toBe(350n);
    });
    it('treats missing / non-finite entries as zero', () => {
      expect(sumToBaseUnits([undefined, undefined], 2)).toBe(0n);
      expect(sumToBaseUnits(['1', 'not-a-number'], 2)).toBe(100n);
    });
    it('floors a sub-unit total toward zero', () => {
      expect(sumToBaseUnits(['0.005'], 2)).toBe(0n);
    });
  });

  describe('toBaseUnitBigInt', () => {
    const expectRejected = (amount: number | bigint): void => {
      let err: unknown;
      try {
        toBaseUnitBigInt(amount);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(OnramperError);
      expect((err as OnramperError).code).toBe(OnramperErrorCode.INVALID_ARGUMENT);
    };

    it('passes bigints through and accepts safe integer numbers (including 0)', () => {
      expect(toBaseUnitBigInt(0n)).toBe(0n);
      expect(toBaseUnitBigInt(0)).toBe(0n);
      expect(toBaseUnitBigInt(10_000)).toBe(10_000n);
      expect(toBaseUnitBigInt(10_000n)).toBe(10_000n);
    });

    it('accepts the largest safe integer and arbitrarily large bigints', () => {
      expect(toBaseUnitBigInt(Number.MAX_SAFE_INTEGER)).toBe(9_007_199_254_740_991n);
      // A whole 18-decimal token exceeds 2^53, so it can only be passed as a bigint.
      expect(toBaseUnitBigInt(10n ** 18n)).toBe(1_000_000_000_000_000_000n);
      expect(toBaseUnitBigInt(123_456_789_012_345_678_901_234_567_890n)).toBe(123_456_789_012_345_678_901_234_567_890n);
    });

    it('rejects a non-integer / NaN / Infinity number with INVALID_ARGUMENT (not a raw RangeError)', () => {
      for (const bad of [100.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expectRejected(bad);
      }
    });

    it('rejects unsafe-integer numbers instead of silently encoding the rounded double', () => {
      // Number.isInteger accepts all of these; none is a safe integer, so each
      // must be passed as a bigint. 2**53 and 1e18 happen to be exactly
      // representable but are still rejected (the guard doesn't special-case
      // which doubles are exact); Number('1234567890123456789') genuinely rounds
      // to 1234567890123456800, which BigInt() would otherwise encode silently.
      for (const bad of [Number.MAX_SAFE_INTEGER + 1, 2 ** 53, 1e18, Number('1234567890123456789')]) {
        expectRejected(bad);
      }
    });

    it('rejects negative amounts of either type', () => {
      expectRejected(-1);
      expectRejected(-1n);
    });
  });

  describe('toBaseUnitsOrNull', () => {
    it('parses finite decimals like toBaseUnits', () => {
      expect(toBaseUnitsOrNull('0.033', 18)).toBe(33_000_000_000_000_000n);
      expect(toBaseUnitsOrNull(300, 2)).toBe(30_000n);
    });
    it('floors a sub-unit decimal to 0n', () => {
      expect(toBaseUnitsOrNull('0.004', 2)).toBe(0n);
    });
    it('returns null for missing / non-finite / non-numeric input', () => {
      expect(toBaseUnitsOrNull(undefined, 2)).toBeNull();
      expect(toBaseUnitsOrNull('N/A', 2)).toBeNull();
      expect(toBaseUnitsOrNull('Infinity', 2)).toBeNull();
      expect(toBaseUnitsOrNull('NaN', 2)).toBeNull();
    });
  });

  it('handles zero-decimal assets', () => {
    expect(toBaseUnits('5', 0)).toBe(5n);
    expect(toDecimalString(5n, 0)).toBe('5');
    expect(toBaseUnitsOrNull('5', 0)).toBe(5n);
  });
});
