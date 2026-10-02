/**
 * ============================================================================
 * NORTHWINDS INTERNATIONAL — GRACEFUL DEGRADATION HELPER  (PRD §11.1, hardened)
 * ============================================================================
 * The PRD shipped a two-line try/catch. That is not enough for a dashboard the
 * CEO leaves open all day: a single transient 502 from an upstream would show
 * mock numbers with no visible warning, and there was no retry, no timeout and
 * no way for the UI to say "you are looking at cached data".
 *
 * This module keeps the original signature (so PRD call sites still compile)
 * and adds:
 *   - configurable retries with exponential backoff + jitter (avoids the
 *     thundering herd when several panels hydrate at once),
 *   - a hard request timeout via `AbortSignal.timeout`, plus a belt-and-braces
 *     race so a callback that ignores its signal still cannot hang a render,
 *   - a degradation flag, returned and logged, for the "serving cached data"
 *     indicator,
 *   - an in-memory `ServiceHealth` registry (last success / last failure per
 *     service) that the integration-health strip reads.
 *
 * HARD RULE: the fallback path never throws. Whatever happens upstream, the
 * dashboard renders.
 *
 * Isomorphic on purpose — no `server-only` here, because client components
 * that poll an internal route also want the retry/backoff behaviour.
 * ========================================================================= */

import type { IsoDateTime } from "@/lib/types";

/* ---------------------------------------------------------------------------
 * HEALTH REGISTRY
 * ------------------------------------------------------------------------ */

export type ServiceStatus = "healthy" | "degraded" | "down" | "unknown";

/**
 * Rolling health of one external integration. Purely in-memory: it is a
 * per-process cache, not a source of truth, and it resets on redeploy. That is
 * deliberate — persisting it would mean a schema change for a UI affordance.
 */
export interface ServiceHealth {
  /** The `serviceName` passed to `fetchWithFallback`, e.g. "frankfurter". */
  service: string;
  status: ServiceStatus;
  /** Last time the live call succeeded, or null if it never has. */
  last_success_at: IsoDateTime | null;
  /** Last time every attempt of a call failed. */
  last_failure_at: IsoDateTime | null;
  /** Message from the most recent failure, truncated for display. */
  last_error: string | null;
  /** Resets to 0 on any success. Drives `down` vs `degraded`. */
  consecutive_failures: number;
  /** Wall-clock ms of the most recent completed call (success or give-up). */
  last_latency_ms: number | null;
  /** Attempts the most recent call needed (1 = clean first try). */
  last_attempts: number;
  /** True when the most recent call ended on the fallback path. */
  is_degraded: boolean;
  /** Lifetime counters for this process. */
  total_calls: number;
  total_failures: number;
}

/** Failures at or above this count flip a service from `degraded` to `down`. */
export const SERVICE_DOWN_THRESHOLD = 3;

/**
 * Held on `globalThis` so Next's dev-mode module reloading (and the fact that
 * route handlers and RSCs can end up in separate module instances) does not
 * silently give us two half-populated registries.
 */
interface HealthRegistryHolder {
  __northwindsServiceHealth?: Map<string, ServiceHealth>;
}

const holder = globalThis as unknown as HealthRegistryHolder;
const registry: Map<string, ServiceHealth> =
  holder.__northwindsServiceHealth ?? new Map<string, ServiceHealth>();
holder.__northwindsServiceHealth = registry;

function blankHealth(service: string): ServiceHealth {
  return {
    service,
    status: "unknown",
    last_success_at: null,
    last_failure_at: null,
    last_error: null,
    consecutive_failures: 0,
    last_latency_ms: null,
    last_attempts: 0,
    is_degraded: false,
    total_calls: 0,
    total_failures: 0,
  };
}

function entryFor(service: string): ServiceHealth {
  const existing = registry.get(service);
  if (existing) return existing;
  const fresh = blankHealth(service);
  registry.set(service, fresh);
  return fresh;
}

