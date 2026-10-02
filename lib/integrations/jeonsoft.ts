/**
 * ============================================================================
 * JEONSOFT PAYROLL CSV — PARSER, ALIAS MAP AND ROW VALIDATOR
 * ============================================================================
 *
 * ⚠️  WRITTEN WITHOUT A REAL JEONSOFT EXPORT.
 *     No sample file from the live JeonSoft instance was available when this
 *     was authored, so this module *defines* the contract rather than matching
 *     one. Everything here is therefore deliberately tolerant:
 *
 *       • headers are matched case-insensitively, in any column order;
 *       • unknown columns are ignored rather than rejected;
 *       • a generous alias table (`JEONSOFT_COLUMN_ALIASES`) covers the header
 *         spellings a Philippine payroll system plausibly emits;
 *       • money accepts `₱`, `PHP`, thousands separators and `(1,234.00)`
 *         negatives; blank means zero;
 *       • dates accept ISO, `MM/DD/YYYY`, `DD/MM/YYYY`, dotted and
 *         month-name forms;
 *       • BOM, CRLF, quoted fields with embedded commas/newlines and blank
 *         trailing lines are all handled.
 *
 *     When the real export lands, change `JEONSOFT_COLUMN_ALIASES` here —
 *     never `JeonSoftCsvRow` in lib/types.ts. See
 *     `docs/jeonsoft-csv-contract.md` for the hand-off document.
 *
 * LINE NUMBERS
 *     Every `PayrollImportRowError.line` is the 1-based *physical* line in the
 *     uploaded file, counting the header row as line 1. The UI quotes these
 *     numbers back to the user in toasts, so they are computed from a
 *     quote-aware scan of the raw text rather than from the record index —
 *     a field containing an embedded newline would otherwise shift every
 *     subsequent number.
 *
 * PARTIAL SUCCESS
 *     A bad row never fails the file. Rows that validate are returned in
 *     `rows`; rows that do not are reported in `errors` and skipped.
 * ========================================================================= */

import { parse, type ParseResult } from "papaparse";

import type {
  IsoDate,
  JeonSoftCsvRow,
  PayrollImportRowError,
  PayrollRecord,
  PhpAmount,
  UUID,
} from "@/lib/types";

/* ---------------------------------------------------------------------------
 * PUBLIC CONSTANTS
 * ------------------------------------------------------------------------ */

/** Every field of the canonical row; also the key space of the alias table. */
export type JeonSoftField = keyof JeonSoftCsvRow;

/**
 * Rounding tolerance for the net-pay arithmetic check, in pesos.
 * JeonSoft rounds each component to the centavo, so a whole-peso allowance is
 * comfortably wider than any legitimate drift while still catching a real
 * data error.
 */
export const NET_PAY_TOLERANCE_PHP = 1.0;

/**
 * Accepted header spellings, per canonical field.
 *
 * Matching is done on a *normalised* form of both sides (see
 * `normaliseHeaderName`): lower-cased, punctuation collapsed to `_`, and the
 * currency tokens `php`/`peso`/`pesos` dropped. That means `Net Pay (PHP)`,
 * `NETPAY`, `net_pay_php` and `Net-Pay` all collapse to `net_pay` and only
 * need listing once — the extra spellings below are kept for documentation
 * value, because this table is the artefact the payroll team will read.
 */
export const JEONSOFT_COLUMN_ALIASES: Readonly<
  Record<JeonSoftField, readonly string[]>
