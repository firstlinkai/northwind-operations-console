/**
 * ============================================================================
 * NORTHWINDS — DETERMINISTIC MOCK DATASET
 * ============================================================================
 * Single source of truth for the demo. Supabase is deferred (see
 * docs/DATA-PROVENANCE.md), so this module generates the entire operational
 * dataset in memory, shaped EXACTLY like the rows `supabase/schema.sql` will
 * return. Swapping to live Postgres means reimplementing `lib/data/queries.ts`
 * against Supabase — nothing in the UI layer changes.
 *
 * TWO NON-NEGOTIABLE PROPERTIES
 *
 * 1. DETERMINISM. Every value derives from a seeded PRNG and a fixed
 *    REFERENCE_DATE. `Math.random()` and `new Date()` are banned in this file.
 *    Server and client must render byte-identical output or React 19 throws
 *    hydration errors — and a demo that shows different numbers on refresh
 *    destroys the CEO's trust in the figures.
 *
 * 2. PLAUSIBILITY. These stand in for a real 60-person Manila BPO. Night-shift
 *    weighting, weekend dips, statutory deductions and attrition are modelled
 *    rather than sprinkled randomly, so the panels tell a coherent story.
 * ========================================================================= */

// Server-only: this module generates every staff record and pay slip in the
// business. It must never be reachable from a client bundle. Small shared
// values (REFERENCE_DATE, client names) live in `lib/constants.ts` precisely
// so client components have somewhere safe to import them from.
import "server-only";

import {
  addDays,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  format,
  isWeekend,
  parseISO,
  subDays,
} from "date-fns";

import {
  CLIENTS,
  CLIENT_IDS,
  DEPARTMENTS,
  DEPARTMENT_IDS,
  HISTORY_DAYS,
  REFERENCE_DATE,
} from "@/lib/constants";

import {
  FX_FALLBACK_USD_PHP,
  MONTHLY_HOURS,
  NIGHT_DIFF_PREMIUM,
  type CallingMetric,
  type Client,
  type ClientBillRate,
  type Department,
  type DepartmentName,
  type EmploymentStatus,
  type FinancialInvoice,
  type InvoiceStatus,
  type IsoDate,
  type LeaveRecord,
  type LeaveType,
  type PayrollRecord,
  type PresenceStatus,
  type Profile,
  type ProductivityLog,
  type SeatType,
  type ShiftType,
  type StaffPresence,
  type UUID,
} from "@/lib/types";

/* ---------------------------------------------------------------------------
 * FIXED CLOCK — defined in `lib/constants.ts` (a leaf module) and re-exported
 * here for server-side convenience. Client components must import it from
 * `@/lib/constants`, never from this file.
 * ------------------------------------------------------------------------ */
export { HISTORY_DAYS, REFERENCE_DATE };
export const REFERENCE_DAY = parseISO(REFERENCE_DATE);

const iso = (d: Date): IsoDate => format(d, "yyyy-MM-dd");
const isoDateTime = (d: Date): string => `${format(d, "yyyy-MM-dd'T'HH:mm:ss")}.000Z`;

/* ---------------------------------------------------------------------------
 * SEEDED PRNG (mulberry32)
 * Small, fast, good enough distribution for demo data, and — crucially —
 * reproducible across Node and the browser.
 * ------------------------------------------------------------------------ */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash so any string key can seed its own reproducible stream. */
export function hashSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const rngFor = (key: string) => createRng(hashSeed(key));

const pick = <T,>(rng: () => number, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)] as T;