/** Snapshot of one service's health, or a blank record if never called. */
export function getServiceHealth(service: string): ServiceHealth {
  return { ...(registry.get(service) ?? blankHealth(service)) };
}

/** Snapshot of every service seen this process, sorted by name. */
export function getAllServiceHealth(): ServiceHealth[] {
  return Array.from(registry.values())
    .map((h) => ({ ...h }))
    .sort((a, b) => a.service.localeCompare(b.service, "en-US"));
}

/** True when any known integration is currently serving fallback data. */
export function isAnyServiceDegraded(): boolean {
  for (const health of registry.values()) {
    if (health.is_degraded) return true;
  }
  return false;
}

/** Test/demo hook — clears one service, or the whole registry when omitted. */
export function resetServiceHealth(service?: string): void {
  if (service === undefined) registry.clear();
  else registry.delete(service);
}

export function recordServiceSuccess(
  service: string,
  latencyMs: number,
  attempts: number,
): ServiceHealth {
  const entry = entryFor(service);
  entry.status = "healthy";
  entry.last_success_at = new Date().toISOString();
  entry.last_error = null;
  entry.consecutive_failures = 0;
  entry.last_latency_ms = latencyMs;
  entry.last_attempts = attempts;
  entry.is_degraded = false;
  entry.total_calls += 1;
  return { ...entry };
}

export function recordServiceFailure(
  service: string,
  error: unknown,
  latencyMs: number,
  attempts: number,
): ServiceHealth {
  const entry = entryFor(service);
  entry.consecutive_failures += 1;
  entry.status =
    entry.consecutive_failures >= SERVICE_DOWN_THRESHOLD ? "down" : "degraded";
  entry.last_failure_at = new Date().toISOString();
  entry.last_error = describeError(error);
  entry.last_latency_ms = latencyMs;
  entry.last_attempts = attempts;
  entry.is_degraded = true;
  entry.total_calls += 1;
  entry.total_failures += 1;
  return { ...entry };
}

/* ---------------------------------------------------------------------------
 * ERRORS
 * ------------------------------------------------------------------------ */