> = {
  employee_id: [
    "employee_id",
    "employee id",
    "employee no",
    "employee number",
    "employee code",
    "emp_id",
    "empid",
    "emp no",
    "emp code",
    "id number",
    "id no",
    "company id",
    "biometrics id",
    "jeonsoft id",
    "payroll id",
  ],
  employee_email: [
    "employee_email",
    "email",
    "e-mail",
    "email address",
    "email_address",
    "e-mail address",
    "e-mail add",
    "work email",
    "company email",
    "employee email",
    "employee e-mail",
  ],
  employee_name: [
    "employee_name",
    "employee name",
    "employee",
    "name",
    "full name",
    "full_name",
    "complete name",
    "employee full name",
  ],
  pay_period_start: [
    "pay_period_start",
    "pay period start",
    "payroll period start",
    "period start",
    "period from",
    "period_from",
    "cut off start",
    "cutoff start",
    "cutoff from",
    "cut-off from",
    "date from",
    "start date",
    "from",
  ],
  pay_period_end: [
    "pay_period_end",
    "pay period end",
    "payroll period end",
    "period end",
    "period to",
    "period_to",
    "cut off end",
    "cutoff end",
    "cutoff to",
    "cut-off to",
    "date to",
    "end date",
    "to",
  ],
  gross_pay_php: [
    "gross_pay_php",
    "gross pay",
    "gross",
    "grosspay",
    "gross pay (php)",
    "gross earnings",
    "gross income",
    "total gross",
    "basic pay",
    "basic salary",
  ],
  night_diff_php: [
    "night_diff_php",
    "night diff",
    "night_diff",
    "nightdiff",
    "night differential",
    "night_differential",
    "night diff pay",
    "night premium",
    "nd",
    "nd pay",
    "nd amount",
  ],
  overtime_pay_php: [
    "overtime_pay_php",
    "overtime pay",
    "overtime",
    "overtime amount",
    "ot",
    "ot pay",
    "ot amount",
    "ot_pay",
    "otpay",
  ],
  sss_php: [
    "sss_php",
    "sss",
    "sss contribution",
    "sss deduction",
    "sss ee",
    "sss ee share",
    "sss employee share",
    "sss premium",
  ],
  philhealth_php: [
    "philhealth_php",
    "philhealth",
    "phil health",
    "phic",
    "phic ee",
    "philhealth contribution",
    "philhealth deduction",
    "philhealth ee",
    "philhealth ee share",
  ],
  pagibig_php: [
    "pagibig_php",
    "pagibig",
    "pag-ibig",
    "pag ibig",
    "pag-ibig contribution",
    "pagibig contribution",
    "pagibig deduction",
    "pagibig ee",
    "hdmf",
    "hdmf ee",
  ],
  tax_php: [
    "tax_php",
    "tax",
    "tax withheld",
    "tax_withheld",
    "withholding tax",
    "w/tax",
    "w tax",
    "wtax",
    "wh tax",
    "income tax",
    "bir tax",
  ],
  net_pay_php: [
    "net_pay_php",
    "net pay",
    "net_pay",
    "netpay",
    "net pay (php)",
    "net",
    "net amount",
    "takehome",
    "take home",
    "take home pay",
    "take-home pay",
  ],
};

/**
 * Columns that must be present in the header for the file to be parseable at
 * all. Their absence is a *file* error (HTTP 400), not a row error.
 *
 * An employee identifier is required too, but either `employee_email` or
 * `employee_id` satisfies it — see `IDENTIFIER_FIELDS`.
 */
export const JEONSOFT_REQUIRED_COLUMNS: readonly JeonSoftField[] = [
  "pay_period_start",
  "pay_period_end",
  "gross_pay_php",
  "net_pay_php",
];

/** At least one of these must be present, and non-empty on every row. */
export const IDENTIFIER_FIELDS: readonly JeonSoftField[] = [
  "employee_email",
  "employee_id",
];

/** Text fields that must carry a value on every row. */
const REQUIRED_TEXT_FIELDS: readonly JeonSoftField[] = ["employee_name"];

/** Money columns. Missing column or blank cell is read as ₱0.00. */
const NUMERIC_FIELDS: readonly JeonSoftField[] = [
  "gross_pay_php",
  "night_diff_php",
  "overtime_pay_php",
  "sss_php",
  "philhealth_php",
  "pagibig_php",
  "tax_php",
  "net_pay_php",
];

const DEDUCTION_FIELDS: readonly JeonSoftField[] = [
  "sss_php",
  "philhealth_php",
  "pagibig_php",
  "tax_php",
];

/** Longest raw cell we will ever quote back to the caller, in characters. */
const MAX_RAW_VALUE_ECHO = 64;

/* ---------------------------------------------------------------------------
 * PUBLIC TYPES
 * ------------------------------------------------------------------------ */

/**
 * How to read an ambiguous `03/04/2026`.
 * `month-first` → 4 March. `day-first` → 3 April.
 */
export type DateOrder = "month-first" | "day-first";

/**
 * The minimum a caller needs to know about a NorthWinds profile in order for the
 * importer to resolve a CSV row to a real person. The data layer owns the
 * directory; this module only consumes it.
 */
export interface EmployeeDirectoryEntry {
  user_id: UUID;
  email: string;
  /** Payroll/biometrics code as it appears in JeonSoft, when one is known. */
  employee_id: string | null;
}

