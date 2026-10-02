/**
 * ============================================================================
 * NORTHWINDS INTERNATIONAL — CONTROLIO PRODUCTIVITY CONNECTOR  (PRD §4.2, expanded)
 * ============================================================================
 * PRD §4.2 returned four hardcoded rows. The CEO dashboard's staff heatmap is
 * specified for ~52-60 seats and its whole point is the overtime-vs-
 * productivity flag, which four cherry-picked happy rows can never trigger.
 *
 * This module models a 60-person floor:
 *   - ~90 days of daily history per person (for trend lines and rolling means),
 *   - a current-day snapshot (for the heatmap),
 *   - live `StaffPresence` (for the client portal's "active now" pod),
 *   - four behavioural archetypes, including a deliberate burnout cohort so the
 *     overtime-risk flag actually lights up. A risk panel that never fires is
 *     worse than no panel — it teaches the viewer to ignore it.
 *
 * Realism the mock encodes:
 *   - night-shift staff run longer active blocks and drift more overtime,
 *   - weekends are a skeleton crew (healthcare BPO never fully closes),
 *   - idle time rises as productivity falls, which is what Controlio measures.
 *
 * DETERMINISM: seeded PRNG only, reusing `createSeededRandom` from the
 * QuickBooks module. No `Math.random()`, no `Date.now()` in the data path —
 * server and client must produce byte-identical output or React will throw a
 * hydration error mid-demo.
 * ========================================================================= */

import {
  type IsoDate,
  type IsoDateTime,
  type PresenceStatus,
  type ProductivityLog,
  type ShiftType,
  type StaffPresence,
  type UUID,
} from "@/lib/types";
import { fetchWithFallback } from "@/lib/utils/api-handler";
import {
  createSeededRandom,
  deterministicUuid,
  type SeededRandom,
} from "@/lib/integrations/quickbooks";

// Re-exported so consumers that only touch Controlio can still seed their own
// derived mocks from the same generator.
export { createSeededRandom, deterministicUuid, hashSeed } from "@/lib/integrations/quickbooks";
export type { SeededRandom } from "@/lib/integrations/quickbooks";

/* ---------------------------------------------------------------------------
 * CONFIGURATION
 * ------------------------------------------------------------------------ */

export const CONTROLIO_SERVICE_NAME = "controlio";
export const CONTROLIO_SEED = "northwinds-controlio-v1";

/** Floor size. PRD §5 quotes 52 seats; 60 covers seats plus support staff. */
export const CONTROLIO_STAFF_COUNT = 60;

/** Days of daily history generated backwards from the anchor, inclusive. */
export const CONTROLIO_HISTORY_DAYS = 90;

/**
 * Fixed "now". Same reasoning as `QB_ANCHOR_DATE`: a moving clock would change
 * the snapshot between the server render and hydration.
 * 14:00 UTC = 22:00 Philippine time — deliberately chosen so the heatmap shows
 * a live night shift, an ending mid shift and an offline day shift.
 */
export const CONTROLIO_ANCHOR_DATETIME: IsoDateTime = "2026-07-28T14:00:00.000Z";
export const CONTROLIO_ANCHOR_DATE: IsoDate = CONTROLIO_ANCHOR_DATETIME.slice(
  0,
  10,
);

/** Philippine Standard Time is a fixed UTC+8 — no DST to reason about. */
const PHT_OFFSET_HOURS = 8;

/* ---------------------------------------------------------------------------
 * OVERTIME RISK — the flag the CEO panel exists to surface
 * ------------------------------------------------------------------------ */

/** Daily overtime at or above this is "high". */
export const OVERTIME_RISK_HOURS = 2;
/** Productivity below this is "not paying for itself". */
export const OVERTIME_RISK_SCORE = 75;

/**
 * High overtime + low productivity = burnout or inefficiency, not heroics.
 * Exported so the heatmap, the AI briefing and this generator all agree on one
 * definition rather than each inventing a threshold.
 */
export function isOvertimeRisk(input: {
  overtime_hours: number;
  productivity_score: number;
}): boolean {
  return (
    input.overtime_hours >= OVERTIME_RISK_HOURS &&
    input.productivity_score < OVERTIME_RISK_SCORE
  );
}

/* ---------------------------------------------------------------------------
 * PRD §4.2 CONTRACT
 * ------------------------------------------------------------------------ */

