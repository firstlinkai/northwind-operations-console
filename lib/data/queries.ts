/**
 * ============================================================================
 * QUERY LAYER
 * ============================================================================
 * The ONLY module the UI reads data through. Panels never touch `dataset.ts`
 * directly — they call a function here and receive a finished view model from
 * `lib/types.ts`.
 *
 * WHY THAT MATTERS
 *  - Swapping mocks for Supabase means rewriting this file and nothing else.
 *  - Tenant scoping lives in exactly one place, so it can be audited in one
 *    place. Every client-facing function takes `clientId` as its FIRST
 *    argument and filters on it before anything else happens.
 *
 * TENANT ISOLATION RULE
 *  `clientId` must always originate from `requireClientScope()` in
 *  `lib/auth/session.ts` — i.e. from the session — never from a route param,
 *  search param or request body. These functions trust their caller, exactly
 *  as a Postgres function would trust `auth.uid()`. The RLS policies in
 *  `supabase/policies.sql` enforce the same rule at the database level.
 */

import "server-only";

import {
  addDays,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  format,
  parseISO,
  subDays,
} from "date-fns";

import { getUsdPhpRate } from "@/lib/integrations/fx";
import {
  MONTHLY_HOURS,
  NIGHT_DIFF_PREMIUM,
  SLA_ANSWER_RATE_TARGET,
  type ArAgingBucket,
  type ArAgingRow,
  type CallingMetricDerived,
  type CallingMetrics,
  type CashFlowPanelData,
  type CashFlowPoint,
  type ClientPortalData,
  type ClientTeamMember,
  type ExecutiveKpis,
  type FinancialInvoice,
  type HrMetrics,
  type InvoiceWithClient,
  type IsoDate,
  type LeaveType,
  type MarginSimulatorInputs,
  type MarginSimulatorResult,
  type MetricDelta,
  type OperationsMetrics,
  type ShiftType,
  type StaffHeatmapEntry,
  type UUID,
} from "@/lib/types";

import {
  DEPARTMENT_IDS,
  HISTORY_DAYS,
  REFERENCE_DATE,
  REFERENCE_DAY,
  activeStaff,
  billRateFor,
  callingMetrics,
  clients,
  departmentNameById,
  exitedStaff,
  invoices,
  isOvertimeRiskStaff,
  leaveRecords,
  monthlyCostPhp,
  payrollRecords,
  presenceByUser,
  productivityLogs,
  profileById,
} from "@/lib/data/dataset";

/* ---------------------------------------------------------------------------
 * SMALL HELPERS
 * ------------------------------------------------------------------------ */

const iso = (d: Date): IsoDate => format(d, "yyyy-MM-dd");
const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);
const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const safeDiv = (a: number, b: number): number => (b === 0 ? 0 : a / b);

const inRange = (date: IsoDate, from: IsoDate, to: IsoDate): boolean =>
  date >= from && date <= to;

/**
 * Builds a period-over-period delta.
 * `higherIsBetter` is explicit rather than inferred: payroll cost rising is a
 * negative even though the number goes up, and getting that backwards on a
 * CEO dashboard is worse than showing no delta at all.
 */
function buildDelta(
  current: number,
  previous: number,
  higherIsBetter: boolean,
  comparison_label = "vs previous 30 days"
): MetricDelta {
  const percent = previous === 0 ? 0 : ((current - previous) / Math.abs(previous)) * 100;
  const direction: MetricDelta["direction"] =
    Math.abs(percent) < 0.05 ? "flat" : percent > 0 ? "up" : "down";
  const is_favourable =
    direction === "flat" ? true : higherIsBetter ? percent > 0 : percent < 0;

  return { percent: round1(percent), direction, is_favourable, comparison_label };
}

const clientById = new Map(clients.map((c) => [c.id, c]));

/* ---------------------------------------------------------------------------
 * INVOICES
 * ------------------------------------------------------------------------ */

function agingBucketFor(daysOverdue: number): ArAgingBucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

function decorateInvoice(inv: FinancialInvoice): InvoiceWithClient {
  const client = clientById.get(inv.client_id);
  const days_overdue =
    inv.status === "Paid"
      ? 0
      : differenceInCalendarDays(REFERENCE_DAY, parseISO(inv.due_date));

  return {
    ...inv,
    client_name: client?.name ?? "Unknown client",
    client_code: client?.code ?? "—",
    days_overdue,
    aging_bucket: inv.status === "Paid" ? "current" : agingBucketFor(days_overdue),
  };
}