/** A `payroll_records` row before the database assigns id/created_at. */
export type PayrollRecordDraft = Omit<PayrollRecord, "id" | "created_at">;

/**
 * Turns a CSV row's identity columns into a profile id, or `null` when the
 * person is unknown. Injected rather than imported so this module stays
 * independent of the data layer (and unit-testable without it).
 */
export type EmployeeResolver = (
  row: Pick<JeonSoftCsvRow, "employee_email" | "employee_id">
) => UUID | null;

export interface JeonSoftParseOptions {
  /**
   * The data layer's resolver. When supplied, every row must resolve to a
   * profile or it is rejected with a row error. Takes precedence over
   * `employees`.
   */
  resolveEmployee?: EmployeeResolver | null;
  /**
   * Known NorthWinds profiles, as an alternative to `resolveEmployee` — mainly for
   * tests and callers that already hold the directory in memory.
   *
   * When neither option is given the employee check is skipped entirely and
   * resolution is left to the persistence layer.
   */
  employees?: readonly EmployeeDirectoryEntry[] | null;
  /** Force a date interpretation instead of inferring one from the file. */
  dateOrder?: DateOrder;
}

/** One accepted row, with the profile it resolved to (if resolution ran). */
export interface JeonSoftAcceptedRow {
  row: JeonSoftCsvRow;
  /** Null when no directory was supplied, so resolution did not run. */
  user_id: UUID | null;
  /** Physical line the row came from, header counted as line 1. */
  line: number;
}

export interface JeonSoftParseOutcome {
  /** False only when the file could not be read at all (→ HTTP 400). */
  ok: boolean;
  /** Set when `ok` is false. Safe to show a user; never contains file data. */
  fatalError: string | null;
  /** Data rows considered — blank lines and the header are excluded. */
  totalRows: number;
  /** Rows that passed every check. */
  rows: JeonSoftCsvRow[];
  accepted: JeonSoftAcceptedRow[];
  errors: PayrollImportRowError[];
  totals: {
    /** Total earnings: base + night differential + overtime. */
    gross_php: PhpAmount;
    /** SSS + PhilHealth + Pag-IBIG + withholding tax. */
    deductions_php: PhpAmount;
    /** Always exactly `gross_php - deductions_php`. */
    net_php: PhpAmount;
  };
  /** The interpretation actually used for slash/dash dates. */
  dateOrder: DateOrder;
  /** True when the file gave contradictory evidence and we fell back. */
  dateOrderAmbiguous: boolean;
  /** Header cells that matched no known field. Purely informational. */
  unknownColumns: string[];
  /** 1-based physical line the header was found on (>1 if the file has
   *  leading blank lines). */
  headerLine: number;
}

/* ---------------------------------------------------------------------------
 * HEADER NORMALISATION
 * ------------------------------------------------------------------------ */

const CURRENCY_TOKENS = new Set(["php", "peso", "pesos"]);

/**
 * Collapse a header cell to its comparison key.
 *
 * `"  Net Pay (PHP) "` → `net_pay`
 * `"W/Tax"`            → `w_tax`
 * `"PAG-IBIG"`         → `pag_ibig`
 */
export function normaliseHeaderName(raw: string): string {
  const collapsed = raw
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (collapsed === "") return "";

  const tokens = collapsed
    .split("_")
    .filter((token) => token !== "" && !CURRENCY_TOKENS.has(token));

  // Guard the degenerate case of a header literally called "PHP".
  return tokens.length > 0 ? tokens.join("_") : collapsed;
}

/** normalised alias → canonical field. Built once at module load. */
const ALIAS_LOOKUP: ReadonlyMap<string, JeonSoftField> = (() => {
  const map = new Map<string, JeonSoftField>();
  for (const [field, aliases] of Object.entries(JEONSOFT_COLUMN_ALIASES) as Array<
    [JeonSoftField, readonly string[]]
  >) {
    // The canonical name always wins, so register it first.
    map.set(normaliseHeaderName(field), field);
    for (const alias of aliases) {
      const key = normaliseHeaderName(alias);
      if (key !== "" && !map.has(key)) map.set(key, field);
    }
  }
  return map;
})();

/** Which field, if any, a raw header cell denotes. */
export function matchHeader(raw: string): JeonSoftField | null {
  return ALIAS_LOOKUP.get(normaliseHeaderName(raw)) ?? null;
}