/**
 * Controlio per-user productivity row, camelCase as their reporting API
 * returns it. `logDate`, `shift` and `isNightShift` are additions to the PRD
 * shape: without a date the payload cannot express history, and without the
 * shift the night-differential payroll cross-check has nothing to join on.
 */
export interface ControlioUserStat {
  userId: string;
  userName: string;
  activeHours: number;
  idleHours: number;
  productivityScore: number;
  overtimeHours: number;
  /** Calendar day the row covers, `YYYY-MM-DD`. */
  logDate: string;
  shift: ShiftType;
  isNightShift: boolean;
}

/* ---------------------------------------------------------------------------
 * ROSTER
 * ------------------------------------------------------------------------ */

/** Behavioural archetype driving a person's numbers. */
export type StaffArchetype =
  | "steady"
  | "high_performer"
  | "overtime_risk"
  | "low_engagement";

export interface ControlioStaffProfile {
  index: number;
  userId: UUID;
  userName: string;
  shift: ShiftType;
  isNightShift: boolean;
  archetype: StaffArchetype;
  /** Individual seed so one person's numbers never depend on iteration order. */
  seed: string;
}

const FIRST_NAMES: readonly string[] = [
  "Maria", "Juan", "Grace", "Paolo", "Andrea", "Miguel", "Bea", "Carlo",
  "Divina", "Enrique", "Fatima", "Gabriel", "Hazel", "Ivan", "Jasmine",
  "Kevin", "Liza", "Marco", "Nadine", "Oscar", "Patricia", "Quennie",
  "Ramon", "Sofia", "Teodoro", "Ursula", "Vicente", "Wilma", "Xavier", "Yvonne",
] as const;

const LAST_NAMES: readonly string[] = [
  "Santos", "Dela Cruz", "Tan", "Reyes", "Garcia", "Mendoza", "Bautista",
  "Ocampo", "Villanueva", "Aquino", "Ramos", "Castillo", "Flores", "Navarro",
  "Domingo", "Salazar", "Fernandez", "Torres", "Alonzo", "Gutierrez",
  "Pascual", "Manalo", "Rivera", "Cruz", "Lim", "Yap", "Bernardo", "Espino",
  "Quinto", "Marquez",
] as const;

/**
 * Stable staff identity. Exported so the seed/profile module can build
 * `profiles` rows against exactly these UUIDs — the heatmap joins Controlio
 * stats to profiles by `user_id`, so the two generators must agree.
 */
export function controlioStaffId(index: number): UUID {
  return deterministicUuid("northwinds-staff", `staff-${index}`);
}

function staffName(index: number): string {
  // 7 and 11 are coprime with 30, and the +block offset keeps the second run of
  // 30 from repeating the first — 60 distinct names, no collision handling.
  const block = Math.floor(index / FIRST_NAMES.length);
  const first = FIRST_NAMES[(index * 7) % FIRST_NAMES.length];
  const last = LAST_NAMES[(index * 11 + block) % LAST_NAMES.length];
  return `${first} ${last}`;
}

/**
 * Shift mix for a healthcare BPO serving US clients: the night shift covering
 * US business hours is the largest band.
 */
function shiftForIndex(index: number): ShiftType {
  const slot = index % 20;
  if (slot < 8) return "night"; // 40%
  if (slot < 15) return "day"; // 35%
  return "mid"; // 25%
}

/**
 * Archetype assignment is index-based rather than probabilistic on purpose:
 * it guarantees the burnout cohort exists at a known size. `index % 9 === 4`
 * yields exactly 7 of the 60 staff, which is a credible ~12% at-risk rate and
 * enough to populate the overtime panel without crying wolf.
 */
function archetypeForIndex(index: number): StaffArchetype {
  if (index % 9 === 4) return "overtime_risk";
  if (index % 7 === 2) return "high_performer";
  if (index % 11 === 5) return "low_engagement";
  return "steady";
}

function buildRoster(): ControlioStaffProfile[] {
  const roster: ControlioStaffProfile[] = [];
  for (let index = 0; index < CONTROLIO_STAFF_COUNT; index += 1) {
    const shift = shiftForIndex(index);
    roster.push({
      index,
      userId: controlioStaffId(index),
      userName: staffName(index),
      shift,
      isNightShift: shift === "night",
      archetype: archetypeForIndex(index),
      seed: `${CONTROLIO_SEED}:staff:${index}`,
    });
  }
  return roster;
}