/**
 * Invoices, optionally scoped to one tenant.
 * Pass `clientId` for anything client-facing; omit it only for internal views.
 */
export function getInvoices(clientId?: UUID | null): InvoiceWithClient[] {
  const rows = clientId ? invoices.filter((i) => i.client_id === clientId) : invoices;
  return rows.map(decorateInvoice).sort((a, b) => (a.issued_date < b.issued_date ? 1 : -1));
}

/* ---------------------------------------------------------------------------
 * EXECUTIVE KPIs (PRD §5, top row)
 * ------------------------------------------------------------------------ */

export async function getExecutiveKpis(): Promise<ExecutiveKpis> {
  const fx = await getUsdPhpRate();

  const last30From = iso(subDays(REFERENCE_DAY, 29));
  const prev30From = iso(subDays(REFERENCE_DAY, 59));
  const prev30To = iso(subDays(REFERENCE_DAY, 30));

  // --- Revenue: invoices issued in the trailing 30 days -------------------
  const currentRevenue = sum(
    invoices
      .filter((i) => inRange(i.issued_date, last30From, REFERENCE_DATE))
      .map((i) => i.amount_usd)
  );
  const previousRevenue = sum(
    invoices
      .filter((i) => inRange(i.issued_date, prev30From, prev30To))
      .map((i) => i.amount_usd)
  );

  // --- Payroll: everything paid in the trailing 30 days --------------------
  //
  // Windowed by DATE, deliberately — not by "the two most recent pay-period
  // end dates". That earlier approach broke the moment anyone imported a
  // payroll file: an imported period whose end date differs from the
  // generated ones (the JeonSoft sample runs 01-15 Jul, the dataset's periods
  // end 12 and 27 Jul) became a third "most recent" period holding only the
  // imported rows, displacing a full 60-person period from the window. The
  // headline KPI then fell ~39% and, because falling cost reads as good news,
  // rendered as a favourable green delta. Importing payroll made the company
  // look cheaper to run.
  //
  // A date window is also simply the correct definition of "this month's
  // payroll", and it matches how revenue and productivity are computed above.
  const netPayrollPhp = sum(
    payrollRecords
      .filter((r) => inRange(r.pay_period_end, last30From, REFERENCE_DATE))
      .map((r) => r.net_pay_php)
  );
  const prevPayrollPhp = sum(
    payrollRecords
      .filter((r) => inRange(r.pay_period_end, prev30From, prev30To))
      .map((r) => r.net_pay_php)
  );

  // --- Productivity: mean score over the trailing 30 days -----------------
  const currentLogs = productivityLogs.filter((l) =>
    inRange(l.log_date, last30From, REFERENCE_DATE)
  );
  const previousLogs = productivityLogs.filter((l) =>
    inRange(l.log_date, prev30From, prev30To)
  );
  const avgProductivity = safeDiv(
    sum(currentLogs.map((l) => l.productivity_score)),
    currentLogs.length
  );
  const prevProductivity = safeDiv(
    sum(previousLogs.map((l) => l.productivity_score)),
    previousLogs.length
  );

  // --- Headcount and shift coverage --------------------------------------
  const shift_coverage: Record<ShiftType, number> = { day: 0, mid: 0, night: 0 };
  for (const s of activeStaff) shift_coverage[s.shift] += 1;

  return {
    gross_monthly_revenue_usd: Math.round(currentRevenue),
    revenue_delta: buildDelta(currentRevenue, previousRevenue, true),

    net_payroll_expense_php: Math.round(netPayrollPhp),
    net_payroll_expense_usd: Math.round(netPayrollPhp / fx.rate),
    // Cost going UP is unfavourable — hence `false`.
    payroll_delta: buildDelta(netPayrollPhp, prevPayrollPhp, false),

    avg_productivity_score: round1(avgProductivity),
    productivity_delta: buildDelta(avgProductivity, prevProductivity, true),

    active_headcount: activeStaff.length,
    shift_coverage,

    fx_rate: fx,
  };
}