interface HeaderMap {
  /** field → column index in the record array. */
  columns: Partial<Record<JeonSoftField, number>>;
  unknownColumns: string[];
}

function buildHeaderMap(headerCells: readonly string[]): HeaderMap {
  const columns: Partial<Record<JeonSoftField, number>> = {};
  const unknownColumns: string[] = [];

  headerCells.forEach((cell, index) => {
    const field = matchHeader(cell);
    if (field === null) {
      const label = cell.trim();
      if (label !== "") unknownColumns.push(label);
      return;
    }
    // Duplicate mappings: the leftmost column wins, unless a later column is
    // an exact canonical-name match (that one is unambiguous).
    if (columns[field] === undefined) {
      columns[field] = index;
    } else if (normaliseHeaderName(cell) === normaliseHeaderName(field)) {
      columns[field] = index;
    }
  });

  return { columns, unknownColumns };
}

/* ---------------------------------------------------------------------------
 * VALUE PARSERS
 * ------------------------------------------------------------------------ */

const BLANK_EQUIVALENTS = /^(?:-{1,2}|–|—|n\/?a|nil|none|null)$/i;

/**
 * Parse a money cell into pesos.
 *
 * Accepts `₱12,345.67`, `PHP 12345.67`, `12 345,67`-free plain decimals,
 * `(1,234.00)` for a negative, a leading `+`, non-breaking spaces, and treats
 * an empty cell (or `-`, `N/A`) as `0`.
 *
 * @returns the amount rounded to the centavo, or `null` if it is not a number.
 */
export function parsePhpAmount(raw: string): PhpAmount | null {
  const trimmed = raw.replace(/\u00a0/g, " ").trim();
  if (trimmed === "" || BLANK_EQUIVALENTS.test(trimmed)) return 0;

  let negative = false;
  let body = trimmed;

  const parenthesised = /^\((.*)\)$/.exec(body);
  if (parenthesised) {
    negative = true;
    body = parenthesised[1];
  }

  body = body
    .replace(/php|peso[s]?/gi, "")
    .replace(/[₱,\s_]/g, "")
    .replace(/^\+/, "");

  // Trailing minus, as some ledger exports emit ("1,234.00-").
  if (body.endsWith("-")) {
    negative = !negative;
    body = body.slice(0, -1);
  }
  if (body.startsWith("-")) {
    negative = !negative;
    body = body.slice(1);
  }

  if (body === "") return 0;
  if (!/^\d*\.?\d+$/.test(body)) return null;

  const value = Number(body);
  if (!Number.isFinite(value)) return null;

  const rounded = Math.round(value * 100) / 100;
  return negative ? -rounded : rounded;
}