export class ServiceTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(service: string, timeoutMs: number) {
    super(`${service} timed out after ${timeoutMs}ms`);
    this.name = "ServiceTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** Normalises anything a `catch` can receive into a short display string. */
export function describeError(error: unknown, maxLength = 200): string {
  let text: string;
  if (error instanceof Error) {
    text = error.message || error.name;
  } else if (typeof error === "string") {
    text = error;
  } else {
    try {
      text = JSON.stringify(error) ?? String(error);
    } catch {
      text = String(error);
    }
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/* ---------------------------------------------------------------------------
 * OPTIONS & RESULT
 * ------------------------------------------------------------------------ */

export interface FetchWithFallbackOptions {
  /** Extra attempts after the first. Default 2 → up to 3 attempts total. */
  retries?: number;
  /** Per-attempt budget, enforced with `AbortSignal.timeout`. Default 6000ms. */
  timeoutMs?: number;
  /** First backoff step. Doubles each retry. Default 250ms. */
  baseDelayMs?: number;
  /** Ceiling on a single backoff wait. Default 4000ms. */
  maxDelayMs?: number;
  /**
   * Jitter share, 0–1. 0 = pure exponential, 1 = full jitter (delay is drawn
   * uniformly from `[0, exponential]`). Default 0.5.
   */
  jitter?: number;
  /** Caller cancellation. When it aborts we stop immediately and degrade. */
  signal?: AbortSignal;
  /** Return false to give up early — e.g. on a 4xx that will never succeed. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Notified once, only when the call ends up on the fallback path. */
  onDegraded?: (info: DegradationInfo) => void;
  /** Suppress the console.warn (useful in tests and tight polling loops). */
  silent?: boolean;
  /** Injectable RNG so backoff jitter can be made deterministic in tests. */
  random?: () => number;
}

export interface DegradationInfo {
  service: string;
  attempts: number;
  error: string;
  latency_ms: number;
  at: IsoDateTime;
}

export interface FallbackResult<T> {
  data: T;
  /** True when `data` is the fallback, i.e. the UI should show the badge. */
  degraded: boolean;
  source: "live" | "fallback";
  service: string;
  attempts: number;
  /** Description of the final failure, or null on success. */
  error: string | null;
  latency_ms: number;
  health: ServiceHealth;
}

const DEFAULTS = {
  retries: 2,
  timeoutMs: 6_000,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  jitter: 0.5,
} as const;

/* ---------------------------------------------------------------------------
 * INTERNALS
 * ------------------------------------------------------------------------ */

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Exponential backoff with jitter. Exported because the retry curve is a
 * product decision (how long the CEO stares at a spinner) and deserves a test.
 *
 * `attempt` is 0-based: 0 is the wait *before* the first retry.
 */
export function computeBackoffDelay(
  attempt: number,
  options: Pick<
    FetchWithFallbackOptions,
    "baseDelayMs" | "maxDelayMs" | "jitter" | "random"
  > = {},
): number {
  const base = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const max = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const jitterShare = clamp01(options.jitter ?? DEFAULTS.jitter);
  const random = options.random ?? Math.random;

  const exponential = Math.min(max, base * Math.pow(2, Math.max(0, attempt)));
  // Decorrelated "equal jitter": keep a fixed floor, randomise the remainder.
  const fixed = exponential * (1 - jitterShare);
  const variable = exponential * jitterShare * random();
  return Math.round(fixed + variable);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** `AbortSignal.timeout` where available, with a manual-controller fallback. */
function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal | undefined;
  dispose: () => void;
} {
  if (typeof AbortSignal === "undefined") {
    return { signal: undefined, dispose: () => {} };
  }
  const timeoutFactory = (
    AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }
  ).timeout;
  if (typeof timeoutFactory === "function") {
    return { signal: timeoutFactory.call(AbortSignal, timeoutMs), dispose: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

/**
 * Races the work against a timer. The signal is the polite mechanism; the race
 * is the guarantee — a callback that ignores its signal (a slow JSON parse, a
 * mock that awaits forever) still cannot stall a server render.
 */
async function runAttempt<T>(
  primaryApiCall: (signal: AbortSignal) => Promise<T>,
  serviceName: string,
  timeoutMs: number,
): Promise<T> {
  const { signal, dispose } = createTimeoutSignal(timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = Promise.resolve().then(() =>
      primaryApiCall(signal ?? new AbortController().signal),
    );
    const guard = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new ServiceTimeoutError(serviceName, timeoutMs)),
        timeoutMs,
      );
    });
    return await Promise.race([work, guard]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    dispose();
  }
}

/* ---------------------------------------------------------------------------
 * PUBLIC API
 * ------------------------------------------------------------------------ */

/**
 * Full-detail variant. Use this when the panel wants to render a "serving
 * cached data" badge; use `fetchWithFallback` when it only wants the value.
 *
 * `primaryApiCall` may take an `AbortSignal` — pass it to `fetch` and the
 * request is genuinely cancelled on timeout. A zero-arg callback (the PRD
 * signature) is assignable here, so old call sites are unaffected.
 *
 * This function does not throw. Ever.
 */
export async function fetchWithFallbackDetailed<T>(
  primaryApiCall: (signal: AbortSignal) => Promise<T>,
  mockFallback: T,
  serviceName: string,
  options: FetchWithFallbackOptions = {},
): Promise<FallbackResult<T>> {
  const retries = Math.max(0, Math.trunc(options.retries ?? DEFAULTS.retries));
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULTS.timeoutMs);
  const startedAt = Date.now();

  let attempts = 0;
  let lastError: unknown = new Error(`${serviceName}: no attempt was made`);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) {
      lastError = new Error(`${serviceName}: cancelled by caller`);
      break;
    }
    attempts = attempt + 1;
    try {
      const data = await runAttempt(primaryApiCall, serviceName, timeoutMs);
      const latency = Date.now() - startedAt;
      const health = recordServiceSuccess(serviceName, latency, attempts);
      return {
        data,
        degraded: false,
        source: "live",
        service: serviceName,
        attempts,
        error: null,
        latency_ms: latency,
        health,
      };
    } catch (error: unknown) {
      lastError = error;
      const isLastAttempt = attempt === retries;
      const retryAllowed = options.shouldRetry
        ? safeShouldRetry(options.shouldRetry, error, attempt)
        : true;
      if (isLastAttempt || !retryAllowed || options.signal?.aborted) break;
      await sleep(computeBackoffDelay(attempt, options), options.signal);
    }
  }

  /* ----- fallback path: from here on, nothing is allowed to throw --------- */
  const latency = Date.now() - startedAt;
  const message = describeError(lastError);
  let health: ServiceHealth;
  try {
    health = recordServiceFailure(serviceName, lastError, latency, attempts);
  } catch {
    health = blankHealth(serviceName);
  }

  const info: DegradationInfo = {
    service: serviceName,
    attempts,
    error: message,
    latency_ms: latency,
    at: new Date().toISOString(),
  };

  if (!options.silent) {
    try {
      console.warn(
        `[API Degradation] ${serviceName} failed after ${attempts} attempt(s) in ${latency}ms. Serving cached/mock state.`,
        message,
      );
    } catch {
      /* a console that throws must not take the dashboard with it */
    }
  }
  if (options.onDegraded) {
    try {
      options.onDegraded(info);
    } catch {
      /* a bad listener must not turn a degradation into an outage */
    }
  }

  return {
    data: mockFallback,
    degraded: true,
    source: "fallback",
    service: serviceName,
    attempts,
    error: message,
    latency_ms: latency,
    health,
  };
}