const between = (rng: () => number, min: number, max: number): number =>
  min + rng() * (max - min);

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Deterministic UUID-shaped identifier. Not RFC-random, but stable and valid. */
function stableUuid(namespace: string, index: number): UUID {
  const rng = rngFor(`${namespace}:${index}`);
  const hex = (len: number) =>
    Array.from({ length: len }, () => "0123456789abcdef"[Math.floor(rng() * 16)]).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

/* ---------------------------------------------------------------------------
 * CLIENTS — UUIDs preserved from PRD §8 so the seed SQL and the mock layer
 * refer to the same tenants.
 * ------------------------------------------------------------------------ */
export { CLIENT_IDS };
export const clients: Client[] = [...CLIENTS];

/* ---------------------------------------------------------------------------
 * DEPARTMENTS — UUIDs preserved from PRD §8.
 * ------------------------------------------------------------------------ */
export { DEPARTMENT_IDS };
export const departments: Department[] = [...DEPARTMENTS];

const DEPT_NAME_BY_ID: Record<UUID, DepartmentName> = {
  [DEPARTMENT_IDS.hr]: "HR",
  [DEPARTMENT_IDS.operations]: "Operations",
  [DEPARTMENT_IDS.onboarding]: "Onboarding",
  [DEPARTMENT_IDS.calling]: "Calling",
};

export const departmentNameById = (id: UUID | null): DepartmentName | null =>
  id ? (DEPT_NAME_BY_ID[id] ?? null) : null;

/* ---------------------------------------------------------------------------
 * ROSTER CONSTRUCTION
 * 60 ACTIVE staff (the confirmed real headcount), plus 9 exited staff retained
 * so the HR attrition metric has genuine history to compute from.
 * ------------------------------------------------------------------------ */

const FIRST_NAMES = [
  "Maria", "Juan", "Grace", "Paolo", "Andrea", "Miguel", "Katrina", "Jose",
  "Angelica", "Ramon", "Bea", "Carlo", "Divine", "Emmanuel", "Faith", "Gabriel",
  "Hannah", "Ian", "Jasmine", "Kevin", "Liza", "Marco", "Nicole", "Oliver",
  "Patricia", "Quennie", "Rafael", "Sofia", "Tristan", "Ursula", "Victor",
  "Wendy", "Xavier", "Yvonne", "Zeus", "Camille", "Dennis", "Elaine", "Francis",
  "Gina", "Hector", "Isabel", "Jerome", "Kristine", "Lorenzo", "Michelle",
  "Noel", "Olivia", "Pedro", "Rowena", "Samuel", "Teresa", "Ulysses", "Vanessa",
  "Warren", "Ximena", "Yolanda", "Zaldy", "Arnel", "Bianca", "Cesar", "Dolores",
  "Edgar", "Fatima", "Gilbert", "Helena", "Ignacio", "Jocelyn", "Kristoffer",
];

const LAST_NAMES = [
  "Santos", "Dela Cruz", "Reyes", "Tan", "Bautista", "Garcia", "Mendoza",
  "Torres", "Gonzales", "Ramos", "Aquino", "Villanueva", "Castillo", "Flores",
  "Rivera", "Domingo", "Navarro", "Cruz", "Salazar", "Alvarez", "Pascual",
  "Ocampo", "Fernandez", "Manalo", "Lim", "Yap", "Sy", "Chua", "Aguilar",
  "Bacani", "Cabrera", "Dizon", "Estrada", "Fajardo", "Gutierrez", "Hernandez",
];

interface DeptPlan {
  deptId: UUID;
  name: DepartmentName;
  count: number;
  seat: SeatType;
  titles: readonly string[];
  /** PHP hourly band for this department. */
  rate: readonly [number, number];
}

/**
 * Headcount plan. Billable seats sit with client-facing work; HR and a slice of
 * Operations are carried as internal overhead. 50 billable / 10 non-billable
 * gives ~83% utilization, a credible figure for a BPO of this size.
 */
const DEPT_PLAN: readonly DeptPlan[] = [
  {
    deptId: DEPARTMENT_IDS.hr,
    name: "HR",
    count: 6,
    seat: "non_billable",
    titles: [
      "HR Generalist",
      "Recruitment Specialist",
      "Payroll Officer",
      "HR Business Partner",
      "Employee Relations Officer",
      "Talent Acquisition Lead",
    ],
    rate: [190, 330],
  },
  {
    deptId: DEPARTMENT_IDS.operations,
    name: "Operations",
    count: 14,
    seat: "billable",
    titles: [
      "Operations Analyst",
      "Team Lead",
      "Workforce Coordinator",
      "Quality Assurance Analyst",
      "Reporting Analyst",
      "Service Delivery Manager",
    ],
    rate: [210, 450],
  },
  {
    deptId: DEPARTMENT_IDS.onboarding,
    name: "Onboarding",
    count: 10,
    seat: "billable",
    titles: [
      "Credentialing Specialist",
      "Onboarding Coordinator",
      "Compliance Reviewer",
      "Licensure Verification Analyst",
      "Document Specialist",
    ],
    rate: [175, 320],
  },
  {
    deptId: DEPARTMENT_IDS.calling,
    name: "Calling",
    count: 30,
    seat: "billable",
    titles: [
      "Registered Nurse (RN)",
      "Patient Care Coordinator",
      "Triage Nurse",
      "Medical Receptionist",
      "Intake Specialist",
      "Care Navigator",
      "Appointment Scheduler",
    ],
    rate: [165, 380],
  },
];

/** Billable seats per client. Sums to 50. */
const CLIENT_SEAT_PLAN: ReadonlyArray<{ clientId: UUID; seats: number }> = [
  { clientId: CLIENT_IDS.alderBay, seats: 14 },
  { clientId: CLIENT_IDS.kestrel, seats: 12 },
  { clientId: CLIENT_IDS.northlake, seats: 16 },
  { clientId: CLIENT_IDS.ironwood, seats: 8 },
];

/** Four of the 14 Operations seats are internal overhead, not client-billed. */
const OPERATIONS_NON_BILLABLE = 4;

function buildClientAssignmentPool(): UUID[] {
  const pool: UUID[] = [];
  for (const { clientId, seats } of CLIENT_SEAT_PLAN) {
    for (let i = 0; i < seats; i += 1) pool.push(clientId);
  }
  // Deterministic shuffle so client mix is spread across departments rather
  // than clumping all of one client into a single team.
  const rng = rngFor("client-assignment-pool");
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = pool[i] as UUID;
    const b = pool[j] as UUID;
    pool[i] = b;
    pool[j] = a;
  }
  return pool;
}

