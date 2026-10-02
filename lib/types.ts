/**
 * ============================================================================
 * NORTHWINDS INTERNATIONAL — CANONICAL DOMAIN TYPES
 * ============================================================================
 * This file is the contract between the data layer, the API routes and every
 * UI panel. It mirrors `supabase/schema.sql` one-to-one.
 *
 * RULES
 *  - Do not redefine these shapes locally in a component. Import from here.
 *  - Do not add `any`. The project runs TypeScript in strict mode.
 *  - When the schema changes, this file changes first, then the mock layer.
 *
 * MONEY
 *  NorthWinds bills clients in USD and pays staff in PHP. The two never mix in a
 *  single field. Field names always carry the currency suffix (`_usd`/`_php`)
 *  so a conversion can never happen by accident.
 *
 * DATES
 *  `IsoDate` is a calendar date (`2026-07-28`) — used for anything a human
 *  reasons about as a day (pay periods, invoice due dates, metric days).
 *  `IsoDateTime` is a precise instant — used for audit trails and presence.
 * ========================================================================= */

export type UUID = string;
/** Calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;
/** Full ISO-8601 instant, e.g. `2026-07-28T09:30:00.000Z`. */
export type IsoDateTime = string;

/** Amount in US dollars. Client-facing billing only. */
export type UsdAmount = number;
/** Amount in Philippine pesos. Payroll and local cost only. */
export type PhpAmount = number;

/* ---------------------------------------------------------------------------
 * ENUMS — these mirror Postgres enum types in schema.sql
 * ------------------------------------------------------------------------ */

/**
 * Portal roles.
 *
 * `staff` is deliberately distinct from `client_user`. A staff member's profile
 * carries the `client_id` of the account they are assigned to, so if workforce
 * records defaulted to `client_user` (as the original PRD schema did), every
 * employee would inherit read access to that client's portal — invoices
 * included. `staff` grants NO portal access at all; it marks a workforce
 * record. Only the four seeded `client_user` logins may reach a client portal.
 */
export type UserRole =
  | "ceo_admin"
  | "hr_admin"
  | "ops_manager"
  | "client_user"
  | "staff";

export type InvoiceStatus = "Paid" | "Overdue" | "Pending";

export type DepartmentName = "HR" | "Operations" | "Onboarding" | "Calling";

/**
 * Employment lifecycle. Philippine labour practice: staff start
 * `probationary` and regularise at ~6 months, which is what the HR tab's
 * "time to regularization" metric measures.
 */
export type EmploymentStatus =
  | "probationary"
  | "regular"
  | "resigned"
  | "terminated";

/** Live workstation presence, derived from Controlio heartbeats. */
export type PresenceStatus = "active" | "idle" | "offline";

/** Shift bands. `night` drives the statutory night-differential premium. */
export type ShiftType = "day" | "mid" | "night";

export type LeaveType =
  | "sick"
  | "vacation"
  | "emergency"
  | "unpaid"
  | "absent_no_notice";

/** Whether a seat is billed to a client or carried as internal overhead. */
export type SeatType = "billable" | "non_billable";

/* ---------------------------------------------------------------------------
 * CORE ENTITIES
 * ------------------------------------------------------------------------ */

export interface Client {
  id: UUID;
  name: string;
  industry: string;
  /** Short code used in table cells and chart legends, e.g. "ALDR". */
  code: string;
  created_at: IsoDateTime;
}

export interface Department {
  id: UUID;
  name: DepartmentName;
}

/**
 * A person. Covers both NorthWinds staff and external client portal logins —
 * `role` disambiguates. For staff, `client_id` is the single account they are
 * assigned to (confirmed: staff serve exactly one client, never shared).
 * For a `client_user`, `client_id` is the tenant they may read.
 */
export interface Profile {
  id: UUID;
  email: string;
  full_name: string;
  role: UserRole;
  client_id: UUID | null;
  department_id: UUID | null;
  hourly_rate_php: PhpAmount;
  is_night_shift: boolean;
  shift: ShiftType;
  /** Job title shown in the client's team pod, e.g. "Registered Nurse (RN)". */
  job_title: string;
  employment_status: EmploymentStatus;
  seat_type: SeatType;
  hire_date: IsoDate;
  /** Set when probation converts to regular. Null while still probationary. */
  regularized_at: IsoDate | null;
  /** Set on resignation/termination. Drives attrition. */
  exited_at: IsoDate | null;
  created_at: IsoDateTime;
}

