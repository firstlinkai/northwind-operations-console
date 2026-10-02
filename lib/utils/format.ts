/**
 * ============================================================================
 * NORTHWINDS INTERNATIONAL — SHARED FORMATTERS
 * ============================================================================
 * Every number the product renders goes through this file. Two rules matter
 * more than anything else here:
 *
 * 1. LOCALE IS PINNED TO `en-US` IN EVERY `Intl` CALL.
 *    Never rely on the ambient locale. A Node server on `en-US` and a browser
 *    on `en-PH` (entirely likely for this client) produce different digit
 *    grouping and different currency placement for the same input, and React
 *    throws a hydration error on the mismatch. Passing the locale explicitly
 *    is the only reliable fix.
 *
 * 2. BAD INPUT RENDERS AS AN EM DASH, NEVER "NaN".
 *    Null, undefined and NaN all reach these functions in a dashboard fed by
 *    partially-degraded integrations. "—" is the correct answer for "we don't
 *    have this number"; "NaN" is a bug report from the CEO.
 *
 * Typography: negative values use a real minus sign (U+2212), not a
 * hyphen-minus, so `−1.8%` aligns optically with `+4.2%` in a table column.
 * ========================================================================= */

/** U+2014. Rendered when a value is missing or not a number. */
export const EM_DASH = "—";
/** U+2212 MINUS SIGN. Typographically correct, and the same width as `+`. */
export const MINUS_SIGN = "−";

/** The one locale the entire product formats in. Do not parameterise this. */
const LOCALE = "en-US" as const;

/** Anything a panel might hand a formatter. */
export type Numeric = number | null | undefined;

function isRenderableNumber(value: Numeric): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Swaps ASCII hyphen-minus for U+2212 in an already-formatted string. */
function typographicMinus(text: string): string {
  return text.replace(/-/g, MINUS_SIGN);
}

/* ---------------------------------------------------------------------------
 * INTL CACHE
 * `Intl.NumberFormat` construction is expensive relative to formatting, and
 * these run thousands of times per dashboard render.
 * ------------------------------------------------------------------------ */

const numberFormatCache = new Map<string, Intl.NumberFormat>();

function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  const cached = numberFormatCache.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat(LOCALE, options);
  numberFormatCache.set(key, created);
  return created;
}

/* ---------------------------------------------------------------------------
 * CURRENCY
 * ------------------------------------------------------------------------ */

export interface CurrencyFormatOptions {
  /** Force compact notation: `$28.5K`, `$1.2M`. */
  compact?: boolean;
  /**
   * Auto-switch to compact at or above this magnitude. Ignored when `compact`
   * is set explicitly. Default `Infinity` (never auto-compact).
   */
  compactFrom?: number;
  /** Fraction digits. Defaults: 0 for full notation, 1 for compact. */
  decimals?: number;
  /** Shorthand for `decimals: 2`. */
  showCents?: boolean;
  /** Prefix non-negative values with `+`. Useful in delta columns. */
  showSign?: boolean;
  /** What to render for null/undefined/NaN. Defaults to the em dash. */
  fallback?: string;
}

function formatCurrency(
  value: Numeric,
  currency: "USD" | "PHP",
  options: CurrencyFormatOptions = {},
): string {
  const fallback = options.fallback ?? EM_DASH;
  if (!isRenderableNumber(value)) return fallback;

  const compact =
    options.compact ?? Math.abs(value) >= (options.compactFrom ?? Infinity);
  const decimals =
    options.decimals ?? (options.showCents ? 2 : compact ? 1 : 0);

  const formatted = numberFormat({
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    compactDisplay: "short",
    minimumFractionDigits: compact ? 0 : decimals,
    maximumFractionDigits: decimals,
  }).format(value);

  const signed =
    options.showSign && value > 0 ? `+${formatted}` : formatted;
  return typographicMinus(signed);
}

/**
 * US dollars — client billing, revenue, margin.
 * `formatUsd(28500)` → `$28,500`
 * `formatUsd(28500, { compact: true })` → `$28.5K`
 * `formatUsd(1_200_000, { compact: true })` → `$1.2M`
 */
export function formatUsd(
  value: Numeric,
  options: CurrencyFormatOptions = {},
): string {
  return formatCurrency(value, "USD", options);
}

/**
 * Philippine pesos — payroll and local cost.
 * `formatPhp(1234567)` → `₱1,234,567`
 */