/* ---------------------------------------------------------------------------
 * CASH FLOW & AR AGEING (PRD §5)
 * ------------------------------------------------------------------------ */

/** Mean days between due date and payment, per client. Drives the forecast. */
function averagePaymentLag(clientId: UUID): number {
  const paid = invoices.filter(
    (i) => i.client_id === clientId && i.status === "Paid" && i.paid_date
  );
  if (paid.length === 0) return 7;
  return (
    sum(
      paid.map((i) =>
        differenceInCalendarDays(parseISO(i.paid_date as string), parseISO(i.due_date))
      )
    ) / paid.length
  );
}

export async function getCashFlowPanel(): Promise<CashFlowPanelData> {
  const fx = await getUsdPhpRate();

  const WINDOW_BACK = HISTORY_DAYS;
  const WINDOW_FORWARD = 90;

  // Actual collections, indexed by the day the money landed.
  const collectionsByDate = new Map<IsoDate, number>();
  for (const inv of invoices) {
    if (inv.status === "Paid" && inv.paid_date) {
      collectionsByDate.set(
        inv.paid_date,
        (collectionsByDate.get(inv.paid_date) ?? 0) + inv.amount_usd
      );
    }
  }

  // Projected collections: open invoices land at due date + that client's
  // observed payment lag. Overdue invoices are assumed to land soon rather
  // than never — this is a forecast, not a write-off model.
  const projectedByDate = new Map<IsoDate, number>();
  for (const inv of invoices) {
    if (inv.status === "Paid") continue;
    const lag = averagePaymentLag(inv.client_id);
    let expected = addDays(parseISO(inv.due_date), Math.max(2, Math.round(lag)));
    if (differenceInCalendarDays(expected, REFERENCE_DAY) < 0) {
      // Already late — model recovery over the next fortnight.
      expected = addDays(REFERENCE_DAY, inv.status === "Overdue" ? 12 : 5);
    }
    const key = iso(expected);
    projectedByDate.set(key, (projectedByDate.get(key) ?? 0) + inv.amount_usd);
  }

  // Payroll outflow: semi-monthly, converted to USD at the live rate.
  const monthlyPayrollPhp = sum(activeStaff.map(monthlyCostPhp));
  const perPayrunUsd = monthlyPayrollPhp / 2 / fx.rate;

  const series: CashFlowPoint[] = [];
  let position = 0;

  for (let offset = -WINDOW_BACK; offset <= WINDOW_FORWARD; offset += 1) {
    const day = addDays(REFERENCE_DAY, offset);
    const key = iso(day);
    const isPast = offset <= 0;

    const actual = isPast ? (collectionsByDate.get(key) ?? 0) : null;
    const projected = isPast ? null : (projectedByDate.get(key) ?? 0);

    // Pay runs land on the 15th and the last day of each month.
    const dayOfMonth = day.getDate();
    const isPayday =
      dayOfMonth === 15 || dayOfMonth === new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
    const payroll_outflow_usd = isPayday ? Math.round(perPayrunUsd) : 0;

    position += (actual ?? projected ?? 0) - payroll_outflow_usd;

    series.push({
      date: key,
      actual_usd: actual === null ? null : Math.round(actual),
      projected_usd: projected === null ? null : Math.round(projected),
      payroll_outflow_usd,
      net_position_usd: Math.round(position),
    });
  }

  // --- AR ageing ----------------------------------------------------------
  const outstanding = invoices.filter((i) => i.status !== "Paid").map(decorateInvoice);
  const totalReceivable = sum(outstanding.map((i) => i.amount_usd));

  const BUCKETS: ArAgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];
  const aging: ArAgingRow[] = BUCKETS.map((bucket) => {
    const rows = outstanding.filter((i) => i.aging_bucket === bucket);
    const amount = sum(rows.map((i) => i.amount_usd));
    return {
      bucket,
      invoice_count: rows.length,
      amount_usd: Math.round(amount),
      share_percent: round1(safeDiv(amount, totalReceivable) * 100),
    };
  });

  const overdue = outstanding
    .filter((i) => i.status === "Overdue")
    .sort((a, b) => b.days_overdue - a.days_overdue);

  return {
    series,
    aging,
    overdue_invoices: overdue,
    total_receivable_usd: Math.round(totalReceivable),
    total_overdue_usd: Math.round(sum(overdue.map((i) => i.amount_usd))),
  };
}