/* ---------------------------------------------------------------------------
 * FINANCE — QuickBooks Online
 * ------------------------------------------------------------------------ */

export interface FinancialInvoice {
  id: UUID;
  qbo_invoice_id: string;
  client_id: UUID;
  amount_usd: UsdAmount;
  status: InvoiceStatus;
  issued_date: IsoDate;
  due_date: IsoDate;
  /**
   * When the money actually landed. Null unless status is `Paid`.
   * PRD gap: the original schema had no paid date, which made the 90-day
   * cash-flow projection unanchored. Payment lag is derived from this.
   */
  paid_date: IsoDate | null;
  /** Net payment terms in days, taken from the QBO invoice terms. */
  terms_days: number;
  created_at: IsoDateTime;
}

/** One line on an invoice — lets the client portal show what they paid for. */
export interface InvoiceLineItem {
  id: UUID;
  invoice_id: UUID;
  description: string;
  quantity: number;
  unit_rate_usd: UsdAmount;
  amount_usd: UsdAmount;
}

/** An invoice joined with its client and computed ageing, for table rendering. */
export interface InvoiceWithClient extends FinancialInvoice {
  client_name: string;
  client_code: string;
  /** Days past due. Negative means not yet due. */
  days_overdue: number;
  /** AR ageing bucket, computed against the reporting date. */
  aging_bucket: ArAgingBucket;
}

export type ArAgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

/* ---------------------------------------------------------------------------
 * PRODUCTIVITY — Controlio
 * ------------------------------------------------------------------------ */

export interface ProductivityLog {
  id: UUID;
  user_id: UUID;
  log_date: IsoDate;
  active_hours: number;
  idle_hours: number;
  /** 0–100. Controlio's weighted focus score. */
  productivity_score: number;
  overtime_hours: number;
}

/**
 * Live workstation state. Deliberately coarse: the client portal shows
 * presence only, never keystroke-level detail (PRD §6 — "without invasive
 * keystroke monitoring").
 */
export interface StaffPresence {
  user_id: UUID;
  status: PresenceStatus;
  last_heartbeat: IsoDateTime;
  /** Minutes idle in the current session. */
  idle_minutes: number;
}

/** Row model for the CEO staff heatmap — profile + today's numbers + presence. */
export interface StaffHeatmapEntry {
  user_id: UUID;
  full_name: string;
  job_title: string;
  department: DepartmentName;
  client_id: UUID | null;
  client_code: string | null;
  shift: ShiftType;
  status: PresenceStatus;
  active_hours: number;
  idle_hours: number;
  productivity_score: number;
  overtime_hours: number;
  /**
   * True when overtime is high but productivity is not — the burnout /
   * inefficiency signal the CEO panel is meant to surface.
   */
  overtime_risk: boolean;
}

/* ---------------------------------------------------------------------------
 * PAYROLL — JeonSoft
 * ------------------------------------------------------------------------ */

export interface PayrollRecord {
  id: UUID;
  user_id: UUID;
  pay_period_start: IsoDate;
  pay_period_end: IsoDate;
  gross_pay_php: PhpAmount;
  night_diff_php: PhpAmount;
  overtime_pay_php: PhpAmount;
  sss_deduction_php: PhpAmount;
  philhealth_deduction_php: PhpAmount;
  pagibig_deduction_php: PhpAmount;
  tax_withheld_php: PhpAmount;
  net_pay_php: PhpAmount;
  created_at: IsoDateTime;
}

/**
 * Canonical JeonSoft CSV row.
 *
 * ⚠️ No real JeonSoft export was available when this was written. This is the
 * contract we expect; the parser is deliberately tolerant (case-insensitive,
 * order-independent, accepts common header aliases). If the real export
 * differs, change `JEONSOFT_COLUMN_ALIASES` in lib/integrations/jeonsoft.ts —
 * not this type. A sample conforming file lives at
 * `docs/samples/jeonsoft-sample.csv`.
 */