export function formatPhp(
  value: Numeric,
  options: CurrencyFormatOptions = {},
): string {
  return formatCurrency(value, "PHP", options);
}

/** `$28.5K` / `$1.2M`. Shorthand for the compact variant. */
export function formatUsdCompact(value: Numeric, decimals = 1): string {
  return formatUsd(value, { compact: true, decimals });
}

/** `₱1.2M`. Shorthand for the compact variant. */
export function formatPhpCompact(value: Numeric, decimals = 1): string {
  return formatPhp(value, { compact: true, decimals });
}

/* ---------------------------------------------------------------------------
 * PLAIN NUMBERS
 * ------------------------------------------------------------------------ */

export interface NumberFormatOptions {
  decimals?: number;
  compact?: boolean;
  showSign?: boolean;
  fallback?: string;
}

/** `formatNumber(1234567)` → `1,234,567` */
export function formatNumber(
  value: Numeric,
  options: NumberFormatOptions = {},
): string {
  const fallback = options.fallback ?? EM_DASH;
  if (!isRenderableNumber(value)) return fallback;

  const compact = options.compact ?? false;
  const decimals = options.decimals ?? (compact ? 1 : 0);

  const formatted = numberFormat({
    notation: compact ? "compact" : "standard",
    compactDisplay: "short",
    minimumFractionDigits: compact ? 0 : decimals,
    maximumFractionDigits: decimals,
  }).format(value);

  const signed = options.showSign && value > 0 ? `+${formatted}` : formatted;
  return typographicMinus(signed);
}

/**
 * `formatPercent(94.23)` → `94.2%`
 * Input is already a percentage (0–100), matching every `*_percentage` /
 * `*_rate` field in `lib/types.ts`. Do not pass a 0–1 fraction.
 */
