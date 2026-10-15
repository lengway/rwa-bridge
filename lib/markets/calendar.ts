/**
 * Bond calendars.
 *
 * Real instruments run on the civil calendar: coupon periods of 12 / frequency months from the
 * issue date. Showcase instruments run on an **accelerated calendar for demonstration**: the
 * on-chain issue and maturity timestamps are real, but one nominal year lasts
 * `ACCELERATED_YEAR_SECONDS`, so a 2-year semi-annual bond matures 40 minutes after issue with a
 * coupon every 10 minutes. The program itself has no calendar rule (it stores the two timestamps
 * and enforces record < payment ≤ claim deadline per action), so only the off-chain schedule needs
 * to know. An instrument whose tenor is shorter than a day is treated as accelerated.
 */
import type { Instrument, UnixTs } from "./service";

/** One nominal year on an accelerated calendar: 20 minutes. */
export const ACCELERATED_YEAR_SECONDS = 20 * 60;
/** Civil year used for period counts and yields. */
export const CIVIL_YEAR_SECONDS = 365.25 * 86_400;
const DAY = 86_400;

export type CalendarTerms = Pick<Instrument, "issueTs" | "maturityTs" | "frequency">;

export function isAccelerated(t: Pick<Instrument, "issueTs" | "maturityTs">) {
  return t.maturityTs > t.issueTs && t.maturityTs - t.issueTs < DAY;
}

/** Seconds in one nominal year for this instrument. */
export function yearSeconds(t: Pick<Instrument, "issueTs" | "maturityTs">) {
  return isAccelerated(t) ? ACCELERATED_YEAR_SECONDS : CIVIL_YEAR_SECONDS;
}

/** Nominal tenor in years (2 for the KASE example, whatever the calendar). */
export function tenorYears(t: Pick<Instrument, "issueTs" | "maturityTs">) {
  return (t.maturityTs - t.issueTs) / yearSeconds(t);
}

/** Number of scheduled coupons from issue to maturity. */
export function couponCount(t: CalendarTerms) {
  return Math.round(tenorYears(t) * t.frequency);
}

/** `ts` plus whole calendar months in UTC; the day clamps to the end of shorter months. */
export function addMonthsUtc(ts: UnixTs, months: number): UnixTs {
  const d = new Date(ts * 1000);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return Math.floor(target.getTime() / 1000);
}

/** Scheduled coupon dates, issue excluded, maturity included. */
export function couponDates(t: CalendarTerms): UnixTs[] {
  if (!(t.frequency > 0) || t.maturityTs <= t.issueTs) return [];
  const count = Math.max(1, couponCount(t));
  const dates: UnixTs[] = [];
  if (isAccelerated(t)) {
    const step = ACCELERATED_YEAR_SECONDS / t.frequency;
    for (let k = 1; k < count; k++) dates.push(Math.min(t.issueTs + Math.round(k * step), t.maturityTs));
  } else {
    const months = 12 / t.frequency;
    for (let k = 1; k < count; k++) dates.push(Math.min(addMonthsUtc(t.issueTs, Math.round(k * months)), t.maturityTs));
  }
  dates.push(t.maturityTs);
  return dates;
}