/* ---------------------------------------------------------------------------
 * STAFF HEATMAP (PRD §5)
 * ------------------------------------------------------------------------ */

export function getStaffHeatmap(): StaffHeatmapEntry[] {
  const today = productivityLogs.filter((l) => l.log_date === REFERENCE_DATE);
  const todayByUser = new Map(today.map((l) => [l.user_id, l]));

  // Fall back to a recent day for anyone with no log today (day-shift staff on
  // a quiet weekend), so the grid never shows phantom zeroes.
  const recentByUser = new Map<UUID, (typeof productivityLogs)[number]>();
  for (const log of productivityLogs) {
    const existing = recentByUser.get(log.user_id);
    if (!existing || log.log_date > existing.log_date) recentByUser.set(log.user_id, log);
  }

  return activeStaff
    .map((staff): StaffHeatmapEntry => {
      const log = todayByUser.get(staff.id) ?? recentByUser.get(staff.id);
      const presence = presenceByUser.get(staff.id);
      const overtime = log?.overtime_hours ?? 0;
      const score = log?.productivity_score ?? 0;

      return {
        user_id: staff.id,
        full_name: staff.full_name,
        job_title: staff.job_title,
        department: departmentNameById(staff.department_id) ?? "Operations",
        client_id: staff.client_id,
        client_code: staff.client_id
          ? (clientById.get(staff.client_id)?.code ?? null)
          : null,
        shift: staff.shift,
        status: presence?.status ?? "offline",
        active_hours: log?.active_hours ?? 0,
        idle_hours: log?.idle_hours ?? 0,
        productivity_score: score,
        overtime_hours: overtime,
        // The signal the panel exists to surface: burning hours without the
        // output to justify them.
        overtime_risk: (overtime >= 2 && score < 78) || isOvertimeRiskStaff(staff.id),
      };
    })
    .sort((a, b) => {
      // Risk first, then by productivity ascending — problems at the top.
      if (a.overtime_risk !== b.overtime_risk) return a.overtime_risk ? -1 : 1;
      return a.productivity_score - b.productivity_score;
    });
}

/* ---------------------------------------------------------------------------
 * HR TAB (PRD §5)
 * ------------------------------------------------------------------------ */

export function getHrMetrics(): HrMetrics {
  const yearAgo = iso(subDays(REFERENCE_DAY, 365));
  const ninetyAgo = iso(subDays(REFERENCE_DAY, 90));

  const exitsLastYear = exitedStaff.filter((s) => (s.exited_at ?? "") >= yearAgo);
  const avgHeadcount = activeStaff.length + exitsLastYear.length / 2;
  const attrition_rate = round1(safeDiv(exitsLastYear.length, avgHeadcount) * 100);

  const regularized = activeStaff.filter((s) => s.regularized_at !== null);
  const avg_days_to_regularization = Math.round(
    safeDiv(
      sum(
        regularized.map((s) =>
          differenceInCalendarDays(
            parseISO(s.regularized_at as string),
            parseISO(s.hire_date)
          )
        )
      ),
      regularized.length
    )
  );

  // Shrinkage: hours lost to absence over the last 90 days, against scheduled.
  const recentLeave = leaveRecords.filter((l) => l.leave_date >= ninetyAgo);
  const lostHours = sum(recentLeave.map((l) => l.hours));
  // ~21.7 working days per month × 8h × 3 months.
  const scheduledHours = activeStaff.length * 21.7 * 8 * 3;
  const absence_shrinkage = round1(safeDiv(lostHours, scheduledHours) * 100);

  // Attrition trend, last 12 months.
  const attrition_trend: Array<{ month: string; rate: number }> = [];
  for (let m = 11; m >= 0; m -= 1) {
    const monthDate = subDays(REFERENCE_DAY, m * 30);
    const label = format(monthDate, "MMM");
    const exitsThatMonth = exitedStaff.filter(
      (s) =>
        s.exited_at !== null &&
        differenceInCalendarMonths(REFERENCE_DAY, parseISO(s.exited_at)) === m
    ).length;
    attrition_trend.push({
      month: label,
      rate: round1(safeDiv(exitsThatMonth * 12, avgHeadcount) * 100),
    });
  }

  const LEAVE_TYPES: LeaveType[] = [
    "sick",
    "vacation",
    "emergency",
    "unpaid",
    "absent_no_notice",
  ];
  const leave_breakdown = LEAVE_TYPES.map((type) => {
    const hours = sum(recentLeave.filter((l) => l.leave_type === type).map((l) => l.hours));
    return { type, hours, share: round1(safeDiv(hours, lostHours) * 100) };
  }).sort((a, b) => b.hours - a.hours);

  return {
    attrition_rate,
    avg_days_to_regularization,
    absence_shrinkage,
    headcount_total: activeStaff.length,
    headcount_probationary: activeStaff.filter(
      (s) => s.employment_status === "probationary"
    ).length,
    headcount_regular: activeStaff.filter((s) => s.employment_status === "regular").length,
    exits_last_90d: exitedStaff.filter((s) => (s.exited_at ?? "") >= ninetyAgo).length,
    hires_last_90d: activeStaff.filter((s) => s.hire_date >= ninetyAgo).length,
    attrition_trend,
    leave_breakdown,
    // Modelled, not sourced from a real HRIS. The panel must say so.
    is_sample_data: true,
  };
}