/**
 * Corporate email addresses.
 *
 * These must look exactly like a real NorthWinds address, because the JeonSoft
 * payroll import resolves employees BY EMAIL — an address with a synthetic
 * index glued on (`maria.santos12@northwinds.example`) would never match a row in a
 * real payroll export, and the import would silently resolve nothing.
 *
 * A `used` set is threaded through so genuine name collisions get a numeric
 * suffix (`maria.santos2@northwinds.example`), which is what a real mail admin would do
 * anyway. Deterministic, because generation order is deterministic.
 */
function nameFor(index: number, used: Set<string>): { full: string; email: string } {
  const rng = rngFor(`name:${index}`);
  const first = FIRST_NAMES[(index * 7 + Math.floor(rng() * 5)) % FIRST_NAMES.length] as string;
  const last = LAST_NAMES[(index * 11 + Math.floor(rng() * 4)) % LAST_NAMES.length] as string;
  const full = `${first} ${last}`;

  const slug = `${first}.${last}`
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z.]/g, "");

  let candidate = `${slug}@northwinds.example`;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${slug}${n}@northwinds.example`;
    n += 1;
  }
  used.add(candidate);

  return { full, email: candidate };
}

/**
 * Shift distribution. NorthWinds's clients are US-based healthcare providers, so
 * the roster is deliberately night-heavy — which is also what drives the
 * statutory night-differential line in the payroll model.
 */
function shiftFor(rng: () => number): ShiftType {
  const r = rng();
  if (r < 0.6) return "night";
  if (r < 0.85) return "mid";
  return "day";
}

function buildProfiles(): Profile[] {
  const out: Profile[] = [];
  const clientPool = buildClientAssignmentPool();
  const usedEmails = new Set<string>();
  let clientCursor = 0;
  let index = 0;

  for (const plan of DEPT_PLAN) {
    for (let i = 0; i < plan.count; i += 1) {
      const rng = rngFor(`profile:${plan.name}:${i}`);
      const { full, email } = nameFor(index, usedEmails);

      // Operations carries a few internal (non-billable) seats.
      const isOpsOverhead =
        plan.name === "Operations" && i < OPERATIONS_NON_BILLABLE;
      const seat_type: SeatType =
        plan.seat === "non_billable" || isOpsOverhead ? "non_billable" : "billable";

      const client_id =
        seat_type === "billable" ? (clientPool[clientCursor++] as UUID) : null;

      // Tenure spread across ~3 years, weighted toward more recent hires
      // (the business has been growing).
      const tenureDays = Math.floor(between(rng, 40, 1080) ** 0.92);
      const hire = subDays(REFERENCE_DAY, tenureDays);
      const hire_date = iso(hire);

      // Philippine practice: probation converts at ~6 months.
      const regularized = tenureDays > 182;
      const employment_status: EmploymentStatus = regularized
        ? "regular"
        : "probationary";
      const regularized_at = regularized
        ? iso(addDays(hire, 180 + Math.floor(between(rng, -8, 14))))
        : null;

      const shift = shiftFor(rng);
      const [lo, hi] = plan.rate;
      // Seniority premium: longer tenure earns toward the top of the band.
      const seniority = Math.min(1, tenureDays / 900);
      const hourly_rate_php = Math.round(
        (lo + (hi - lo) * (0.25 + seniority * 0.6 + rng() * 0.15)) / 5
      ) * 5;

      out.push({
        id: stableUuid("profile", index),
        email,
        full_name: full,
        // Workforce record, never a portal login. See UserRole in lib/types.ts.
        role: "staff",
        client_id,
        department_id: plan.deptId,
        hourly_rate_php,
        is_night_shift: shift === "night",
        shift,
        job_title: pick(rng, plan.titles),
        employment_status,
        seat_type,
        hire_date,
        regularized_at,
        exited_at: null,
        created_at: `${hire_date}T00:00:00.000Z`,
      });
      index += 1;
    }
  }

  // --- Exited staff: retained purely so attrition has real history. --------
  // Shares the active roster's email set so a leaver can never collide with a
  // current employee's address.
  const exitedEmails = usedEmails;
  for (let i = 0; i < 9; i += 1) {
    const rng = rngFor(`exit:${i}`);
    const { full, email } = nameFor(200 + i, exitedEmails);
    const plan = pick(rng, DEPT_PLAN);
    const tenureDays = Math.floor(between(rng, 120, 900));
    const hire = subDays(REFERENCE_DAY, tenureDays);
    // Exits spread across the last 12 months so the trend line has shape.
    const exitedDaysAgo = Math.floor(between(rng, 5, 360));
    const [lo, hi] = plan.rate;

    out.push({
      id: stableUuid("exited", i),
      email,
      full_name: full,
      role: "staff",
      client_id: null,
      department_id: plan.deptId,
      hourly_rate_php: Math.round(between(rng, lo, hi) / 5) * 5,
      is_night_shift: rng() < 0.6,
      shift: shiftFor(rng),
      job_title: pick(rng, plan.titles),
      employment_status: rng() < 0.78 ? "resigned" : "terminated",
      seat_type: "billable",
      hire_date: iso(hire),
      regularized_at: tenureDays > 182 ? iso(addDays(hire, 180)) : null,
      exited_at: iso(subDays(REFERENCE_DAY, exitedDaysAgo)),
      created_at: `${iso(hire)}T00:00:00.000Z`,
    });
  }

  return out;
}

/** All profile rows, active and exited. */
export const profiles: Profile[] = buildProfiles();

/** The 60 currently-employed staff. This is the headline headcount. */
export const activeStaff: Profile[] = profiles.filter((p) => p.exited_at === null);

export const exitedStaff: Profile[] = profiles.filter((p) => p.exited_at !== null);

export const profileById = new Map<UUID, Profile>(profiles.map((p) => [p.id, p]));

/* ---------------------------------------------------------------------------
 * PRODUCTIVITY LOGS — 90 days × 60 active staff
 * ------------------------------------------------------------------------ */

/**
 * A small cohort is deliberately given the high-overtime / low-productivity
 * signature. The CEO's overtime-risk flag exists to catch exactly this, and a
 * panel that never lights up is a panel nobody trusts.
 */
const OVERTIME_RISK_COUNT = 5;
const overtimeRiskIds = new Set<UUID>(
  activeStaff
    .slice()
    .sort((a, b) => (hashSeed(a.id) % 1000) - (hashSeed(b.id) % 1000))
    .slice(0, OVERTIME_RISK_COUNT)
    .map((p) => p.id)
);

export const isOvertimeRiskStaff = (userId: UUID): boolean =>
  overtimeRiskIds.has(userId);

function buildProductivityLogs(): ProductivityLog[] {
  const out: ProductivityLog[] = [];

  for (const staff of activeStaff) {
    const baseline = between(rngFor(`baseline:${staff.id}`), 78, 96);
    const atRisk = overtimeRiskIds.has(staff.id);
    const hiredOn = parseISO(staff.hire_date);

    for (let d = HISTORY_DAYS - 1; d >= 0; d -= 1) {
      const day = subDays(REFERENCE_DAY, d);
      // No logs before someone joined.
      if (differenceInCalendarDays(day, hiredOn) < 0) continue;

      const rng = rngFor(`log:${staff.id}:${d}`);
      const weekend = isWeekend(day);
      // Calling runs a skeleton weekend crew; back office is weekdays only.
      if (weekend && staff.department_id !== DEPARTMENT_IDS.calling && rng() < 0.85) {
        continue;
      }

      const dayFactor = weekend ? 0.55 : 1;
      // Night shift trades a little focus for coverage.
      const shiftPenalty = staff.shift === "night" ? 3.2 : 0;

      const active_hours = round2(between(rng, 6.6, 8.6) * dayFactor);
      let idle_hours = round2(between(rng, 0.2, 1.5) * dayFactor);
      let overtime_hours = rng() < 0.22 ? round2(between(rng, 0.5, 2.5)) : 0;

      let productivity_score = round2(
        Math.max(
          52,
          Math.min(99, baseline - shiftPenalty + between(rng, -6.5, 6.5))
        )
      );

      if (atRisk) {
        // Long hours, degrading output — the burnout signature.
        overtime_hours = round2(between(rng, 2.2, 4.2));
        idle_hours = round2(between(rng, 1.4, 2.9) * dayFactor);
        productivity_score = round2(between(rng, 58, 73));
      }

      out.push({
        id: stableUuid(`plog:${staff.id}`, d),
        user_id: staff.id,
        log_date: iso(day),
        active_hours,
        idle_hours,
        productivity_score,
        overtime_hours,
      });
    }
  }

  return out;
}

export const productivityLogs: ProductivityLog[] = buildProductivityLogs();

/* ---------------------------------------------------------------------------
 * LIVE PRESENCE
 * Coarse by design — the client portal shows presence only, never
 * keystroke-level detail (PRD §6).
 * ------------------------------------------------------------------------ */
function buildPresence(): StaffPresence[] {
  return activeStaff.map((staff) => {
    const rng = rngFor(`presence:${staff.id}`);
    const r = rng();
    // Night shift is mostly on-shift at the reference instant; day shift is not.
    const activeBias = staff.shift === "night" ? 0.7 : staff.shift === "mid" ? 0.52 : 0.3;
    let status: PresenceStatus;
    if (r < activeBias) status = "active";
    else if (r < activeBias + 0.2) status = "idle";
    else status = "offline";

    const idle_minutes =
      status === "idle"
        ? Math.floor(between(rng, 6, 48))
        : status === "offline"
          ? Math.floor(between(rng, 60, 600))
          : 0;

    return {
      user_id: staff.id,
      status,
      last_heartbeat: isoDateTime(subDays(REFERENCE_DAY, 0)),
      idle_minutes,
    };
  });
}

export const staffPresence: StaffPresence[] = buildPresence();
export const presenceByUser = new Map<UUID, StaffPresence>(
  staffPresence.map((p) => [p.user_id, p])
);

/* ---------------------------------------------------------------------------
 * CALLING METRICS — 90 days × 4 clients
 * ------------------------------------------------------------------------ */

/** Per-client operating character, so each account reads differently. */
const CLIENT_SLA_PROFILE: Record<
  UUID,
  { volume: number; answer: number; aht: number; fcr: number; qa: number }
> = {
  [CLIENT_IDS.alderBay]: { volume: 1420, answer: 97.4, aht: 240, fcr: 92.5, qa: 96.8 },
  // Kestrel is the underperformer — the account the CEO needs to see.
  [CLIENT_IDS.kestrel]: { volume: 890, answer: 91.0, aht: 310, fcr: 85.0, qa: 89.2 },
  [CLIENT_IDS.northlake]: { volume: 2100, answer: 98.1, aht: 195, fcr: 95.8, qa: 98.1 },
  [CLIENT_IDS.ironwood]: { volume: 650, answer: 96.9, aht: 280, fcr: 88.0, qa: 91.5 },
};

function buildCallingMetrics(): CallingMetric[] {
  const out: CallingMetric[] = [];

  for (const client of clients) {
    const p = CLIENT_SLA_PROFILE[client.id];
    if (!p) continue;

    for (let d = HISTORY_DAYS - 1; d >= 0; d -= 1) {
      const day = subDays(REFERENCE_DAY, d);
      const rng = rngFor(`calling:${client.id}:${d}`);
      const weekend = isWeekend(day);
      const volumeFactor = weekend ? between(rng, 0.32, 0.48) : between(rng, 0.9, 1.12);

      // Gentle drift so the trend lines have direction, not just noise.
      const drift = ((HISTORY_DAYS - d) / HISTORY_DAYS) * (client.id === CLIENT_IDS.kestrel ? -2.4 : 1.1);

      const total_calls = Math.round(p.volume * volumeFactor);
      const answerRate = Math.max(
        70,
        Math.min(99.6, p.answer + drift + between(rng, -3.2, 2.6))
      );
      const answered_calls = Math.min(total_calls, Math.round((total_calls * answerRate) / 100));

      out.push({
        id: stableUuid(`calling:${client.id}`, d),
        client_id: client.id,
        metric_date: iso(day),
        total_calls,
        answered_calls,
        avg_handle_time_sec: Math.round(p.aht + between(rng, -35, 45)),
        fcr_percentage: round2(
          Math.max(60, Math.min(99, p.fcr + drift + between(rng, -4, 4)))
        ),
        qa_audit_score: round2(
          Math.max(70, Math.min(99.8, p.qa + drift * 0.5 + between(rng, -2.5, 2.5)))
        ),
      });
    }
  }

  return out;
}

export const callingMetrics: CallingMetric[] = buildCallingMetrics();

/* ---------------------------------------------------------------------------
 * BILL RATES
 * Monthly USD charged per billable seat, by client and department. Tuned so
 * blended gross margin lands in the 35–45% band typical of Philippine
 * healthcare BPO work once overhead is carried.
 * ------------------------------------------------------------------------ */
const BASE_SEAT_RATE_USD: Record<DepartmentName, number> = {
  // Tuned against the actual cost model in `lib/calc/margin.ts` to land a
  // blended gross margin near 37%. An earlier pass used rates ~28% lower and
  // produced a 19.6% margin, which is implausibly thin for offshore clinical
  // work and would have had the CEO questioning the model rather than reading
  // it. US healthcare clients pay a premium for licensed nursing staff.
  Calling: 2240,
  Onboarding: 2075,
  Operations: 2535,
  HR: 0, // never billed — internal overhead
};

/** Per-client commercial multiplier reflecting contract vintage and scope. */
const CLIENT_RATE_MULTIPLIER: Record<UUID, number> = {
  [CLIENT_IDS.alderBay]: 1.06,
  [CLIENT_IDS.kestrel]: 0.97,
  [CLIENT_IDS.northlake]: 1.12,
  [CLIENT_IDS.ironwood]: 0.94,
};

function buildBillRates(): ClientBillRate[] {
  const out: ClientBillRate[] = [];
  let i = 0;
  for (const client of clients) {
    for (const dept of departments) {
      const base = BASE_SEAT_RATE_USD[dept.name];
      if (base === 0) continue;
      out.push({
        id: stableUuid("billrate", i++),
        client_id: client.id,
        department_id: dept.id,
        monthly_rate_usd: Math.round(base * (CLIENT_RATE_MULTIPLIER[client.id] ?? 1)),
        effective_from: "2026-01-01",
      });
    }
  }
  return out;
}

export const billRates: ClientBillRate[] = buildBillRates();

export function billRateFor(clientId: UUID | null, departmentId: UUID | null): number {
  if (!clientId || !departmentId) return 0;
  return (
    billRates.find(
      (r) => r.client_id === clientId && r.department_id === departmentId
    )?.monthly_rate_usd ?? 0
  );
}

/* ---------------------------------------------------------------------------
 * INVOICES — ~6 months of monthly billing per client
 * ------------------------------------------------------------------------ */

const INVOICE_MONTHS = 6;

function buildInvoices(): FinancialInvoice[] {
  const out: FinancialInvoice[] = [];
  let seq = 1000;

  for (let m = INVOICE_MONTHS - 1; m >= 0; m -= 1) {
    for (const client of clients) {
      const rng = rngFor(`invoice:${client.id}:${m}`);

      // Monthly value = billable seats on that account × their seat rate.
      const seats = activeStaff.filter(
        (s) => s.client_id === client.id && s.seat_type === "billable"
      );
      const baseAmount = seats.reduce(
        (sum, s) => sum + billRateFor(s.client_id, s.department_id),
        0
      );
      // Volume-based variance (overtime, extra coverage, credits).
      const amount_usd = Math.round(baseAmount * between(rng, 0.94, 1.09));
      if (amount_usd === 0) continue;

      const issued = subDays(REFERENCE_DAY, m * 30 + Math.floor(between(rng, 0, 4)));
      const terms_days = pick(rng, [15, 30, 30, 30, 45]);
      const due = addDays(issued, terms_days);
      const daysPastDue = differenceInCalendarDays(REFERENCE_DAY, due);

      let status: InvoiceStatus;
      let paid_date: IsoDate | null = null;

      if (daysPastDue < 0) {
        status = "Pending";
      } else {
        // Kestrel is the slow payer — this is what lights up AR ageing.
        const paysLate = client.id === CLIENT_IDS.kestrel ? 0.55 : 0.14;

        // Two deliberately aged Kestrel delinquencies. Without them every
        // unpaid invoice was under 60 days old, so the 61-90 and 90+ ageing
        // buckets rendered empty — a receivables panel that never shows aged
        // debt teaches the viewer nothing and looks broken.
        const forcedAged =
          client.id === CLIENT_IDS.kestrel && (m === 3 || m === 5);

        if (forcedAged || (rng() < paysLate && m <= 2)) {
          status = "Overdue";
        } else {
          status = "Paid";
          const lag = Math.floor(
            between(rng, -4, client.id === CLIENT_IDS.kestrel ? 26 : 11)
          );
          paid_date = iso(addDays(due, Math.max(-terms_days + 2, lag)));
        }
      }

      out.push({
        id: stableUuid("invoice", seq),
        qbo_invoice_id: `INV-${seq}`,
        client_id: client.id,
        amount_usd,
        status,
        issued_date: iso(issued),
        due_date: iso(due),
        paid_date,
        terms_days,
        created_at: `${iso(issued)}T00:00:00.000Z`,
      });
      seq += 1;
    }
  }

  return out.sort((a, b) => (a.issued_date < b.issued_date ? 1 : -1));
}

export const invoices: FinancialInvoice[] = buildInvoices();

/* ---------------------------------------------------------------------------
 * PAYROLL — semi-monthly periods over the last 6 months
 * Philippine statutory deductions modelled at credible 2026 rates.
 * ------------------------------------------------------------------------ */

const PAYROLL_PERIODS = 12; // 6 months, semi-monthly

/** Employee-share statutory contributions, approximated for the demo. */
function statutoryDeductions(monthlyGross: number): {
  sss: number;
  philhealth: number;
  pagibig: number;
} {
  // SSS employee share ~4.5%, capped around ₱1,350/month.
  const sss = Math.min(1350, monthlyGross * 0.045);
  // PhilHealth 5% split employer/employee, so 2.5% employee, capped.
  const philhealth = Math.min(2500, monthlyGross * 0.025);
  // Pag-IBIG employee share capped at ₱200/month.
  const pagibig = Math.min(200, monthlyGross * 0.02);
  return { sss, philhealth, pagibig };
}

/** Simplified TRAIN-law graduated withholding on monthly taxable income. */
function withholdingTax(monthlyTaxable: number): number {
  if (monthlyTaxable <= 20833) return 0;
  if (monthlyTaxable <= 33333) return (monthlyTaxable - 20833) * 0.15;
  if (monthlyTaxable <= 66667) return 1875 + (monthlyTaxable - 33333) * 0.2;
  if (monthlyTaxable <= 166667) return 8541.8 + (monthlyTaxable - 66667) * 0.25;
  return 33541.8 + (monthlyTaxable - 166667) * 0.3;
}

function buildPayrollRecords(): PayrollRecord[] {
  const out: PayrollRecord[] = [];
  let seq = 0;

  for (let p = 0; p < PAYROLL_PERIODS; p += 1) {
    const periodEnd = subDays(REFERENCE_DAY, p * 15 + 1);
    const periodStart = subDays(periodEnd, 14);

    for (const staff of activeStaff) {
      if (differenceInCalendarDays(periodStart, parseISO(staff.hire_date)) < 0) continue;

      const rng = rngFor(`payroll:${staff.id}:${p}`);
      const semiMonthlyHours = MONTHLY_HOURS / 2;
      const base = staff.hourly_rate_php * semiMonthlyHours;

      const overtime_pay_php = round2(
        staff.hourly_rate_php * 1.25 * between(rng, 0, 6)
      );
      const night_diff_php = staff.is_night_shift
        ? round2(base * NIGHT_DIFF_PREMIUM)
        : 0;

      const gross_pay_php = round2(base + night_diff_php + overtime_pay_php);
      const monthlyEquivalent = gross_pay_php * 2;

      const { sss, philhealth, pagibig } = statutoryDeductions(monthlyEquivalent);
      const taxable = monthlyEquivalent - (sss + philhealth + pagibig);
      const monthlyTax = withholdingTax(taxable);

      // Halve monthly figures back down to the semi-monthly period.
      const sss_deduction_php = round2(sss / 2);
      const philhealth_deduction_php = round2(philhealth / 2);
      const pagibig_deduction_php = round2(pagibig / 2);
      const tax_withheld_php = round2(monthlyTax / 2);

      const net_pay_php = round2(
        gross_pay_php -
          sss_deduction_php -
          philhealth_deduction_php -
          pagibig_deduction_php -
          tax_withheld_php
      );

      out.push({
        id: stableUuid("payroll", seq++),
        user_id: staff.id,
        pay_period_start: iso(periodStart),
        pay_period_end: iso(periodEnd),
        gross_pay_php,
        night_diff_php,
        overtime_pay_php,
        sss_deduction_php,
        philhealth_deduction_php,
        pagibig_deduction_php,
        tax_withheld_php,
        net_pay_php,
        created_at: `${iso(periodEnd)}T00:00:00.000Z`,
      });
    }
  }

  return out;
}

export const payrollRecords: PayrollRecord[] = buildPayrollRecords();

/* ---------------------------------------------------------------------------
 * LEAVE RECORDS — drives HR absence shrinkage (~3–5% of scheduled hours)
 * ------------------------------------------------------------------------ */

const LEAVE_TYPES: readonly LeaveType[] = [
  "sick",
  "vacation",
  "emergency",
  "unpaid",
  "absent_no_notice",
];

function buildLeaveRecords(): LeaveRecord[] {
  const out: LeaveRecord[] = [];
  let seq = 0;

  for (const staff of activeStaff) {
    for (let d = HISTORY_DAYS - 1; d >= 0; d -= 1) {
      const day = subDays(REFERENCE_DAY, d);
      if (isWeekend(day)) continue;

      const rng = rngFor(`leave:${staff.id}:${d}`);
      // ~4% of scheduled weekdays are lost to absence.
      if (rng() > 0.04) continue;

      const leave_type = pick(rng, LEAVE_TYPES);
      out.push({
        id: stableUuid("leave", seq++),
        user_id: staff.id,
        leave_date: iso(day),
        leave_type,
        hours: rng() < 0.75 ? 8 : 4,
        is_approved: leave_type !== "absent_no_notice" && rng() < 0.92,
      });
    }
  }

  return out;
}

export const leaveRecords: LeaveRecord[] = buildLeaveRecords();

/* ---------------------------------------------------------------------------
 * DERIVED HELPERS shared across queries
 * ------------------------------------------------------------------------ */

/** Fully-loaded monthly employer cost for one staff member, in PHP. */
export function monthlyCostPhp(staff: Profile): number {
  const base = staff.hourly_rate_php * MONTHLY_HOURS;
  const nightDiff = staff.is_night_shift ? base * NIGHT_DIFF_PREMIUM : 0;
  const gross = base + nightDiff;
  // Employer-side statutory burden (SSS/PhilHealth/Pag-IBIG employer share,
  // 13th month accrual, leave provisioning) ≈ 22% on top of gross.
  return gross * 1.22;
}

/** Convenience: the reference date's own logs, used by "today" panels. */
export const todaysLogs = (): ProductivityLog[] =>
  productivityLogs.filter((l) => l.log_date === REFERENCE_DATE);

export const DATASET_META = {
  reference_date: REFERENCE_DATE,
  history_days: HISTORY_DAYS,
  active_headcount: activeStaff.length,
  total_profiles: profiles.length,
  clients: clients.length,
  productivity_log_rows: productivityLogs.length,
  calling_metric_rows: callingMetrics.length,
  payroll_rows: payrollRecords.length,
  leave_rows: leaveRecords.length,
  invoice_rows: invoices.length,
  fx_fallback: FX_FALLBACK_USD_PHP,
} as const;