const MONTH_NAMES: Readonly<Record<string, number>> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || year < 1900 || year > 2999) {
    return false;
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function toIsoDate(year: number, month: number, day: number): IsoDate | null {
  if (!isRealDate(year, month, day)) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** `2026-07-01`, `2026/7/1`, `20260701` — year-first, never ambiguous. */
const ISO_LIKE = /^(\d{4})[-/.]?(\d{1,2})[-/.]?(\d{1,2})$/;
/** `07/01/2026`, `1-7-2026`, `01.07.26` — order decided by `DateOrder`. */
const SEPARATED = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/;
/** `15-Jul-2026`, `15 July 2026`. */
const DAY_MONTHNAME = /^(\d{1,2})[-\s/]([A-Za-z]{3,9})\.?[-\s/](\d{4})$/;
/** `Jul 15, 2026`, `July 15 2026`. */
const MONTHNAME_DAY = /^([A-Za-z]{3,9})\.?[-\s/](\d{1,2}),?[-\s/](\d{4})$/;

function expandTwoDigitYear(raw: string): number {
  const n = Number(raw);
  if (raw.length === 4) return n;
  // Payroll files are never historical enough for this to bite: 70+ → 19xx.
  return n >= 70 ? 1900 + n : 2000 + n;
}

/**
 * Parse a date cell to `YYYY-MM-DD`, or `null` if it is not a usable date.
 *
 * Disambiguation (documented in docs/jeonsoft-csv-contract.md):
 *  1. A 4-digit leading component is always the year.
 *  2. Otherwise `order` decides, and `order` is inferred once for the whole
 *     file by `detectDateOrder` — a single unambiguous cell (a component
 *     greater than 12) settles it for every row.
 *  3. With no evidence either way we default to `month-first`, because the
 *     export is produced on a Windows host whose default locale is en-US.
 */
export function parseCsvDate(raw: string, order: DateOrder): IsoDate | null {
  const value = raw.replace(/\u00a0/g, " ").trim();
  if (value === "" || BLANK_EQUIVALENTS.test(value)) return null;

  // Strip a trailing time component: "2026-07-15 00:00:00" / "…T00:00:00Z".
  const dateOnly = value.split(/[T\s]/)[0];

  const iso = ISO_LIKE.exec(dateOnly);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const sep = SEPARATED.exec(dateOnly);
  if (sep) {
    const first = Number(sep[1]);
    const second = Number(sep[2]);
    const year = expandTwoDigitYear(sep[3]);
    // A component over 12 can only be a day, whatever the nominal order.
    const dayFirst =
      first > 12 ? true : second > 12 ? false : order === "day-first";
    return dayFirst
      ? toIsoDate(year, second, first)
      : toIsoDate(year, first, second);
  }

  const dmn = DAY_MONTHNAME.exec(value);
  if (dmn) {
    const month = MONTH_NAMES[dmn[2].toLowerCase()];
    if (month === undefined) return null;
    return toIsoDate(Number(dmn[3]), month, Number(dmn[1]));
  }

  const mnd = MONTHNAME_DAY.exec(value);
  if (mnd) {
    const month = MONTH_NAMES[mnd[1].toLowerCase()];
    if (month === undefined) return null;
    return toIsoDate(Number(mnd[3]), month, Number(mnd[2]));
  }

  return null;
}

/**
 * Infer the slash/dash date order for a whole file from its date cells.
 *
 * Files are internally consistent in practice, so one cell with a leading
 * component above 12 proves day-first for every row. Contradictory evidence
 * (both orders "proved") means the file mixes formats: we report it as
 * ambiguous and fall back to `month-first`.
 */
export function detectDateOrder(samples: readonly string[]): {
  order: DateOrder;
  ambiguous: boolean;
} {
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;

  for (const sample of samples) {
    const match = SEPARATED.exec(sample.trim());
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 12 && second <= 12) dayFirstEvidence += 1;
    else if (second > 12 && first <= 12) monthFirstEvidence += 1;
  }

  if (dayFirstEvidence > 0 && monthFirstEvidence === 0) {
    return { order: "day-first", ambiguous: false };
  }
  return {
    order: "month-first",
    ambiguous: dayFirstEvidence > 0 && monthFirstEvidence > 0,
  };
}

/* ---------------------------------------------------------------------------
 * EMPLOYEE RESOLUTION
 * ------------------------------------------------------------------------ */

/**
 * Resolve a CSV row to a NorthWinds profile id.
 *
 * Email is tried first because it is the stable key across systems;
 * `employee_id` is the fallback for exports where the email column was left
 * blank. Returns `null` when neither matches — the caller turns that into a
 * row error, never an exception.
 */
export function resolveEmployeeUserId(
  row: Pick<JeonSoftCsvRow, "employee_email" | "employee_id">,
  directory: readonly EmployeeDirectoryEntry[]
): UUID | null {
  const email = row.employee_email.trim().toLowerCase();
  if (email !== "") {
    const byEmail = directory.find(
      (entry) => entry.email.trim().toLowerCase() === email
    );
    if (byEmail) return byEmail.user_id;
  }

  const code = row.employee_id.trim().toLowerCase();
  if (code !== "") {
    const byCode = directory.find(
      (entry) =>
        entry.employee_id !== null &&
        entry.employee_id.trim().toLowerCase() === code
    );
    if (byCode) return byCode.user_id;
  }

  return null;
}

/** Wrap a plain directory array as an `EmployeeResolver`. */
export function createEmployeeResolver(
  directory: readonly EmployeeDirectoryEntry[]
): EmployeeResolver {
  return (row) => resolveEmployeeUserId(row, directory);
}

/* ---------------------------------------------------------------------------
 * LINE MAPPING
 * ------------------------------------------------------------------------ */

/**
 * Physical (1-based) start line of every CSV record in `text`.
 *
 * Mirrors PapaParse's segmentation exactly — records are split on newlines
 * that fall outside a quoted field, and a text that ends with a newline
 * yields one final empty record — so index `i` of the returned array is the
 * line of `results.data[i]`.
 */
function mapRecordStartLines(text: string): number[] {
  const starts: number[] = [];
  let line = 1;
  let inQuotes = false;
  let recordOpen = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (!recordOpen) {
      starts.push(line);
      recordOpen = true;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "\n") {
      if (inQuotes) {
        line += 1;
        continue;
      }
      line += 1;
      recordOpen = false;
    }
  }

  // A trailing newline leaves one more (empty) record, matching PapaParse.
  if (!recordOpen) starts.push(line);

  return starts;
}