/* ---------------------------------------------------------------------------
 * OPERATIONS TAB (PRD §5)
 * ------------------------------------------------------------------------ */

export async function getOperationsMetrics(): Promise<OperationsMetrics> {
  const fx = await getUsdPhpRate();

  const billable = activeStaff.filter((s) => s.seat_type === "billable");
  const nonBillable = activeStaff.filter((s) => s.seat_type === "non_billable");

  const billable_revenue_usd = Math.round(
    sum(billable.map((s) => billRateFor(s.client_id, s.department_id)))
  );
  const overhead_cost_usd = Math.round(
    sum(nonBillable.map((s) => monthlyCostPhp(s) / fx.rate))
  );

  const utilization_by_client = clients.map((client) => {
    const seats = billable.filter((s) => s.client_id === client.id);
    const revenue_usd = Math.round(
      sum(seats.map((s) => billRateFor(s.client_id, s.department_id)))
    );
    const direct = sum(seats.map((s) => monthlyCostPhp(s) / fx.rate));
    // Allocate shared overhead pro-rata by seat count.
    const allocated = safeDiv(seats.length, billable.length) * overhead_cost_usd;
    const cost_usd = Math.round(direct + allocated);

    return {
      client_id: client.id,
      client_code: client.code,
      billable_seats: seats.length,
      revenue_usd,
      cost_usd,
      margin_percent: round1(safeDiv(revenue_usd - cost_usd, revenue_usd) * 100),
    };
  });

  return {
    billable_seats: billable.length,
    non_billable_seats: nonBillable.length,
    utilization_rate: round1(safeDiv(billable.length, activeStaff.length) * 100),
    billable_revenue_usd,
    overhead_cost_usd,
    utilization_by_client,
  };
}

/* ---------------------------------------------------------------------------
 * CALLING / SLA (PRD §5 and §6)
 * ------------------------------------------------------------------------ */

function deriveCalling(m: (typeof callingMetrics)[number]): CallingMetricDerived {
  const answer_rate = round2(safeDiv(m.answered_calls, m.total_calls) * 100);
  return {
    ...m,
    answer_rate,
    abandoned_calls: m.total_calls - m.answered_calls,
    sla_met: answer_rate >= SLA_ANSWER_RATE_TARGET,
  };
}

/**
 * Calling metrics for the trailing `days`, optionally scoped to one tenant.
 * `clientId` MUST be supplied for the client portal.
 */
