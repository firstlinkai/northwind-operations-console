/**
 * ============================================================================
 * MARGIN MODEL — pure, client-safe
 * ============================================================================
 * Deliberately has NO imports beyond types and no `server-only` guard, so the
 * margin simulator can run it in the browser on every slider drag. The CEO
 * moves a slider and the number moves — no network round trip, no spinner.
 *
 * Everything it needs about the current business (blended bill rate, blended
 * hourly cost, live FX) arrives via `MarginSimulatorInputs`, resolved on the
 * server by `getMarginBaseline()`. That is what keeps the function pure: it
 * never reaches into the dataset, so it can never drag server data clientward.
 */

import {
  MONTHLY_HOURS,
  NIGHT_DIFF_PREMIUM,
  type MarginSimulatorInputs,
  type MarginSimulatorResult,
} from "@/lib/types";

/** Employer share of SSS/PhilHealth/Pag-IBIG plus 13th-month accrual. */
const EMPLOYER_BURDEN_RATE = 0.22;
/** Monthly facilities, licences and management cost carried per seat, USD. */
const OVERHEAD_PER_SEAT_USD = 145;
/** Extra monthly cost carried by each non-billable (internal) seat, USD. */
const OVERHEAD_PER_NON_BILLABLE_SEAT_USD = 210;

const round1 = (n: number): number => Math.round(n * 10) / 10;
const safeDiv = (a: number, b: number): number => (b === 0 ? 0 : a / b);

/**
 * Project monthly revenue, cost and gross margin.
 *
 * Revenue = billable seats × blended seat rate × pricing multiplier.
 * Cost    = base salary + night differential + employer statutory burden,
 *           converted at the live USD/PHP rate, plus per-seat overhead.
 *
 * Pass `baseline` (the result of running this against the untouched inputs) to
 * populate `margin_delta_points`, so the CEO always sees the change against
 * today's real position rather than an abstract number.
 */
export function runMarginSimulator(
  inputs: MarginSimulatorInputs,
  baseline?: MarginSimulatorResult
): MarginSimulatorResult {
  const {
    headcount,
    night_shift_ratio,
    bill_rate_multiplier,
    utilization_rate,
    usd_php_rate,
    blended_bill_rate_usd,
    blended_hourly_php,
  } = inputs;

  const billableSeats = Math.round(headcount * (utilization_rate / 100));
  const nonBillableSeats = Math.max(0, headcount - billableSeats);

  const monthly_revenue_usd =
    billableSeats * blended_bill_rate_usd * bill_rate_multiplier;

  const baseSalaryPhp = headcount * blended_hourly_php * MONTHLY_HOURS;
  const nightSeats = headcount * (night_shift_ratio / 100);
  const nightDiffPhp =
    nightSeats * blended_hourly_php * MONTHLY_HOURS * NIGHT_DIFF_PREMIUM;
  const statutoryPhp = (baseSalaryPhp + nightDiffPhp) * EMPLOYER_BURDEN_RATE;

  // Guard against a zero/absent FX rate producing Infinity across the panel.
  const fx = usd_php_rate > 0 ? usd_php_rate : 1;

  const base_salary_usd = baseSalaryPhp / fx;
  const night_differential_usd = nightDiffPhp / fx;
  const statutory_contributions_usd = statutoryPhp / fx;
  const overhead_usd =
    headcount * OVERHEAD_PER_SEAT_USD +
    nonBillableSeats * OVERHEAD_PER_NON_BILLABLE_SEAT_USD;

  const monthly_cost_usd =
    base_salary_usd +
    night_differential_usd +
    statutory_contributions_usd +
    overhead_usd;

  const gross_margin_usd = monthly_revenue_usd - monthly_cost_usd;
  const gross_margin_percent = round1(
    safeDiv(gross_margin_usd, monthly_revenue_usd) * 100
  );

  return {
    monthly_revenue_usd: Math.round(monthly_revenue_usd),
    monthly_cost_usd: Math.round(monthly_cost_usd),
    gross_margin_usd: Math.round(gross_margin_usd),
    gross_margin_percent,
    margin_delta_points: baseline
      ? round1(gross_margin_percent - baseline.gross_margin_percent)
      : 0,
    cost_breakdown: {
      base_salary_usd: Math.round(base_salary_usd),
      night_differential_usd: Math.round(night_differential_usd),
      statutory_contributions_usd: Math.round(statutory_contributions_usd),
      overhead_usd: Math.round(overhead_usd),
    },
  };
}
