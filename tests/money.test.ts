import { describe, expect, it } from 'vitest';
import {
  clampMinor,
  formatBDT,
  fromMinor,
  percentOfMinor,
  sumMinor,
  toMinor,
} from '../src/lib/money';

describe('money helpers', () => {
  it('converts taka to integer paisa', () => {
    expect(toMinor(890)).toBe(89000);
    expect(toMinor(890.5)).toBe(89050);
    expect(toMinor(0.1)).toBe(10);
  });

  it('converts paisa back to taka', () => {
    expect(fromMinor(89050)).toBe(890.5);
    expect(fromMinor(0)).toBe(0);
  });

  it('formats paisa as BDT with two decimals', () => {
    expect(formatBDT(89050)).toBe('৳890.50');
    expect(formatBDT(89000)).toBe('৳890.00');
  });

  it('applies a percentage to a minor amount, half-up', () => {
    expect(percentOfMinor(100000, 10)).toBe(10000);
    expect(percentOfMinor(99999, 12.5)).toBe(12500);
  });

  it('sums minor-unit amounts', () => {
    expect(sumMinor([100, 200, 50])).toBe(350);
    expect(sumMinor([])).toBe(0);
  });

  it('clamps negative totals to zero', () => {
    expect(clampMinor(-50)).toBe(0);
    expect(clampMinor(123.4)).toBe(123);
  });
});