export function getCallingMetrics(clientId?: UUID | null, days = 30): CallingMetrics {
  const from = iso(subDays(REFERENCE_DAY, days - 1));

  const scoped = callingMetrics.filter(
    (m) => m.metric_date >= from && (!clientId || m.client_id === clientId)
  );

  const total_calls = sum(scoped.map((m) => m.total_calls));
  const answered_calls = sum(scoped.map((m) => m.answered_calls));

  // Daily trend: for a single tenant this is their series; for the CEO it is
  // the aggregate across all four accounts.
  const byDate = new Map<IsoDate, CallingMetricDerived>();
  for (const m of scoped) {
    const existing = byDate.get(m.metric_date);
    if (!existing) {
      byDate.set(m.metric_date, deriveCalling(m));
      continue;
    }
    const merged = {
      ...existing,
      total_calls: existing.total_calls + m.total_calls,
      answered_calls: existing.answered_calls + m.answered_calls,
      avg_handle_time_sec: Math.round((existing.avg_handle_time_sec + m.avg_handle_time_sec) / 2),
      fcr_percentage: round2((existing.fcr_percentage + m.fcr_percentage) / 2),
      qa_audit_score: round2((existing.qa_audit_score + m.qa_audit_score) / 2),
    };
    merged.answer_rate = round2(safeDiv(merged.answered_calls, merged.total_calls) * 100);
    merged.abandoned_calls = merged.total_calls - merged.answered_calls;
    merged.sla_met = merged.answer_rate >= SLA_ANSWER_RATE_TARGET;
    byDate.set(m.metric_date, merged);
  }

  const trend = [...byDate.values()].sort((a, b) =>
    a.metric_date < b.metric_date ? -1 : 1
  );

  const by_client = (clientId ? clients.filter((c) => c.id === clientId) : clients).map(
    (client) => {
      const rows = scoped.filter((m) => m.client_id === client.id);
      const total = sum(rows.map((m) => m.total_calls));
      const answered = sum(rows.map((m) => m.answered_calls));
      const answer_rate = round2(safeDiv(answered, total) * 100);
      return {
        client_id: client.id,
        client_code: client.code,
        client_name: client.name,
        total_calls: total,
        answer_rate,
        fcr_percentage: round2(safeDiv(sum(rows.map((m) => m.fcr_percentage)), rows.length)),
        qa_audit_score: round2(safeDiv(sum(rows.map((m) => m.qa_audit_score)), rows.length)),
        sla_met: answer_rate >= SLA_ANSWER_RATE_TARGET,
      };
    }
  );

  return {
    total_calls,
    answered_calls,
    answer_rate: round2(safeDiv(answered_calls, total_calls) * 100),
    avg_handle_time_sec: Math.round(
      safeDiv(sum(scoped.map((m) => m.avg_handle_time_sec)), scoped.length)
    ),
    fcr_percentage: round2(safeDiv(sum(scoped.map((m) => m.fcr_percentage)), scoped.length)),
    qa_audit_score: round2(safeDiv(sum(scoped.map((m) => m.qa_audit_score)), scoped.length)),
    trend,
    by_client,
  };
}

/* ---------------------------------------------------------------------------
 * MARGIN SIMULATOR (PRD §5)
 * ------------------------------------------------------------------------ */

/**
 * Today's actual position — the simulator's starting point and comparison.
 *
 * Resolves the blended rates here, on the server, and passes them down as part
 * of the inputs. That is what allows `runMarginSimulator` to be a pure,
 * client-safe function (see `lib/calc/margin.ts`): the browser gets two
 * averages rather than access to the roster.
 */
export async function getMarginBaseline(): Promise<MarginSimulatorInputs> {
  const fx = await getUsdPhpRate();
  const billable = activeStaff.filter((s) => s.seat_type === "billable");
  const night = activeStaff.filter((s) => s.is_night_shift);

  const blended_bill_rate_usd = Math.round(
    safeDiv(
      sum(billable.map((s) => billRateFor(s.client_id, s.department_id))),
      billable.length
    )
  );
  const blended_hourly_php = round2(
    safeDiv(sum(activeStaff.map((s) => s.hourly_rate_php)), activeStaff.length)
  );

  return {
    headcount: activeStaff.length,
    night_shift_ratio: round1(safeDiv(night.length, activeStaff.length) * 100),
    bill_rate_multiplier: 1,
    utilization_rate: round1(safeDiv(billable.length, activeStaff.length) * 100),
    usd_php_rate: fx.rate,
    blended_bill_rate_usd,
    blended_hourly_php,
  };
}

/**
 * Re-exported from `lib/calc/margin.ts`, which is a pure client-safe leaf.
 * The simulator imports it from there directly so the calculation runs in the
 * browser; this re-export exists so server code has a single obvious entry
 * point for data access.
 */
export { runMarginSimulator } from "@/lib/calc/margin";

