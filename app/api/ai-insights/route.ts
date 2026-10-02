/**
 * ============================================================================
 * POST /api/ai-insights — Claude executive briefing (PRD §7, hardened)
 * ============================================================================
 * Returns an `AiInsightResponse`. No request body is read.
 *
 * ─── ENVIRONMENT ──────────────────────────────────────────────────────────
 * `.env.example` (the lead owns that file — this block is the documentation
 * for the one variable this route needs):
 *
 *   # Claude API key for the executive briefing (POST /api/ai-insights).
 *   # Server-only: never prefix with NEXT_PUBLIC_ and never import it into a
 *   # client component. If it is absent the endpoint still works — the
 *   # briefing degrades to a deterministic rule-based analysis of the same
 *   # figures, flagged `is_fallback: true` in the response.
 *   ANTHROPIC_API_KEY=sk-ant-...
 *
 * ─── SECURITY ─────────────────────────────────────────────────────────────
 * The PRD's original version of this route had no authentication, no
 * authorisation and no rate limit, and it took the operational payload from
 * the request body. All four are fixed here and none of the fixes may be
 * removed:
 *
 *  1. THE PAYLOAD IS ASSEMBLED SERVER-SIDE.
 *     `getAiInsightPayload()` builds the figures from the query layer on this
 *     process. The request body is never read, never parsed and never
 *     forwarded to the model. Accepting operational data from the caller
 *     would let anyone (a) feed the model fabricated revenue, SLA or payroll
 *     numbers and get an authoritative-looking briefing back, and (b) use the
 *     endpoint as a prompt-injection surface or an oracle for data their own
 *     role is not allowed to read. There is no supported way to influence
 *     what the model sees from outside this file.
 *
 *  2. A SESSION IS REQUIRED — 401 otherwise.
 *
 *  3. ONLY `ceo_admin` MAY CALL THIS — 403 otherwise.
 *     The payload aggregates every tenant's finances, SLAs and workforce
 *     data. `hr_admin` and `ops_manager` are internal but have no business
 *     with cross-tenant revenue and receivables, and a `client_user` reaching
 *     this endpoint is a security incident, not a permissions nit — it is
 *     logged explicitly below.
 *
 *  4. RATE LIMITED — 5 requests / 5 minutes per user, 429 + `Retry-After`.
 *     A held-down "Generate briefing" button would otherwise burn API credit
 *     one Claude call at a time.
 *
 * Error responses are generic strings. The API key and raw SDK errors never
 * cross the network boundary — `lib/ai/insights.ts` swallows upstream failures
 * into the rule-based briefing and logs the detail server-side.
 * ========================================================================= */

import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth/session";
import { generateInsights } from "@/lib/ai/insights";
import { getAiInsightPayload } from "@/lib/data/queries";
import type { UserRole } from "@/lib/types";

/** Reads the session cookie and calls an external API — never prerender it. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------------------------------------------------------------------------
 * POLICY
 * ------------------------------------------------------------------------ */

/**
 * Deliberately NOT `isInternalRole()`. This is the narrowest role list in the
 * product: the briefing sees every client's revenue, receivables and SLA
 * position at once.
 */
const BRIEFING_ROLES: readonly UserRole[] = ["ceo_admin"];

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

/* ---------------------------------------------------------------------------
 * RATE LIMIT
 * In-memory and per-process: it resets on redeploy and does not coordinate
 * across instances. That is the right trade for this deployment (single
 * process, one CEO login) — the goal is to stop a stuck button from spending
 * money, not to defend against a distributed attacker. Swapping in Redis means
 * replacing `consumeRateLimit` and nothing else.
 *
 * Held on `globalThis` so Next's dev-mode module reloading cannot hand out a
 * fresh, empty limiter on every edit.
 * ------------------------------------------------------------------------ */

interface RateLimitHolder {
  __northwindsAiInsightsRateLimit?: Map<string, number[]>;
}

const holder = globalThis as unknown as RateLimitHolder;
const hits: Map<string, number[]> =
  holder.__northwindsAiInsightsRateLimit ?? new Map<string, number[]>();
holder.__northwindsAiInsightsRateLimit = hits;

interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may try again. Only meaningful when blocked. */
  retryAfterSeconds: number;
  remaining: number;
}

function consumeRateLimit(key: string, now = Date.now()): RateLimitResult {
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((at) => at > windowStart);

  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(key, recent);
    const oldest = recent[0] ?? now;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000)
    );
    return { allowed: false, retryAfterSeconds, remaining: 0 };
  }

  recent.push(now);
  hits.set(key, recent);

  // Opportunistic sweep: this map only ever holds a handful of demo personas,
  // but an unbounded map keyed by user id is a slow leak in principle.
  if (hits.size > 100) {
    for (const [otherKey, timestamps] of hits) {
      if (timestamps.every((at) => at <= windowStart)) hits.delete(otherKey);
    }
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: RATE_LIMIT_MAX - recent.length,
  };
}

/* ---------------------------------------------------------------------------
 * HANDLER
 * ------------------------------------------------------------------------ */

export async function POST(): Promise<NextResponse> {
  const user = await getSessionUser();

  if (!user) {
    return NextResponse.json(
      { error: "You need to sign in before generating a briefing." },
      { status: 401 }
    );
  }

  if (!BRIEFING_ROLES.includes(user.role)) {
    // A client_user here means a broken guard upstream or a deliberate probe.
    // Either way it is worth a distinct log line during a demo or a review.
    if (user.role === "client_user") {
      console.warn(
        `[security] client_user ${user.id} attempted POST /api/ai-insights (client_id=${user.client_id ?? "none"}). Cross-tenant briefing access denied.`
      );
    } else {
      console.warn(
        `[security] role "${user.role}" (user ${user.id}) attempted POST /api/ai-insights. Denied.`
      );
    }

    return NextResponse.json(
      { error: "This briefing is restricted to the executive account." },
      { status: 403 }
    );
  }

  const limit = consumeRateLimit(user.id);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Briefings are limited to ${RATE_LIMIT_MAX} every ${RATE_LIMIT_WINDOW_MS / 60_000} minutes. Try again shortly.`,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(limit.retryAfterSeconds),
          "Cache-Control": "no-store",
        },
      }
    );
  }

  try {
    // Server-assembled. Nothing from the request reaches the model — see the
    // security note at the top of this file.
    const payload = await getAiInsightPayload();
    const briefing = await generateInsights(payload);

    return NextResponse.json(briefing, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    // `generateInsights` already absorbs upstream/model failures, so reaching
    // here means the data layer itself failed. Log the detail, return nothing
    // that could describe our internals or credentials.
    console.error(
      "[ai-insights] Failed to assemble the briefing.",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { error: "The briefing could not be generated right now." },
      { status: 500 }
    );
  }
}