export interface JeonSoftCsvRow {
  employee_id: string;
  employee_email: string;
  employee_name: string;
  pay_period_start: IsoDate;
  pay_period_end: IsoDate;
  gross_pay_php: PhpAmount;
  night_diff_php: PhpAmount;
  overtime_pay_php: PhpAmount;
  sss_php: PhpAmount;
  philhealth_php: PhpAmount;
  pagibig_php: PhpAmount;
  tax_php: PhpAmount;
  net_pay_php: PhpAmount;
}

/** Per-row outcome from a payroll import, so the UI can cite exact lines. */
export interface PayrollImportRowError {
  /** 1-based line number in the uploaded file, including the header row. */
  line: number;
  column: string | null;
  message: string;
  rawValue: string | null;
}

export interface PayrollImportResult {
  fileName: string;
  totalRows: number;
  recordsProcessed: number;
  recordsFailed: number;
  errors: PayrollImportRowError[];
  /** Totals for the successfully parsed rows, for the post-import summary. */
  totals: {
    gross_php: PhpAmount;
    deductions_php: PhpAmount;
    net_php: PhpAmount;
  };
}

/* ---------------------------------------------------------------------------
 * CALLING / SLA
 * ------------------------------------------------------------------------ */

export interface CallingMetric {
  id: UUID;
  client_id: UUID;
  metric_date: IsoDate;
  total_calls: number;
  answered_calls: number;
  avg_handle_time_sec: number;
  fcr_percentage: number;
  qa_audit_score: number;
}

/** Calling metrics with the derived rates the SLA panels actually render. */
export interface CallingMetricDerived extends CallingMetric {
  /** answered / total, as a percentage. SLA target is 95%. */
  answer_rate: number;
  abandoned_calls: number;
  /** Whether answer rate cleared the contractual target that day. */
  sla_met: boolean;
}

/* ---------------------------------------------------------------------------
 * HR
 * ------------------------------------------------------------------------ */

export interface LeaveRecord {
  id: UUID;
  user_id: UUID;
  leave_date: IsoDate;
  leave_type: LeaveType;
  /** Hours lost. A full shift is 8. */
  hours: number;
  is_approved: boolean;
}

/* ---------------------------------------------------------------------------
 * COMMERCIAL — bill rates (required by the margin simulator)
 * ------------------------------------------------------------------------ */

/**
 * What NorthWinds charges a client per billable seat per month, by department.
 * PRD gap: the original schema modelled cost (hourly_rate_php) but never
 * revenue per head, so gross margin could not be computed at all.
 */
export interface ClientBillRate {
  id: UUID;
  client_id: UUID;
  department_id: UUID;
  monthly_rate_usd: UsdAmount;
  effective_from: IsoDate;
}

/* ---------------------------------------------------------------------------
 * FX
 * ------------------------------------------------------------------------ */

export interface FxRate {
  base: "USD";
  quote: "PHP";
  rate: number;
  /** Date the rate was published by the source. */
  as_of: IsoDate;
  source: "frankfurter" | "cache" | "fallback";
  /** True when the live call failed and we served a cached/last-known value. */
  is_stale: boolean;
}

/* ---------------------------------------------------------------------------
 * DASHBOARD VIEW MODELS
 * These are what panels consume. Each maps to exactly one PRD panel so agents
 * can build against a fixed shape without reading each other's code.
 * ------------------------------------------------------------------------ */

/** Direction of a period-over-period change, and whether it is good news. */
export interface MetricDelta {
  /** Percentage change vs the comparison period. */
  percent: number;
  direction: "up" | "down" | "flat";
  /** Whether this movement is favourable — cost rising is `false`. */
  is_favourable: boolean;
  comparison_label: string;
}

/** PRD §5 — the four executive KPI cards. */
export interface ExecutiveKpis {
  gross_monthly_revenue_usd: UsdAmount;
  revenue_delta: MetricDelta;

  net_payroll_expense_php: PhpAmount;
  net_payroll_expense_usd: UsdAmount;
  payroll_delta: MetricDelta;