let rosterCache: ControlioStaffProfile[] | null = null;

/** The 60-person floor. Stable for the life of the process. */
export function getControlioRoster(): ControlioStaffProfile[] {
  if (rosterCache === null) rosterCache = buildRoster();
  return rosterCache;
}

/* ---------------------------------------------------------------------------
 * BEHAVIOUR MODEL
 * ------------------------------------------------------------------------ */

interface ArchetypeBand {
  /** Mean daily productivity score and its spread. */
  scoreMean: number;
  scoreSd: number;
  scoreMin: number;
  scoreMax: number;
  /** Mean daily overtime hours and spread. */
  overtimeMean: number;
  overtimeSd: number;
  overtimeMax: number;
  /** Multiplier on idle hours — disengagement shows up as idle time. */
  idleFactor: number;
  /** Probability of taking an unscheduled day off. */
  absenceRate: number;
}

const ARCHETYPE_BANDS: Record<StaffArchetype, ArchetypeBand> = {
  steady: {
    scoreMean: 84,
    scoreSd: 5,
    scoreMin: 70,
    scoreMax: 95,
    overtimeMean: 0.6,
    overtimeSd: 0.5,
    overtimeMax: 2.5,
    idleFactor: 1,
    absenceRate: 0.03,
  },
  high_performer: {
    scoreMean: 93,
    scoreSd: 3,
    scoreMin: 85,
    scoreMax: 99,
    overtimeMean: 0.9,
    overtimeSd: 0.6,
    overtimeMax: 3,
    idleFactor: 0.6,
    absenceRate: 0.015,
  },
  // The cohort the flag is designed to catch: long hours, poor output.
  overtime_risk: {
    scoreMean: 63,
    scoreSd: 5,
    scoreMin: 48,
    scoreMax: 74,
    overtimeMean: 3.1,
    overtimeSd: 0.7,
    overtimeMax: 5,
    idleFactor: 1.9,
    absenceRate: 0.06,
  },
  low_engagement: {
    scoreMean: 70,
    scoreSd: 6,
    scoreMin: 55,
    scoreMax: 84,
    overtimeMean: 0.2,
    overtimeSd: 0.25,
    overtimeMax: 1.2,
    idleFactor: 1.6,
    absenceRate: 0.08,
  },
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function parseIsoDate(iso: IsoDate): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

function addDays(iso: IsoDate, days: number): IsoDate {
  const date = parseIsoDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

/** 0 = Sunday … 6 = Saturday, in UTC. */
function dayOfWeek(iso: IsoDate): number {
  return parseIsoDate(iso).getUTCDay();
}

function isWeekend(iso: IsoDate): boolean {
  const day = dayOfWeek(iso);
  return day === 0 || day === 6;
}

/**
 * Weekend rota: a fixed third of the floor works any given weekend, rotating
 * by week so it is not the same seven people forever.
 */
function worksWeekend(index: number, iso: IsoDate): boolean {
  const weekNumber = Math.floor(parseIsoDate(iso).getTime() / (7 * 86_400_000));
  return (index + weekNumber) % 3 === 0;
}

/** One person's numbers for one day. Pure function of (staff, date). */
function generateDailyStat(
  staff: ControlioStaffProfile,
  logDate: IsoDate,
): ControlioUserStat {
  // Seed per person AND per day so history never shifts when the range grows.
  const rand: SeededRandom = createSeededRandom(`${staff.seed}:${logDate}`);
  const band = ARCHETYPE_BANDS[staff.archetype];
  const weekend = isWeekend(logDate);

  const off =
    (weekend && !worksWeekend(staff.index, logDate)) || rand.bool(band.absenceRate);

  if (off) {
    return {
      userId: staff.userId,
      userName: staff.userName,
      activeHours: 0,
      idleHours: 0,
      productivityScore: 0,
      overtimeHours: 0,
      logDate,
      shift: staff.shift,
      isNightShift: staff.isNightShift,
    };
  }

  // Night shift runs longer uninterrupted blocks; US-hours coverage means
  // fewer local interruptions and measurably higher tracked active time.
  const baseActive = staff.isNightShift ? 7.9 : staff.shift === "mid" ? 7.4 : 7.2;
  // Weekends are lighter even for those rostered on.
  const volume = weekend ? 0.68 : 1;
  // Monday ramp-up / Friday wind-down, both mild.
  const weekdayTilt =
    dayOfWeek(logDate) === 1 ? -0.25 : dayOfWeek(logDate) === 5 ? -0.15 : 0;

  const productivityScore = round1(
    rand.normal(band.scoreMean, band.scoreSd, band.scoreMin, band.scoreMax) *
      (weekend ? 0.97 : 1),
  );

  const overtimeHours = round1(
    Math.max(
      0,
      Math.min(
        band.overtimeMax,
        rand.normal(band.overtimeMean, band.overtimeSd, 0, band.overtimeMax) *
          (weekend ? 0.5 : 1) *
          (staff.isNightShift ? 1.15 : 1),
      ),
    ),
  );

  const activeHours = round1(
    Math.max(
      0.5,
      (baseActive + weekdayTilt) * volume + overtimeHours * 0.8 + rand.float(-0.4, 0.4),
    ),
  );

  // Idle time is the inverse of focus: a 60-score day leaks far more idle time
  // than a 95-score day, and the archetype's idleFactor amplifies that.
  const idleHours = round1(
    Math.max(
      0.1,
      Math.min(
        4.5,
        ((100 - productivityScore) / 100) * 4.2 * band.idleFactor * volume +
          rand.float(-0.15, 0.35),
      ),
    ),
  );

  return {
    userId: staff.userId,
    userName: staff.userName,
    activeHours,
    idleHours,
    productivityScore,
    overtimeHours,
    logDate,
    shift: staff.shift,
    isNightShift: staff.isNightShift,
  };
}

/* ---------------------------------------------------------------------------
 * HISTORY
 * ------------------------------------------------------------------------ */

let historyCache: ControlioUserStat[] | null = null;

function generateHistory(): ControlioUserStat[] {
  const roster = getControlioRoster();
  const rows: ControlioUserStat[] = [];
  for (let back = CONTROLIO_HISTORY_DAYS - 1; back >= 0; back -= 1) {
    const logDate = addDays(CONTROLIO_ANCHOR_DATE, -back);
    for (const staff of roster) {
      rows.push(generateDailyStat(staff, logDate));
    }
  }
  return rows;
}

/* ---------------------------------------------------------------------------
 * PUBLIC API
 * ------------------------------------------------------------------------ */

/**
 * PRD §4.2. One row per staff member for the current (anchor) day — the shape
 * the staff heatmap consumes.
 *
 * PRODUCTION HOOK
 *   GET https://api.controlio.net/api/v1/reports/productivity
 *       ?from={ISO}&to={ISO}&groupBy=user
 *       Authorization: Bearer {CONTROLIO_API_KEY}
 *
 *   Map `user.externalId`→userId (Controlio is provisioned with the NorthWinds
 *   profile UUID as external id), `activeTime`/`idleTime` (seconds)→hours, and
 *   `focusScore`→productivityScore. Overtime is derived against the shift
 *   roster, since Controlio reports time tracked, not time contracted.
 */
export async function fetchControlioStats(): Promise<ControlioUserStat[]> {
  const stats = getControlioHistory().filter(
    (row) => row.logDate === CONTROLIO_ANCHOR_DATE,
  );
  return fetchWithFallback<ControlioUserStat[]>(
    async (): Promise<ControlioUserStat[]> => stats,
    stats,
    CONTROLIO_SERVICE_NAME,
    { silent: true, retries: 0 },
  );
}

/** Full ~90-day daily history for every staff member. Memoised, deterministic. */
export function getControlioHistory(): ControlioUserStat[] {
  if (historyCache === null) historyCache = generateHistory();
  return historyCache;
}

/** Async mirror of `getControlioHistory`, wrapped for health-registry parity. */
export async function fetchControlioHistory(): Promise<ControlioUserStat[]> {
  const history = getControlioHistory();
  return fetchWithFallback<ControlioUserStat[]>(
    async (): Promise<ControlioUserStat[]> => history,
    history,
    CONTROLIO_SERVICE_NAME,
    { silent: true, retries: 0 },
  );
}

/* ---------------------------------------------------------------------------
 * PRESENCE
 * ------------------------------------------------------------------------ */

/** Shift windows in Philippine local hours, `[startHour, endHour)`. */
const SHIFT_WINDOWS: Record<ShiftType, readonly [number, number]> = {
  day: [8, 17],
  mid: [14, 23],
  night: [21, 6],
};

function isWithinShift(shift: ShiftType, localHour: number): boolean {
  const [start, end] = SHIFT_WINDOWS[shift];
  // A window that wraps midnight (night shift) needs the OR form.
  return start < end
    ? localHour >= start && localHour < end
    : localHour >= start || localHour < end;
}

function anchorLocalHour(): number {
  const utcHour = new Date(CONTROLIO_ANCHOR_DATETIME).getUTCHours();
  return (utcHour + PHT_OFFSET_HOURS) % 24;
}

function minutesBefore(anchor: IsoDateTime, minutes: number): IsoDateTime {
  return new Date(new Date(anchor).getTime() - minutes * 60_000).toISOString();
}

/**
 * Live workstation presence. Deliberately coarse (PRD §6): status, heartbeat
 * and idle minutes only — no keystroke-level detail ever reaches the portal.
 *
 * Derived from the anchor instant, not `Date.now()`, so the client portal's
 * "active now" count is identical on the server and after hydration.
 */
export function getControlioPresence(): StaffPresence[] {
  const localHour = anchorLocalHour();
  return getControlioRoster().map((staff): StaffPresence => {
    const rand = createSeededRandom(`${staff.seed}:presence`);
    const onShift = isWithinShift(staff.shift, localHour);

    let status: PresenceStatus;
    if (!onShift) {
      // A few people linger past shift end — overtime staff more than most.
      const lingering = staff.archetype === "overtime_risk" ? 0.35 : 0.08;
      status = rand.bool(lingering) ? "idle" : "offline";
    } else {
      const idleChance = staff.archetype === "high_performer" ? 0.1 : 0.24;
      status = rand.bool(idleChance) ? "idle" : "active";
    }

    const idleMinutes =
      status === "active"
        ? rand.int(0, 6)
        : status === "idle"
          ? rand.int(11, 85)
          : 0;

    const heartbeatAgeMinutes =
      status === "offline" ? rand.int(180, 900) : rand.int(0, 4);

    return {
      user_id: staff.userId,
      status,
      last_heartbeat: minutesBefore(CONTROLIO_ANCHOR_DATETIME, heartbeatAgeMinutes),
      idle_minutes: idleMinutes,
    };
  });
}

/** Async mirror of `getControlioPresence`, for symmetry with the other fetchers. */
export async function fetchControlioPresence(): Promise<StaffPresence[]> {
  const presence = getControlioPresence();
  return fetchWithFallback<StaffPresence[]>(
    async (): Promise<StaffPresence[]> => presence,
    presence,
    CONTROLIO_SERVICE_NAME,
    { silent: true, retries: 0 },
  );
}

/* ---------------------------------------------------------------------------
 * TRANSFORMER
 * ------------------------------------------------------------------------ */

/**
 * Controlio wire shape → the canonical `ProductivityLog` row. The `id` is
 * derived from (user, date) so re-importing a day upserts rather than
 * duplicating.
 */
export function transformControlioStat(stat: ControlioUserStat): ProductivityLog {
  return {
    id: deterministicUuid("controlio-log", `${stat.userId}:${stat.logDate}`),
    user_id: stat.userId,
    log_date: stat.logDate,
    active_hours: stat.activeHours,
    idle_hours: stat.idleHours,
    productivity_score: stat.productivityScore,
    overtime_hours: stat.overtimeHours,
  };
}

/** Convenience: current-day stats already mapped to `ProductivityLog`. */
export async function fetchProductivityLogs(): Promise<ProductivityLog[]> {
  const stats = await fetchControlioStats();
  return stats.map(transformControlioStat);
}

/** Convenience: the whole ~90-day history mapped to `ProductivityLog`. */
export function getProductivityLogHistory(): ProductivityLog[] {
  return getControlioHistory().map(transformControlioStat);
}

/**
 * Staff currently tripping the overtime-risk flag on the anchor day.
 * Exported mainly so the AI briefing and the panel cannot disagree about who
 * is at risk — and so a smoke test can assert the flag is non-empty.
 */
export function getOvertimeRiskStaff(): ControlioUserStat[] {
  return getControlioHistory()
    .filter((row) => row.logDate === CONTROLIO_ANCHOR_DATE)
    .filter((row) =>
      isOvertimeRisk({
        overtime_hours: row.overtimeHours,
        productivity_score: row.productivityScore,
      }),
    );
}