/* ---------------------------------------------------------------------------
 * CLIENT PORTAL (PRD §6)
 * ------------------------------------------------------------------------ */

/**
 * Everything a single tenant may see — and nothing else.
 *
 * `clientId` comes from `requireClientScope()`. Note what is absent: no
 * payroll, no salary, no other tenant's rows, no keystroke-level monitoring.
 * The team list is built as `ClientTeamMember`, a type that has no
 * compensation fields at all, so pay data cannot leak here by accident.
 */
export function getClientPortalData(clientId: UUID): ClientPortalData | null {
  const client = clientById.get(clientId);
  if (!client) return null;

  const pod = activeStaff.filter(
    (s) => s.client_id === clientId && s.seat_type === "billable"
  );

  const team: ClientTeamMember[] = pod
    .map((s) => {
      const presence = presenceByUser.get(s.id);
      return {
        user_id: s.id,
        full_name: s.full_name,
        job_title: s.job_title,
        department: departmentNameById(s.department_id) ?? "Operations",
        shift: s.shift,
        status: presence?.status ?? "offline",
        tenure_months: Math.max(
          0,
          differenceInCalendarMonths(REFERENCE_DAY, parseISO(s.hire_date))
        ),
      };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const sla = getCallingMetrics(clientId, 30);
  const clientInvoices = getInvoices(clientId);

  const outstanding = clientInvoices.filter((i) => i.status !== "Paid");
  const upcoming = outstanding
    .filter((i) => i.due_date >= REFERENCE_DATE)
    .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));

  return {
    client,
    team,
    sla,
    invoices: clientInvoices,
    summary: {
      team_size: team.length,
      active_now: team.filter((m) => m.status === "active").length,
      outstanding_balance_usd: Math.round(sum(outstanding.map((i) => i.amount_usd))),
      next_invoice_due: upcoming[0]?.due_date ?? null,
      answer_rate_30d: sla.answer_rate,
      sla_target: SLA_ANSWER_RATE_TARGET,
    },
  };
}

/* ---------------------------------------------------------------------------
 * PAYLOAD FOR THE AI BRIEFING (PRD §7)
 * Assembled server-side on purpose. The original PRD accepted this payload
 * from the browser, which would let a caller feed the model fabricated figures
 * or probe it with someone else's data.
 * ------------------------------------------------------------------------ */

export async function getAiInsightPayload() {
  const [kpis, cash, ops] = await Promise.all([
    getExecutiveKpis(),
    getCashFlowPanel(),
    getOperationsMetrics(),
  ]);
  const calling = getCallingMetrics(null, 30);
  const hr = getHrMetrics();
  const heatmap = getStaffHeatmap();

  return {
    financialSummary: {
      gross_monthly_revenue_usd: kpis.gross_monthly_revenue_usd,
      revenue_change_percent: kpis.revenue_delta.percent,
      net_payroll_expense_usd: kpis.net_payroll_expense_usd,
      total_receivable_usd: cash.total_receivable_usd,
      total_overdue_usd: cash.total_overdue_usd,
      overdue_invoice_count: cash.overdue_invoices.length,
      worst_overdue_days: cash.overdue_invoices[0]?.days_overdue ?? 0,
      gross_margin_percent: round1(
        safeDiv(
          ops.billable_revenue_usd - kpis.net_payroll_expense_usd - ops.overhead_cost_usd,
          ops.billable_revenue_usd
        ) * 100
      ),
    },
    productivityAlerts: {
      avg_productivity_score: kpis.avg_productivity_score,
      productivity_change_percent: kpis.productivity_delta.percent,
      headcount: kpis.active_headcount,
      overtime_risk_count: heatmap.filter((h) => h.overtime_risk).length,
      utilization_rate: ops.utilization_rate,
      attrition_rate: hr.attrition_rate,
      absence_shrinkage: hr.absence_shrinkage,
    },
    callingSLAs: calling.by_client.map((c) => ({
      client: c.client_name,
      answer_rate: c.answer_rate,
      target: SLA_ANSWER_RATE_TARGET,
      sla_met: c.sla_met,
      fcr: c.fcr_percentage,
      qa_score: c.qa_audit_score,
    })),
  };
}

export type AiInsightPayload = Awaited<ReturnType<typeof getAiInsightPayload>>;