export function formatPercent(
  value: Numeric,
  decimals = 1,
  fallback: string = EM_DASH,
): string {
  if (!isRenderableNumber(value)) return fallback;
  const formatted = numberFormat({
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
  return `${typographicMinus(formatted)}%`;
}

/**
 * Period-over-period change with an explicit direction.
 * `formatDelta(4.2)` → `+4.2%`
 * `formatDelta(-1.8)` → `−1.8%`  (U+2212, not a hyphen)
 * `formatDelta(0)` → `0.0%`
 */
export function formatDelta(
  value: Numeric,
  decimals = 1,
  fallback: string = EM_DASH,
): string {
  if (!isRenderableNumber(value)) return fallback;
  const magnitude = numberFormat({
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(value));

  if (value > 0) return `+${magnitude}%`;
  if (value < 0) return `${MINUS_SIGN}${magnitude}%`;
  return `${magnitude}%`;
}

/** `formatHours(42.5)` → `42.5h`. Whole values drop the decimal: `8h`. */
export function formatHours(
  value: Numeric,
  decimals = 1,
  fallback: string = EM_DASH,
): string {
  if (!isRenderableNumber(value)) return fallback;
  const formatted = numberFormat({
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value);
  return `${typographicMinus(formatted)}h`;
}

/**
 * Average handle time and similar durations.
 * `formatDuration(240)` → `4m 00s`
 * `formatDuration(45)` → `45s`
 * `formatDuration(3845)` → `1h 04m 05s`
 * Negative input is clamped to zero — a negative AHT is a data bug, not a value.
 */
export function formatDuration(
  seconds: Numeric,
  fallback: string = EM_DASH,
): string {
  if (!isRenderableNumber(seconds)) return fallback;
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const pad = (n: number): string => String(n).padStart(2, "0");
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(secs)}s`;
  if (minutes > 0) return `${minutes}m ${pad(secs)}s`;
  return `${secs}s`;
}

/* ---------------------------------------------------------------------------
 * DATES
 * All parsing is UTC. A bare `YYYY-MM-DD` parsed as local time lands on the
 * previous day west of Greenwich, which is exactly the class of off-by-one bug
 * that shows up only in production.
 * ------------------------------------------------------------------------ */

function parseIso(value: string | null | undefined): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  // A date-only string is a calendar day: anchor it at UTC midnight.
  const normalised = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00.000Z`
    : value;
  const parsed = new Date(normalised);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const dateFormatCache = new Map<string, Intl.DateTimeFormat>();

function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  const cached = dateFormatCache.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(LOCALE, { timeZone: "UTC", ...options });
  dateFormatCache.set(key, created);
  return created;
}

function datePart(
  date: Date,
  options: Intl.DateTimeFormatOptions,
  type: Intl.DateTimeFormatPartTypes,
): string {
  const parts = dateFormat(options).formatToParts(date);
  return parts.find((part) => part.type === type)?.value ?? "";
}

/**
 * `formatDate("2026-07-28")` → `28 Jul 2026`
 * Day-month-year is what Philippine business documents use. `en-US` would
 * order it `Jul 28, 2026`, so the parts are assembled by hand — the locale
 * stays pinned for month names and numerals, the order is ours.
 */
export function formatDate(
  iso: string | null | undefined,
  fallback: string = EM_DASH,
): string {
  const date = parseIso(iso);
  if (date === null) return fallback;
  const options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
  };
  const day = datePart(date, options, "day");
  const month = datePart(date, options, "month");
  const year = datePart(date, options, "year");
  return `${day} ${month} ${year}`;
}

/** `formatDateShort("2026-07-28")` → `28 Jul`. For dense chart axes. */
export function formatDateShort(
  iso: string | null | undefined,
  fallback: string = EM_DASH,
): string {
  const date = parseIso(iso);
  if (date === null) return fallback;
  const options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };
  const day = datePart(date, options, "day");
  const month = datePart(date, options, "month");
  return `${day} ${month}`;
}

/** `formatMonth("2026-07-28")` → `Jul 2026`. For monthly trend axes. */
export function formatMonth(
  iso: string | null | undefined,
  fallback: string = EM_DASH,
): string {
  const date = parseIso(iso);
  if (date === null) return fallback;
  const options: Intl.DateTimeFormatOptions = { month: "short", year: "numeric" };
  return `${datePart(date, options, "month")} ${datePart(date, options, "year")}`;
}

/** `formatTime("2026-07-28T14:05:00Z")` → `14:05` (UTC, 24-hour). */
export function formatTime(
  iso: string | null | undefined,
  fallback: string = EM_DASH,
): string {
  const date = parseIso(iso);
  if (date === null) return fallback;
  return dateFormat({
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * `formatRelativeTime("2026-07-28T13:57:00Z")` → `3 min ago`
 *
 * ⚠️ HYDRATION: with no `now` argument this reads the wall clock, so the server
 * and the browser will disagree by however long the response took. Either pass
 * an explicit `now` (an anchor the server also used), or call this only from a
 * client component after mount.
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  now: Date | number = Date.now(),
  fallback: string = EM_DASH,
): string {
  const date = parseIso(iso);
  if (date === null) return fallback;

  const nowMs = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(nowMs)) return fallback;

  const deltaSeconds = Math.round((nowMs - date.getTime()) / 1000);
  const future = deltaSeconds < 0;
  const seconds = Math.abs(deltaSeconds);

  const phrase = (value: number, singular: string, plural: string): string => {
    const label = `${value} ${pluralize(value, singular, plural)}`;
    return future ? `in ${label}` : `${label} ago`;
  };

  if (seconds < 45) return future ? "in a moment" : "just now";
  // `min` and `hr` are abbreviations, not words — they do not take an `s`.
  if (seconds < 3600) return phrase(Math.round(seconds / 60), "min", "min");
  if (seconds < 86_400) return phrase(Math.round(seconds / 3600), "hr", "hr");
  if (seconds < 7 * 86_400) return phrase(Math.round(seconds / 86_400), "day", "days");
  return formatDate(iso, fallback);
}

/* ---------------------------------------------------------------------------
 * WORDS
 * ------------------------------------------------------------------------ */

/**
 * Returns the correct noun form for a count — the word only, not the number.
 * `pluralize(1, "invoice")` → `"invoice"`
 * `pluralize(3, "invoice")` → `"invoices"`
 * `pluralize(3, "person", "people")` → `"people"`
 *
 * Use `pluralizeWithCount` when you want `"3 invoices"`.
 */
export function pluralize(count: Numeric, singular: string, plural?: string): string {
  const n = isRenderableNumber(count) ? count : 0;
  if (Math.abs(n) === 1) return singular;
  return plural ?? `${singular}s`;
}

/** `pluralizeWithCount(3, "invoice")` → `"3 invoices"`. */
export function pluralizeWithCount(
  count: Numeric,
  singular: string,
  plural?: string,
): string {
  if (!isRenderableNumber(count)) return `${EM_DASH} ${plural ?? `${singular}s`}`;
  return `${formatNumber(count)} ${pluralize(count, singular, plural)}`;
}
