import "server-only";

/**
 * ============================================================================
 * NORTHWINDS INTERNATIONAL — LIVE USD→PHP FX  (real integration, not a mock)
 * ============================================================================
 * NorthWinds bills clients in USD and pays staff in PHP. Every headline number the
 * CEO looks at — net payroll expense in USD, gross margin, the what-if
 * simulator — crosses that boundary, so the rate is on the critical path.
 *
 * SOURCE
 *   https://api.frankfurter.dev/v1/latest?from=USD&to=PHP
 *   ECB daily reference rates. Free, no API key, no account, no rate-limit
 *   headers to babysit — nothing has to be provisioned before a demo.
 *   Published once per working day around 16:00 CET, which is why we cache for
 *   12 hours instead of hitting it on every render.
 *
 *   ⚠️ The PRD-era host `api.frankfurter.app` now 301-redirects to
 *   `api.frankfurter.dev/v1`. `fetch` follows that by default, but hitting the
 *   canonical host directly saves a round trip and removes a moving part.
 *   Verified 2026-07-28: `{"amount":1.0,"base":"USD","date":"2026-07-27",
 *   "rates":{"PHP":61.707}}`.
 *
 * RESOLUTION (mirrors `FxRate.source`)
 *   1. `frankfurter` — live call succeeded and passed validation. is_stale=false
 *   2. `cache`       — last known good value from this process.  is_stale=true
 *   3. `fallback`    — `FX_FALLBACK_USD_PHP`.                    is_stale=true
 *
 * SERVER ONLY
 *   `import "server-only"` above is load-bearing: it makes an accidental import
 *   from a client component a build error rather than a browser CORS mystery.
 *   Nothing here touches `cookies()`/`headers()`, so calling it from a React
 *   Server Component does not opt the route into dynamic rendering.
 * ========================================================================= */

import {
  FX_FALLBACK_USD_PHP,
  type FxRate,
  type IsoDate,
  type PhpAmount,
  type UsdAmount,
} from "@/lib/types";
import {
  fetchWithFallbackDetailed,
  getServiceHealth,
  type ServiceHealth,
} from "@/lib/utils/api-handler";

/* ---------------------------------------------------------------------------
 * CONFIGURATION
 * ------------------------------------------------------------------------ */

export const FX_SERVICE_NAME = "frankfurter";
export const FX_ENDPOINT = "https://api.frankfurter.dev/v1/latest?from=USD&to=PHP";
/** Legacy host from the PRD era. Kept only as documentation of the redirect. */
export const FX_ENDPOINT_LEGACY =
  "https://api.frankfurter.app/latest?from=USD&to=PHP";

/** ECB publishes daily; a half-day cache is generous and still same-day fresh. */
export const FX_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Plausibility band for USD/PHP. The peso has traded in the 40s–60s for two
 * decades (≈61.7 as of 2026-07-27); anything outside 30–100 means the upstream
 * changed shape, inverted the pair, or is serving garbage — all of which must
 * degrade to the fallback rather than silently repricing the whole dashboard.
 */
export const FX_MIN_PLAUSIBLE_RATE = 30;
export const FX_MAX_PLAUSIBLE_RATE = 100;

/**
 * Frankfurter is fast; a long timeout just delays the fallback.
 *
 * These are deliberately tight because this call sits on the critical render
 * path: `getExecutiveKpis()` awaits the rate before any HTML streams, so the
 * retry budget IS the worst-case time-to-first-byte on a cold instance. At
 * 4s × 2 retries a slow upstream meant a ~13 second blank page; at 1.5s × 1
 * the worst case is ~3.2s, and the user still gets correct figures from the
 * cache/fallback chain rather than a spinner.
 */
const FX_TIMEOUT_MS = 1_500;
const FX_RETRIES = 1;

/* ---------------------------------------------------------------------------
 * RESPONSE CONTRACT + VALIDATION
 * Frankfurter returns { amount, base, date, rates: { PHP: number } }.
 * We never hand `unknown` straight to a consumer, and we never use `any`.
 * ------------------------------------------------------------------------ */

export interface FrankfurterLatestResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `YYYY-MM-DD`, and a real calendar date rather than `2026-13-45`. */
function isIsoDateString(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Narrows the upstream payload. Returns null on anything suspicious so the
 * caller can treat it as a failed request: missing/zero/absurd rate, wrong
 * base, a stale-shaped date, or `rates` not being an object of numbers.
 */
export function parseFrankfurterResponse(
  payload: unknown,
): FrankfurterLatestResponse | null {
  if (!isRecord(payload)) return null;

  const { amount, base, date, rates } = payload;

  if (typeof base !== "string" || base.toUpperCase() !== "USD") return null;
  if (!isIsoDateString(date)) return null;
  // `amount` is the quantity the rates are quoted for; anything but 1 would
  // silently scale every peso figure in the product.
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount !== 1) {
    return null;
  }
  if (!isRecord(rates)) return null;

  const php = rates.PHP;
  if (typeof php !== "number" || !Number.isFinite(php) || php <= 0) return null;
  if (php < FX_MIN_PLAUSIBLE_RATE || php > FX_MAX_PLAUSIBLE_RATE) return null;

  return { amount, base: "USD", date, rates: { PHP: php } };
}

/* ---------------------------------------------------------------------------
 * MODULE-LEVEL CACHE
 * Pinned to `globalThis` so dev-mode module reloads and separate RSC/route
 * module instances share one cache instead of each hammering the ECB.
 * ------------------------------------------------------------------------ */

interface FxCacheEntry {
  rate: FxRate;
  /** Epoch ms when the live value was fetched. */
  fetchedAt: number;
}

interface FxCacheHolder {
  __northwindsFxCache?: FxCacheEntry | null;
  __northwindsFxInflight?: Promise<FxRate> | null;
}