function safeShouldRetry(
  predicate: (error: unknown, attempt: number) => boolean,
  error: unknown,
  attempt: number,
): boolean {
  try {
    return predicate(error, attempt);
  } catch {
    return false;
  }
}

/**
 * PRD §11.1 signature, preserved. Returns the live value, or `mockFallback`
 * once retries are exhausted. Degradation is recorded in the health registry
 * and logged; call `fetchWithFallbackDetailed` if you need the flag inline.
 */
export async function fetchWithFallback<T>(
  primaryApiCall: (signal: AbortSignal) => Promise<T>,
  mockFallback: T,
  serviceName: string,
  options: FetchWithFallbackOptions = {},
): Promise<T> {
  const result = await fetchWithFallbackDetailed(
    primaryApiCall,
    mockFallback,
    serviceName,
    options,
  );
  return result.data;
}

/**
 * Convenience wrapper for the common case: a JSON GET that must be validated
 * before it is trusted. `validate` narrows `unknown` to `T`; returning null (or
 * throwing) is treated as an upstream failure and triggers the fallback.
 */
export async function fetchJsonWithFallback<T>(
  url: string,
  validate: (payload: unknown) => T | null,
  mockFallback: T,
  serviceName: string,
  options: FetchWithFallbackOptions & { init?: RequestInit } = {},
): Promise<FallbackResult<T>> {
  const { init, ...rest } = options;
  return fetchWithFallbackDetailed<T>(
    async (signal: AbortSignal): Promise<T> => {
      const response = await fetch(url, { ...init, signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
      }
      const payload: unknown = await response.json();
      const validated = validate(payload);
      if (validated === null) {
        throw new Error(`${serviceName}: response failed shape validation`);
      }
      return validated;
    },
    mockFallback,
    serviceName,
    {
      // A 4xx will not fix itself; only retry transport and 5xx failures.
      shouldRetry: (error: unknown): boolean => {
        const message = describeError(error);
        return !/HTTP 4\d\d/.test(message);
      },
      ...rest,
    },
  );
}