  avg_productivity_score: number;
  productivity_delta: MetricDelta;

  active_headcount: number;
  /** Headcount split by shift, for the "shift coverage" sub-line. */
  shift_coverage: Record<ShiftType, number>;

  fx_rate: FxRate;
}

export interface CashFlowPoint {
  date: IsoDate;
  /** Cash actually collected. Null for future dates. */
  actual_usd: UsdAmount | null;
  /** Modelled collections from open invoices. Null for past dates. */
  projected_usd: UsdAmount | null;
  /** Modelled PHP payroll outflow, converted. Always present. */
  payroll_outflow_usd: UsdAmount;
  /** Running cash position. */
  net_position_usd: UsdAmount;
}

export interface ArAgingRow {
  bucket: ArAgingBucket;
  invoice_count: number;
  amount_usd: UsdAmount;
  /** Share of total receivables in this bucket, 0–100. */
  share_percent: number;
}

export interface CashFlowPanelData {
  series: CashFlowPoint[];
  aging: ArAgingRow[];
  overdue_invoices: InvoiceWithClient[];
  total_receivable_usd: UsdAmount;
  total_overdue_usd: UsdAmount;
}

/** PRD §5 — HR departmental tab. */
export interface HrMetrics {
  /** Annualised attrition, percentage. */
  attrition_rate: number;
  /** Mean days from hire to regularization for those who made it. */
  avg_days_to_regularization: number;
  /** Lost hours as a share of scheduled hours, percentage. */
  absence_shrinkage: number;
  headcount_total: number;
  headcount_probationary: number;
  headcount_regular: number;
  exits_last_90d: number;
  hires_last_90d: number;
  attrition_trend: Array<{ month: string; rate: number }>;
  leave_breakdown: Array<{ type: LeaveType; hours: number; share: number }>;
  /**
   * ⚠️ True when these figures are modelled rather than sourced from a real
   * HRIS. Panels MUST surface this to the viewer. See docs/DATA-PROVENANCE.md.
   */
  is_sample_data: boolean;
}

/** PRD §5 — Operations departmental tab. */
export interface OperationsMetrics {
  billable_seats: number;
  non_billable_seats: number;
  /** billable / total, percentage. */
  utilization_rate: number;
  /** Monthly recurring revenue from billable seats. */
  billable_revenue_usd: UsdAmount;
  /** Fully-loaded monthly cost of non-billable seats. */
  overhead_cost_usd: UsdAmount;
  utilization_by_client: Array<{
    client_id: UUID;
    client_code: string;
    billable_seats: number;
    revenue_usd: UsdAmount;
    cost_usd: UsdAmount;
    margin_percent: number;
  }>;
}

/** PRD §5 — Onboarding & Calling departmental tab. */
export interface CallingMetrics {
  total_calls: number;
  answered_calls: number;
  answer_rate: number;
  avg_handle_time_sec: number;
  fcr_percentage: number;
  qa_audit_score: number;
  trend: CallingMetricDerived[];
  by_client: Array<{
    client_id: UUID;
    client_code: string;
    client_name: string;
    total_calls: number;
    answer_rate: number;
    fcr_percentage: number;
    qa_audit_score: number;
    sla_met: boolean;
  }>;
}

/**
 * PRD §5 — inputs to the "what-if" margin simulator.
 *
 * The two `blended_*` fields are the current roster's averages, resolved on
 * the server and passed down. They are part of the INPUT rather than read from
 * the dataset inside the calculator, which is what lets `runMarginSimulator`
 * be a pure function safe to run in the browser — so dragging a slider
 * recomputes instantly instead of round-tripping to the server.
 */
export interface MarginSimulatorInputs {
  headcount: number;
  /** Share of staff on night shift, 0–100. Drives the night-diff premium. */
  night_shift_ratio: number;
  /** Multiplier on current blended bill rate. 1.0 = today's pricing. */
  bill_rate_multiplier: number;
  /** Share of seats that are billable, 0–100. */
  utilization_rate: number;
  usd_php_rate: number;
  /** Mean monthly USD charged per billable seat across the current book. */
  blended_bill_rate_usd: UsdAmount;
  /** Mean PHP hourly cost across the current roster. */
  blended_hourly_php: PhpAmount;
}

