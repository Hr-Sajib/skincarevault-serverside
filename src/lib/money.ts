/**
 * Money handling for the whole API.
 *
 * Every amount stored in MongoDB is an integer number of paisa.
 * 89000 is BDT 890.00. No float ever touches a price — not in the database,
 * not in a total, not in a discount. These are the only functions permitted
 * to cross between the minor unit and a human-facing number.
 */

/** Taka (possibly fractional) -> paisa. `890.5` -> `89050`. */
export const toMinor = (taka: number): number => Math.round(taka * 100);

/** Paisa -> taka as a number, for display only. `89050` -> `890.5`. */
export const fromMinor = (paisa: number): number => paisa / 100;

/** Paisa -> a display string. `89050` -> `"৳890.50"`. */
export const formatBDT = (paisa: number): string =>
  `৳${(paisa / 100).toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Applies a percentage to a minor-unit amount, rounding half-up to the paisa.
 * Used for percent coupons, where `basisPoints` avoids a float percentage:
 * 12.5% is 1250 basis points.
 */
export const percentOfMinor = (amountMinor: number, percent: number): number =>
  Math.round((amountMinor * percent) / 100);

/** Sums minor-unit amounts. Trivial, but keeps intent obvious at call sites. */
export const sumMinor = (amounts: number[]): number =>
  amounts.reduce((total, amount) => total + amount, 0);

/** Guards against negative totals after a discount exceeds the subtotal. */
export const clampMinor = (amount: number): number => Math.max(0, Math.round(amount));