/* ---------------------------------------------------------------------------
 * PARSER
 * ------------------------------------------------------------------------ */

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Guess the delimiter from the header line, so `,`/`;`/tab all work. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function isBlankRecord(record: readonly string[]): boolean {
  return record.every((cell) => cell.trim() === "");
}

function truncateRaw(raw: string): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > MAX_RAW_VALUE_ECHO
    ? `${flat.slice(0, MAX_RAW_VALUE_ECHO)}…`
    : flat;
}

/** `₱13,401.35` / `-₱500.00` — grouped, sign outside the symbol. */
function money(value: PhpAmount): string {
  const grouped = Math.abs(value)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${value < 0 ? "-" : ""}₱${grouped}`;
}

function emptyOutcome(
  fatalError: string,
  dateOrder: DateOrder = "month-first"
): JeonSoftParseOutcome {
  return {
    ok: false,
    fatalError,
    totalRows: 0,
    rows: [],
    accepted: [],
    errors: [],
    totals: { gross_php: 0, deductions_php: 0, net_php: 0 },
    dateOrder,
    dateOrderAmbiguous: false,
    unknownColumns: [],
    headerLine: 1,
  };
}

/**
 * Tokenise and validate a JeonSoft CSV export.
 *
 * Never throws for bad *data*: malformed rows come back in `errors` with the
 * exact line they sit on. `ok: false` is reserved for a file that cannot be
 * interpreted at all (empty, or missing mandatory columns).
 */
export function parseJeonSoftCsv(
  csvText: string,
  options: JeonSoftParseOptions = {}
): JeonSoftParseOutcome {
  const text = stripBom(csvText);

  if (text.trim() === "") {
    return emptyOutcome("The uploaded file is empty.");
  }

  let parsed: ParseResult<string[]>;
  try {
    parsed = parse<string[]>(text, {
      header: false,
      skipEmptyLines: false,
      delimiter: detectDelimiter(text),
      quoteChar: '"',
      escapeChar: '"',
    });
  } catch {
    // PapaParse is not supposed to throw on a string input, but a corrupt
    // upload must still produce a clean 400 rather than a 500.
    return emptyOutcome("The file could not be read as CSV.");
  }

  const records = parsed.data;
  const recordLines = mapRecordStartLines(text);
  // If segmentation ever disagrees, degrade to index+1 rather than emit a
  // wrong line number.
  const lineFor = (index: number): number =>
    recordLines.length === records.length
      ? (recordLines[index] ?? index + 1)
      : index + 1;

  // ---- header -----------------------------------------------------------
  let headerIndex = -1;
  for (let i = 0; i < records.length; i += 1) {
    if (!isBlankRecord(records[i])) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    return emptyOutcome("The uploaded file contains no rows.");
  }

  const headerLine = lineFor(headerIndex);
  const { columns, unknownColumns } = buildHeaderMap(records[headerIndex]);

  const missing = JEONSOFT_REQUIRED_COLUMNS.filter(
    (field) => columns[field] === undefined
  );
  const hasIdentifierColumn = IDENTIFIER_FIELDS.some(
    (field) => columns[field] !== undefined
  );
  if (missing.length > 0 || !hasIdentifierColumn) {
    const missingLabels: string[] = [...missing];
    if (!hasIdentifierColumn) missingLabels.push("employee_email or employee_id");
    return emptyOutcome(
      `The file is missing required column(s): ${missingLabels.join(", ")}. ` +
        `See docs/jeonsoft-csv-contract.md for the accepted header spellings.`
    );
  }

  const dataIndices: number[] = [];
  for (let i = headerIndex + 1; i < records.length; i += 1) {
    if (!isBlankRecord(records[i])) dataIndices.push(i);
  }

  // ---- date order (one decision for the whole file) ---------------------
  const cellAt = (record: readonly string[], field: JeonSoftField): string => {
    const index = columns[field];
    if (index === undefined) return "";
    return record[index] ?? "";
  };

  const dateSamples: string[] = [];
  for (const index of dataIndices) {
    dateSamples.push(cellAt(records[index], "pay_period_start"));
    dateSamples.push(cellAt(records[index], "pay_period_end"));
  }
  const detected = detectDateOrder(dateSamples);
  const dateOrder = options.dateOrder ?? detected.order;

  // ---- rows -------------------------------------------------------------
  const resolver: EmployeeResolver | null =
    options.resolveEmployee ??
    (options.employees ? createEmployeeResolver(options.employees) : null);
  const errors: PayrollImportRowError[] = [];
  const accepted: JeonSoftAcceptedRow[] = [];

  for (const index of dataIndices) {
    const record = records[index];
    const line = lineFor(index);
    const rowErrors: PayrollImportRowError[] = [];

    const fail = (
      column: JeonSoftField | null,
      message: string,
      rawValue: string | null
    ): void => {
      rowErrors.push({
        line,
        column,
        message,
        rawValue: rawValue === null ? null : truncateRaw(rawValue),
      });
    };

    // Text fields
    const employeeId = cellAt(record, "employee_id").trim();
    const employeeEmail = cellAt(record, "employee_email").trim();
    const employeeName = cellAt(record, "employee_name").trim();

    if (employeeId === "" && employeeEmail === "") {
      fail(
        "employee_email",
        "Row has neither an employee email nor an employee ID, so it cannot be matched to a profile.",
        null
      );
    }
    if (employeeEmail !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employeeEmail)) {
      fail("employee_email", "Employee email is not a valid address.", employeeEmail);
    }
    for (const field of REQUIRED_TEXT_FIELDS) {
      if (cellAt(record, field).trim() === "") {
        fail(field, `Required field "${field}" is empty.`, null);
      }
    }

    // Dates
    const rawStart = cellAt(record, "pay_period_start");
    const rawEnd = cellAt(record, "pay_period_end");
    let startDate: IsoDate | null = null;
    let endDate: IsoDate | null = null;

    if (rawStart.trim() === "") {
      fail("pay_period_start", 'Required field "pay_period_start" is empty.', null);
    } else {
      startDate = parseCsvDate(rawStart, dateOrder);
      if (startDate === null) {
        fail(
          "pay_period_start",
          "Pay period start is not a recognised date (expected YYYY-MM-DD, MM/DD/YYYY or DD/MM/YYYY).",
          rawStart
        );
      }
    }

    if (rawEnd.trim() === "") {
      fail("pay_period_end", 'Required field "pay_period_end" is empty.', null);
    } else {
      endDate = parseCsvDate(rawEnd, dateOrder);
      if (endDate === null) {
        fail(
          "pay_period_end",
          "Pay period end is not a recognised date (expected YYYY-MM-DD, MM/DD/YYYY or DD/MM/YYYY).",
          rawEnd
        );
      }
    }

    if (startDate !== null && endDate !== null && endDate < startDate) {
      fail(
        "pay_period_end",
        `Pay period end (${endDate}) is before pay period start (${startDate}).`,
        rawEnd
      );
    }

    // Money
    const amounts: Partial<Record<JeonSoftField, PhpAmount>> = {};
    let allAmountsParsed = true;

    for (const field of NUMERIC_FIELDS) {
      const rawCell = cellAt(record, field);
      const isRequired = field === "gross_pay_php" || field === "net_pay_php";

      if (isRequired && rawCell.trim() === "") {
        fail(field, `Required field "${field}" is empty.`, null);
        allAmountsParsed = false;
        continue;
      }

      const value = parsePhpAmount(rawCell);
      if (value === null) {
        fail(field, `"${field}" is not a valid peso amount.`, rawCell);
        allAmountsParsed = false;
        continue;
      }
      if (value < 0) {
        fail(field, `"${field}" is negative (${money(value)}); it must be zero or more.`, rawCell);
        allAmountsParsed = false;
        continue;
      }
      amounts[field] = value;
    }

    // Arithmetic sanity — only meaningful once every component is a number.
    if (allAmountsParsed) {
      const gross = amounts.gross_pay_php ?? 0;
      const nightDiff = amounts.night_diff_php ?? 0;
      const overtime = amounts.overtime_pay_php ?? 0;
      const deductions = DEDUCTION_FIELDS.reduce(
        (sum, field) => sum + (amounts[field] ?? 0),
        0
      );
      const supplied = amounts.net_pay_php ?? 0;
      const expected =
        Math.round((gross + nightDiff + overtime - deductions) * 100) / 100;

      if (Math.abs(expected - supplied) > NET_PAY_TOLERANCE_PHP) {
        fail(
          "net_pay_php",
          `Net pay does not reconcile: expected ${money(expected)} ` +
            `(gross + night differential + overtime − SSS, PhilHealth, Pag-IBIG and tax) ` +
            `but the file supplies ${money(supplied)}, a difference of ` +
            `${money(Math.round((supplied - expected) * 100) / 100)}.`,
          cellAt(record, "net_pay_php")
        );
      }
    }

    // Employee resolution (skipped when the caller supplied no resolver).
    let userId: UUID | null = null;
    if (resolver !== null) {
      userId = resolver({
        employee_email: employeeEmail,
        employee_id: employeeId,
      });
      if (userId === null) {
        fail(
          employeeEmail !== "" ? "employee_email" : "employee_id",
          `No NorthWinds profile matches this employee (email "${employeeEmail || "—"}", ` +
            `employee ID "${employeeId || "—"}"). Add the profile first, then re-import.`,
          null
        );
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    const row: JeonSoftCsvRow = {
      employee_id: employeeId,
      employee_email: employeeEmail,
      employee_name: employeeName,
      // Non-null by construction: a null date always produced a row error.
      pay_period_start: startDate as IsoDate,
      pay_period_end: endDate as IsoDate,
      gross_pay_php: amounts.gross_pay_php ?? 0,
      night_diff_php: amounts.night_diff_php ?? 0,
      overtime_pay_php: amounts.overtime_pay_php ?? 0,
      sss_php: amounts.sss_php ?? 0,
      philhealth_php: amounts.philhealth_php ?? 0,
      pagibig_php: amounts.pagibig_php ?? 0,
      tax_php: amounts.tax_php ?? 0,
      net_pay_php: amounts.net_pay_php ?? 0,
    };

    accepted.push({ row, user_id: userId, line });
  }

  const rows = accepted.map((entry) => entry.row);

  return {
    ok: true,
    fatalError: null,
    totalRows: dataIndices.length,
    rows,
    accepted,
    errors,
    totals: summarisePayrollTotals(rows),
    dateOrder,
    dateOrderAmbiguous: options.dateOrder === undefined && detected.ambiguous,
    unknownColumns,
    headerLine,
  };
}

/* ---------------------------------------------------------------------------
 * DERIVATIONS
 * ------------------------------------------------------------------------ */

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Totals for the post-import summary card.
 *
 * `gross_php` is *total earnings* (base + night differential + overtime) so
 * that `gross_php - deductions_php === net_php` holds exactly; showing base
 * pay alone would make the three figures fail to add up on screen.
 */
export function summarisePayrollTotals(rows: readonly JeonSoftCsvRow[]): {
  gross_php: PhpAmount;
  deductions_php: PhpAmount;
  net_php: PhpAmount;
} {
  let gross = 0;
  let deductions = 0;

  for (const row of rows) {
    gross += row.gross_pay_php + row.night_diff_php + row.overtime_pay_php;
    deductions +=
      row.sss_php + row.philhealth_php + row.pagibig_php + row.tax_php;
  }

  const grossRounded = round2(gross);
  const deductionsRounded = round2(deductions);

  return {
    gross_php: grossRounded,
    deductions_php: deductionsRounded,
    net_php: round2(grossRounded - deductionsRounded),
  };
}

/**
 * Map a validated CSV row onto the `payroll_records` shape.
 * Note the deliberate field renames (`sss_php` → `sss_deduction_php` etc.):
 * the CSV contract and the database columns are intentionally separate.
 */
export function toPayrollRecordDraft(
  row: JeonSoftCsvRow,
  userId: UUID
): PayrollRecordDraft {
  return {
    user_id: userId,
    pay_period_start: row.pay_period_start,
    pay_period_end: row.pay_period_end,
    gross_pay_php: row.gross_pay_php,
    night_diff_php: row.night_diff_php,
    overtime_pay_php: row.overtime_pay_php,
    sss_deduction_php: row.sss_php,
    philhealth_deduction_php: row.philhealth_php,
    pagibig_deduction_php: row.pagibig_php,
    tax_withheld_php: row.tax_php,
    net_pay_php: row.net_pay_php,
  };
}

/** Number of distinct rows that failed, given a flat error list. */
export function countFailedRows(errors: readonly PayrollImportRowError[]): number {
  return new Set(errors.map((error) => error.line)).size;
}