export interface MarginSimulatorResult {
  monthly_revenue_usd: UsdAmount;
  monthly_cost_usd: UsdAmount;
  gross_margin_usd: UsdAmount;
  gross_margin_percent: number;
  /** Difference vs the current live baseline, in margin points. */
  margin_delta_points: number;
  cost_breakdown: {
    base_salary_usd: UsdAmount;
    night_differential_usd: UsdAmount;
    statutory_contributions_usd: UsdAmount;
    overhead_usd: UsdAmount;
  };
}

/** PRD §7 — Claude executive briefing. */
export interface AiInsight {
  id: string;
  headline: string;
  body: string;
  severity: "critical" | "warning" | "info";
  category: "financial" | "operational" | "sla" | "workforce";
}

export interface AiInsightResponse {
  insights: AiInsight[];
  generated_at: IsoDateTime;
  /** True when the model call failed and canned guidance was served instead. */
  is_fallback: boolean;
  model: string;
}

/* ---------------------------------------------------------------------------
 * CLIENT PORTAL VIEW MODELS (PRD §6)
 * Every field here is safe to show an external client. Nothing in this section
 * may expose salary, another tenant's data, or keystroke-level monitoring.
 * ------------------------------------------------------------------------ */

/**
 * A staff member as the CLIENT sees them. Note the absence of any pay field —
 * this type exists specifically so payroll data cannot leak into the portal by
 * accident. Do not add compensation fields here.
 */
export interface ClientTeamMember {
  user_id: UUID;
  full_name: string;
  job_title: string;
  department: DepartmentName;
  shift: ShiftType;
  status: PresenceStatus;
  /** Tenure in months, a reassurance signal for the client. */
  tenure_months: number;
}

export interface ClientPortalData {
  client: Client;
  team: ClientTeamMember[];
  sla: CallingMetrics;
  invoices: InvoiceWithClient[];
  summary: {
    team_size: number;
    active_now: number;
    outstanding_balance_usd: UsdAmount;
    next_invoice_due: IsoDate | null;
    /** Rolling 30-day answer rate, the headline SLA number. */
    answer_rate_30d: number;
    sla_target: number;
  };
}

/* ---------------------------------------------------------------------------
 * SESSION / AUTH
 * ------------------------------------------------------------------------ */

/**
 * The demo session. Supabase Auth is deferred, so this is produced by the mock
 * auth provider and the persona switcher. The shape intentionally matches what
 * a real `profiles` row joined onto `auth.users` will return, so swapping in
 * Supabase later does not change any consumer.
 */
export interface SessionUser {
  id: UUID;
  email: string;
  full_name: string;
  role: UserRole;
  client_id: UUID | null;
  client_name: string | null;
  department_id: UUID | null;
}

/** Roles permitted to reach the internal console. */
export const INTERNAL_ROLES: readonly UserRole[] = [
  "ceo_admin",
  "hr_admin",
  "ops_manager",
] as const;

export function isInternalRole(role: UserRole): boolean {
  return INTERNAL_ROLES.includes(role);
}

/* ---------------------------------------------------------------------------
 * SHARED CONSTANTS
 * ------------------------------------------------------------------------ */

/** Contractual answer-rate target (PRD §6: "Target > 95%"). */
export const SLA_ANSWER_RATE_TARGET = 95;
/** QA audit score below which an account is flagged. */
export const QA_SCORE_TARGET = 90;
/** FCR target percentage. */
export const FCR_TARGET = 90;
/** Statutory night differential premium in the Philippines: 10% of base. */
export const NIGHT_DIFF_PREMIUM = 0.1;
/** Standard monthly billable hours used across cost models. */
export const MONTHLY_HOURS = 174;
/**
 * Used only when live FX and the cache have both failed.
 *
 * Verified against the ECB reference rate on 2026-07-28 (live: 61.707). Keep
 * this within a percent or two of reality: it is the value every USD figure
 * silently switches to during an outage, so a stale constant would move the
 * whole dashboard without anyone noticing. Re-check quarterly.
 */
export const FX_FALLBACK_USD_PHP = 61.7;