const holder = globalThis as unknown as FxCacheHolder;

function readCache(): FxCacheEntry | null {
  return holder.__northwindsFxCache ?? null;
}

function writeCache(entry: FxCacheEntry | null): void {
  holder.__northwindsFxCache = entry;
}

/** Test/demo hook. Forces the next `getUsdPhpRate()` to hit the network. */
export function clearFxCache(): void {
  writeCache(null);
  holder.__northwindsFxInflight = null;
}

/** Inspect the cache without triggering a fetch — used by the health strip. */
export function peekFxCache(): { rate: FxRate; ageMs: number } | null {
  const entry = readCache();
  if (!entry) return null;
  return { rate: entry.rate, ageMs: Date.now() - entry.fetchedAt };
}

/* ---------------------------------------------------------------------------
 * RATE CONSTRUCTION
 * ------------------------------------------------------------------------ */

/** Four decimals is well past what any displayed peso figure can resolve. */
function roundRate(rate: number): number {
  return Math.round(rate * 10_000) / 10_000;
}

function todayIso(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}

function liveRate(response: FrankfurterLatestResponse): FxRate {
  return {
    base: "USD",
    quote: "PHP",
    rate: roundRate(response.rates.PHP),
    as_of: response.date,
    source: "frankfurter",
    is_stale: false,
  };
}

/** Tier 3. Always available, always stale, never throws. */
export function fallbackFxRate(): FxRate {
  return {
    base: "USD",
    quote: "PHP",
    rate: FX_FALLBACK_USD_PHP,
    as_of: todayIso(),
    source: "fallback",
    is_stale: true,
  };
}

/**
 * Tier 2 → tier 3. Whatever we can serve without the network.
 * A cache entry past its TTL is still far better than a hardcoded constant, so
 * it is used regardless of age once the live call has failed; the TTL only
 * governs whether we *skip* the network, not whether the value is usable.
 */
function offlineFxRate(): FxRate {
  const entry = readCache();
  if (entry) {
    return { ...entry.rate, source: "cache", is_stale: true };
  }
  return fallbackFxRate();
}

/* ---------------------------------------------------------------------------
 * PUBLIC API
 * ------------------------------------------------------------------------ */

/**
 * Resolve the USD→PHP rate. Safe to await directly in a Server Component.
 *
 * Never rejects: on total upstream failure it resolves to the cached value, and
 * failing that to `FX_FALLBACK_USD_PHP` with `is_stale: true`. Panels should
 * render `is_stale` as a "rate may be out of date" hint rather than hiding it —
 * a wrong FX rate quietly moves every USD figure on the page.
 */
export async function getUsdPhpRate(): Promise<FxRate> {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < FX_CACHE_TTL_MS) {
    // Fresh within TTL: this is still the live ECB value, not a degradation.
    return { ...cached.rate };
  }

  // Collapse concurrent panel renders onto a single upstream request.
  const inflight = holder.__northwindsFxInflight;
  if (inflight) return inflight;

  const request = resolveRate().finally(() => {
    holder.__northwindsFxInflight = null;
  });
  holder.__northwindsFxInflight = request;
  return request;
}

async function resolveRate(): Promise<FxRate> {
  const result = await fetchWithFallbackDetailed<FxRate>(
    async (signal: AbortSignal): Promise<FxRate> => {
      const response = await fetch(FX_ENDPOINT, {
        signal,
        redirect: "follow",
        headers: { accept: "application/json" },
        // We run our own 12h cache; Next's data cache would double-cache with
        // a different lifetime and make staleness impossible to reason about.
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText} from Frankfurter`,
        );
      }
      const payload: unknown = await response.json();
      const parsed = parseFrankfurterResponse(payload);
      if (parsed === null) {
        throw new Error(
          "Frankfurter payload failed validation (missing/zero/implausible PHP rate)",
        );
      }
      return liveRate(parsed);
    },
    // Pre-computed so the fallback path cannot itself fail.
    offlineFxRate(),
    FX_SERVICE_NAME,
    {
      retries: FX_RETRIES,
      timeoutMs: FX_TIMEOUT_MS,
      baseDelayMs: 200,
      maxDelayMs: 1_500,
      shouldRetry: (error: unknown): boolean => {
        // A 4xx means we are asking wrongly; retrying will not help.
        const message = error instanceof Error ? error.message : String(error);
        return !/HTTP 4\d\d/.test(message);
      },
    },
  );

  if (!result.degraded && result.data.source === "frankfurter") {
    writeCache({ rate: { ...result.data }, fetchedAt: Date.now() });
  }
  return result.data;
}

/** Health of the FX integration, for the dashboard's integration strip. */
export function getFxServiceHealth(): ServiceHealth {
  return getServiceHealth(FX_SERVICE_NAME);
}

/* ---------------------------------------------------------------------------
 * PURE CONVERSION HELPERS
 * Deliberately synchronous and side-effect free so they can be used inside the
 * client-side margin simulator, where the rate arrives as a prop.
 * ------------------------------------------------------------------------ */

/** Accepts either a bare number or an `FxRate`, so call sites stay readable. */
function rateValue(rate: FxRate | number): number {
  const value = typeof rate === "number" ? rate : rate.rate;
  return Number.isFinite(value) && value > 0 ? value : FX_FALLBACK_USD_PHP;
}

/** USD → PHP. Rounds to whole centavos. */
export function usdToPhp(amount: UsdAmount, rate: FxRate | number): PhpAmount {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * rateValue(rate) * 100) / 100;
}

/** PHP → USD. Rounds to whole cents. */
export function phpToUsd(amount: PhpAmount, rate: FxRate | number): UsdAmount {
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount / rateValue(rate)) * 100) / 100;
}
