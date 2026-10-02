/**
 * ============================================================================
 * AI EXECUTIVE BRIEFING — Claude (PRD §7)
 * ============================================================================
 * Server-only. Turns the aggregated dashboard payload into 3–5 short insights
 * the CEO can act on.
 *
 * ⚠️ DEVIATION FROM THE PRD
 *   The PRD specified OpenAI / gpt-4o. The client chose Claude, so this module
 *   uses `@anthropic-ai/sdk` with `claude-sonnet-5`. The response contract
 *   (`AiInsightResponse`) is unchanged, so no consumer is affected.
 *
 * STRUCTURED OUTPUT
 *   The UI must never parse prose. A single tool (`submit_briefing`) declares
 *   the exact `AiInsight[]` schema, `strict: true` makes the API validate the
 *   model's arguments against it, and `tool_choice` forces that tool — the
 *   model cannot answer in free text. The result is still validated here
 *   before it is trusted (see `parseInsights`), because a schema guarantee we
 *   depend on is a schema guarantee we should verify.
 *
 * FALLBACK — THIS IS NOT A PLACEHOLDER
 *   No API key, a network failure, a timeout, or a response that fails
 *   validation all fall through to `ruleBasedBriefing()`, which derives real
 *   findings from the same payload (SLA breaches, overdue AR, overtime risk,
 *   attrition, margin, utilization). It is flagged `is_fallback: true` with
 *   `model: "rule-based"` so the UI can say so honestly. The demo works with
 *   no key and no network.
 *
 * TIMEOUT
 *   Hard-capped at 20s (SDK request timeout + an AbortSignal), so a hanging
 *   upstream degrades to the rule-based briefing instead of stalling the
 *   dashboard.
 * ========================================================================= */

import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { AiInsightPayload } from "@/lib/data/queries";
import {
  QA_SCORE_TARGET,
  SLA_ANSWER_RATE_TARGET,
  type AiInsight,
  type AiInsightResponse,
} from "@/lib/types";
import { formatNumber, formatPercent, formatUsd } from "@/lib/utils/format";

/* ---------------------------------------------------------------------------
 * CONFIGURATION
 * ------------------------------------------------------------------------ */

/** Client-selected model. Do not swap without telling the client — it is billed. */
const MODEL = "claude-sonnet-5";
/** Hard ceiling on the whole call. The dashboard must never wait longer. */
const REQUEST_TIMEOUT_MS = 20_000;
/** Enough headroom for five insights; nothing is streamed to the browser. */
const MAX_TOKENS = 2_000;
const TOOL_NAME = "submit_briefing";
const MIN_INSIGHTS = 3;
const MAX_INSIGHTS = 5;

/** Overdue receivables above this are always worth the CEO's attention. */
const OVERDUE_ALERT_USD = 25_000;
/** Overdue share of total AR that escalates the finding to critical. */
const OVERDUE_CRITICAL_SHARE = 25;
/** Below this, the business is not covering its cost base comfortably. */
const MARGIN_WARNING_PERCENT = 35;
const MARGIN_CRITICAL_PERCENT = 25;
/** Annualised attrition thresholds for a Philippine BPO. */
const ATTRITION_WARNING_PERCENT = 12;
const ATTRITION_CRITICAL_PERCENT = 20;
/** Share of headcount flagged for overtime risk that escalates to critical. */
const OVERTIME_CRITICAL_SHARE = 10;
const UTILIZATION_TARGET_PERCENT = 85;
const PRODUCTIVITY_FLOOR = 70;
const ABSENCE_WARNING_PERCENT = 8;

const SEVERITIES = ["critical", "warning", "info"] as const;
const CATEGORIES = ["financial", "operational", "sla", "workforce"] as const;

type Severity = AiInsight["severity"];
type Category = AiInsight["category"];

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/* ---------------------------------------------------------------------------
 * PROMPT
 * ------------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are the executive analyst for NorthWinds International, a Philippine healthcare BPO. You brief the CEO directly.

NorthWinds supplies medical support staff (nurses, callers, onboarding and HR teams) to US healthcare clients. It bills clients in USD and pays staff in PHP, so margin is exposed to bill rates, night-shift differentials, statutory employer contributions and the peso rate. Contractual SLA on call answer rate is ${SLA_ANSWER_RATE_TARGET}%.

Your job each time: read the operating figures you are given and return between ${MIN_INSIGHTS} and ${MAX_INSIGHTS} insights. Across the set you must cover, where the data supports it:
  - financial risk (margin, receivables, cash exposure),
  - operational efficiency bottlenecks (utilization, overtime, productivity, attrition),
  - SLA issues on specific client accounts.

Rules that are not negotiable:
  1. Every insight MUST cite the actual figure it is based on, taken verbatim from the payload. "Answer rate is 91.4% against a 95% target" — not "answer rates are slipping".
  2. Do NOT invent, estimate or extrapolate any number, client, person or event that is not present in the payload. If you cannot support a point with a figure you were given, leave it out.
  3. Name the specific client when the finding is about one client.
  4. Rank honestly: "critical" means it costs money or breaches a contract this month. Do not mark everything critical.
  5. Headline: under 70 characters, a statement not a topic. Body: 2–3 sentences — what the number is, why it matters, and the concrete next step.
  6. Write for a CEO who is scanning. No preamble, no hedging, no filler.

Return your answer only by calling the ${TOOL_NAME} tool.`;

const BRIEFING_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Submit the executive briefing. Call exactly once with every insight you have.",
  // `strict` makes the API validate the arguments against this schema, which is
  // what lets the UI treat the result as typed data rather than parsed prose.
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["insights"],
    properties: {
      insights: {
        type: "array",
        // Deliberately no minItems/maxItems: `strict` mode rejects the more
        // exotic array constraints, and a 400 here would mean the briefing
        // silently never uses the model. The 3–5 range is stated in the
        // system prompt and enforced in `parseInsights`.
        description: `Between ${MIN_INSIGHTS} and ${MAX_INSIGHTS} insights, ordered most urgent first.`,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["headline", "body", "severity", "category"],
          properties: {
            headline: {
              type: "string",
              description:
                "Under 70 characters. A statement of the finding, including its key figure.",
            },
            body: {
              type: "string",
              description:
                "2–3 sentences: the figure, why it matters, and the concrete next step. Cite figures verbatim from the payload.",
            },
            severity: {
              type: "string",
              enum: [...SEVERITIES],
              description:
                "critical = costs money or breaches a contract this month; warning = trending wrong; info = worth knowing.",
            },
            category: {
              type: "string",
              enum: [...CATEGORIES],
              description:
                "financial = revenue/margin/cash; operational = utilization/productivity/overtime; sla = client service levels; workforce = attrition/absence/headcount.",
            },
          },
        },
      },
    },
  },
};

/* ---------------------------------------------------------------------------
 * VALIDATION
 * The API validates against the schema; we validate again before returning,
 * so a schema change upstream can never put untyped data on the CEO's screen.
 * ------------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && (SEVERITIES as readonly string[]).includes(value);
}

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

/** Returns the validated insights, or null if the response is unusable. */
function parseInsights(input: unknown): AiInsight[] | null {
  if (!isRecord(input) || !Array.isArray(input.insights)) return null;

  const insights: AiInsight[] = [];
  for (const raw of input.insights) {
    if (!isRecord(raw)) return null;
    if (!isNonEmptyString(raw.headline)) return null;
    if (!isNonEmptyString(raw.body)) return null;
    if (!isSeverity(raw.severity)) return null;
    if (!isCategory(raw.category)) return null;

    insights.push({
      // IDs are minted here, never by the model — they are React keys, not content.
      id: `insight-${insights.length + 1}`,
      headline: raw.headline.trim(),
      body: raw.body.trim(),
      severity: raw.severity,
      category: raw.category,
    });
  }

  // Too few is a failed briefing and falls through to the rule-based path.
  // Too many is not — trimming a generous response is better than discarding it.
  if (insights.length < MIN_INSIGHTS) return null;
  return insights.slice(0, MAX_INSIGHTS);
}

/* ---------------------------------------------------------------------------
 * PUBLIC API
 * ------------------------------------------------------------------------ */

export async function generateInsights(
  payload: AiInsightPayload
): Promise<AiInsightResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // No key configured is a normal, supported state — this is a demo console
  // that has to work on a laptop with no secrets file.
  if (!apiKey) return ruleBasedBriefing(payload);

  try {
    const client = new Anthropic({
      apiKey,
      timeout: REQUEST_TIMEOUT_MS,
      // One retry only: a slow retry storm would blow the 20s budget.
      maxRetries: 1,
    });

    const message = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        // Structured extraction: thinking would add latency for no gain, and
        // a forced tool choice is the whole point of the call.
        thinking: { type: "disabled" },
        output_config: { effort: "medium" },
        tools: [BRIEFING_TOOL],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Today's operating figures for NorthWinds International. These are the only facts available to you — do not add any others.\n\n" +
                  "```json\n" +
                  JSON.stringify(payload, null, 2) +
                  "\n```",
              },
            ],
          },
        ],
      },
      {
        timeout: REQUEST_TIMEOUT_MS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );

    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === TOOL_NAME
    );

    const insights = toolUse ? parseInsights(toolUse.input) : null;
    if (!insights) {
      // Refusal, max_tokens truncation, or a shape we do not recognise.
      console.warn(
        `[ai-insights] Unusable model response (stop_reason=${message.stop_reason}); serving rule-based briefing.`
      );
      return ruleBasedBriefing(payload);
    }

    return {
      insights,
      generated_at: new Date().toISOString(),
      is_fallback: false,
      model: MODEL,
    };
  } catch (error) {
    // Log server-side only. The route never forwards this to the client — an
    // SDK error can carry the request body, headers and account hints.
    console.error(
      "[ai-insights] Claude call failed; serving rule-based briefing.",
      error instanceof Error ? error.message : error
    );
    return ruleBasedBriefing(payload);
  }
}

/* ---------------------------------------------------------------------------
 * RULE-BASED BRIEFING
 * Derived entirely from the payload. Same shape, same usefulness bar — this is
 * what a competent analyst would write down after two minutes with the
 * numbers, and it is very likely what gets demoed.
 * ------------------------------------------------------------------------ */

interface Finding {
  headline: string;
  body: string;
  severity: Severity;
  category: Category;
  /** Tie-breaker inside a severity band. Lower sorts first. */
  weight: number;
}

export function ruleBasedBriefing(payload: AiInsightPayload): AiInsightResponse {
  const { financialSummary: fin, productivityAlerts: ops, callingSLAs: slas } = payload;
  const findings: Finding[] = [];

  /* --- SLA ------------------------------------------------------------- */

  const missing = slas
    .filter((account) => account.answer_rate < account.target)
    .sort((a, b) => a.answer_rate - b.answer_rate);
  const worst = missing[0];

  if (worst) {
    const breached = worst.answer_rate < worst.target - 3;
    const others = missing.length - 1;
    findings.push({
      severity: breached ? "critical" : "warning",
      category: "sla",
      weight: 0,
      headline: breached
        ? `${worst.client} has breached its answer-rate SLA at ${formatPercent(worst.answer_rate)}`
        : `${worst.client} is drifting below the answer-rate SLA at ${formatPercent(worst.answer_rate)}`,
      body:
        `${worst.client} answered ${formatPercent(worst.answer_rate)} of calls against a contractual ${formatPercent(worst.target, 0)} target` +
        (others > 0
          ? `, and ${formatNumber(others)} other ${others === 1 ? "account is" : "accounts are"} also under target. `
          : ". ") +
        `First-call resolution on the account is ${formatPercent(worst.fcr)} and the QA audit score is ${formatPercent(worst.qa_score)}. ` +
        (breached
          ? "This is a contractual miss — get ahead of it with the account before the client raises it, and check shift coverage on the queue."
          : "Review staffing on the queue this week; the gap is still recoverable without a client conversation."),
    });
  }

  const lowQa = slas
    .filter((account) => account.qa_score < QA_SCORE_TARGET)
    .sort((a, b) => a.qa_score - b.qa_score);
  const worstQa = lowQa[0];
  if (worstQa && worstQa.client !== worst?.client) {
    findings.push({
      severity: "warning",
      category: "sla",
      weight: 1,
      headline: `QA audit score on ${worstQa.client} sits at ${formatPercent(worstQa.qa_score)}`,
      body:
        `${worstQa.client} is below the ${formatPercent(QA_SCORE_TARGET, 0)} QA target at ${formatPercent(worstQa.qa_score)}, with first-call resolution at ${formatPercent(worstQa.fcr)}. ` +
        "Answer rate is holding, so this is a quality problem rather than a coverage one — book coaching against the failed audit criteria.",
    });
  }

  /* --- FINANCIAL ------------------------------------------------------- */

  if (fin.total_overdue_usd > 0) {
    const overdueShare =
      fin.total_receivable_usd > 0
        ? (fin.total_overdue_usd / fin.total_receivable_usd) * 100
        : 0;
    const severe =
      overdueShare >= OVERDUE_CRITICAL_SHARE ||
      fin.worst_overdue_days >= 60 ||
      fin.total_overdue_usd >= OVERDUE_ALERT_USD * 2;

    if (severe || fin.total_overdue_usd >= OVERDUE_ALERT_USD) {
      findings.push({
        severity: severe ? "critical" : "warning",
        category: "financial",
        weight: 0,
        headline: `${formatUsd(fin.total_overdue_usd)} of receivables is overdue`,
        body:
          `${formatUsd(fin.total_overdue_usd)} across ${formatNumber(fin.overdue_invoice_count)} ${fin.overdue_invoice_count === 1 ? "invoice" : "invoices"} is past due — ${formatPercent(overdueShare)} of the ${formatUsd(fin.total_receivable_usd)} receivable book, with the oldest at ${formatNumber(fin.worst_overdue_days)} days. ` +
          `Payroll of ${formatUsd(fin.net_payroll_expense_usd)} still clears every cycle regardless. ` +
          (severe
            ? "Escalate the oldest invoices to the client's finance contact this week; this is the single largest cash risk on the board."
            : "Chase the oldest invoices before they age into the next bucket."),
      });
    }
  }

  if (fin.gross_margin_percent < MARGIN_WARNING_PERCENT) {
    const critical = fin.gross_margin_percent < MARGIN_CRITICAL_PERCENT;
    findings.push({
      severity: critical ? "critical" : "warning",
      category: "financial",
      weight: 1,
      headline: `Gross margin is ${formatPercent(fin.gross_margin_percent)}`,
      body:
        `On ${formatUsd(fin.gross_monthly_revenue_usd)} of monthly revenue, gross margin is ${formatPercent(fin.gross_margin_percent)} after ${formatUsd(fin.net_payroll_expense_usd)} of payroll. ` +
        `Revenue moved ${formatNumber(fin.revenue_change_percent, { decimals: 1, showSign: true })}% versus the comparison period. ` +
        (critical
          ? "Margin at this level does not absorb a peso move or a client loss — model a bill-rate increase and a utilization lift in the simulator before the next renewal."
          : "Use the margin simulator to test where a bill-rate or utilization change lands before committing to either."),
    });
  } else if (fin.revenue_change_percent < -5) {
    findings.push({
      severity: "warning",
      category: "financial",
      weight: 2,
      headline: `Revenue is down ${formatPercent(Math.abs(fin.revenue_change_percent))} on the period`,
      body:
        `Monthly revenue of ${formatUsd(fin.gross_monthly_revenue_usd)} is ${formatNumber(fin.revenue_change_percent, { decimals: 1, showSign: true })}% against the comparison period while margin holds at ${formatPercent(fin.gross_margin_percent)}. ` +
        "Check whether this is seat attrition on an account or a billing-timing effect before treating it as a trend.",
    });
  }

  /* --- OPERATIONAL ----------------------------------------------------- */

  if (ops.overtime_risk_count > 0) {
    const shareOfHeadcount =
      ops.headcount > 0 ? (ops.overtime_risk_count / ops.headcount) * 100 : 0;
    findings.push({
      severity: shareOfHeadcount >= OVERTIME_CRITICAL_SHARE ? "critical" : "warning",
      category: "operational",
      weight: 1,
      headline: `${formatNumber(ops.overtime_risk_count)} staff are logging overtime without the output`,
      body:
        `${formatNumber(ops.overtime_risk_count)} of ${formatNumber(ops.headcount)} active staff (${formatPercent(shareOfHeadcount)}) are flagged for overtime risk — high overtime hours with productivity that does not follow. ` +
        `The average productivity score across the floor is ${formatPercent(ops.avg_productivity_score, 0)}. ` +
        "Overtime is paid at a premium, so this is margin leaking through the roster rather than through pricing. Rebalance the affected queues.",
    });
  }

  if (ops.utilization_rate < UTILIZATION_TARGET_PERCENT) {
    findings.push({
      severity: "warning",
      category: "operational",
      weight: 2,
      headline: `Only ${formatPercent(ops.utilization_rate)} of seats are billable`,
      body:
        `Utilization is ${formatPercent(ops.utilization_rate)} against a ${formatPercent(UTILIZATION_TARGET_PERCENT, 0)} working target across ${formatNumber(ops.headcount)} staff. ` +
        "Every non-billable seat carries full salary, statutory contributions and overhead with no revenue against it. Identify which accounts the bench is waiting on.",
    });
  }

  if (ops.avg_productivity_score < PRODUCTIVITY_FLOOR || ops.productivity_change_percent < -5) {
    findings.push({
      severity: ops.avg_productivity_score < PRODUCTIVITY_FLOOR ? "warning" : "info",
      category: "operational",
      weight: 3,
      headline: `Average productivity score is ${formatPercent(ops.avg_productivity_score, 0)}`,
      body:
        `Productivity averages ${formatPercent(ops.avg_productivity_score, 0)} and moved ${formatNumber(ops.productivity_change_percent, { decimals: 1, showSign: true })}% against the comparison period. ` +
        `Absence shrinkage is running at ${formatPercent(ops.absence_shrinkage)}. ` +
        "Look at shift-level detail in the staff heatmap before drawing a conclusion — a floor average hides the accounts that are actually moving.",
    });
  }

  /* --- WORKFORCE ------------------------------------------------------- */

  if (ops.attrition_rate >= ATTRITION_WARNING_PERCENT) {
    const critical = ops.attrition_rate >= ATTRITION_CRITICAL_PERCENT;
    findings.push({
      severity: critical ? "critical" : "warning",
      category: "workforce",
      weight: 1,
      headline: `Annualised attrition is ${formatPercent(ops.attrition_rate)}`,
      body:
        `Attrition is running at ${formatPercent(ops.attrition_rate)} across ${formatNumber(ops.headcount)} staff. ` +
        "Every exit costs a hiring cycle plus roughly six months to regularization before a replacement is fully productive, and it lands on the accounts least able to absorb it. " +
        (critical
          ? "Treat this as the top workforce risk: find out which departments and shifts the exits concentrate in this week."
          : "Watch which shifts the exits cluster on — night coverage is the expensive one to refill."),
    });
  }

  if (ops.absence_shrinkage >= ABSENCE_WARNING_PERCENT) {
    findings.push({
      severity: "warning",
      category: "workforce",
      weight: 2,
      headline: `Absence shrinkage is ${formatPercent(ops.absence_shrinkage)} of scheduled hours`,
      body:
        `${formatPercent(ops.absence_shrinkage)} of scheduled hours are being lost to leave and absence across ${formatNumber(ops.headcount)} staff. ` +
        "That is paid capacity that never reaches a client queue, and it is the usual cause behind both overtime and missed answer rates. Check the unapproved-absence split first.",
    });
  }

  /* --- CONTEXT (only used to reach the minimum of three) ---------------- */

  const filler: Finding[] = [];

  const bestSla = [...slas].sort((a, b) => b.answer_rate - a.answer_rate)[0];
  if (bestSla) {
    filler.push({
      severity: "info",
      category: "sla",
      weight: 8,
      headline: `${bestSla.client} is the strongest account at ${formatPercent(bestSla.answer_rate)} answer rate`,
      body:
        `${bestSla.client} is answering ${formatPercent(bestSla.answer_rate)} of calls with ${formatPercent(bestSla.fcr)} first-call resolution and a ${formatPercent(bestSla.qa_score)} QA score, all against a ${formatPercent(bestSla.target, 0)} target. ` +
        "Worth understanding what that team is doing differently before rolling changes across the other queues.",
    });
  }

  filler.push({
    severity: "info",
    category: "financial",
    weight: 9,
    headline: `${formatUsd(fin.gross_monthly_revenue_usd)} monthly revenue at ${formatPercent(fin.gross_margin_percent)} margin`,
    body:
      `Revenue is ${formatUsd(fin.gross_monthly_revenue_usd)} (${formatNumber(fin.revenue_change_percent, { decimals: 1, showSign: true })}% on the period) against ${formatUsd(fin.net_payroll_expense_usd)} of payroll, leaving a ${formatPercent(fin.gross_margin_percent)} gross margin. ` +
      `${formatUsd(fin.total_receivable_usd)} sits in receivables. No single figure is outside its tolerance right now.`,
  });

  filler.push({
    severity: "info",
    category: "operational",
    weight: 10,
    headline: `${formatNumber(ops.headcount)} active staff at ${formatPercent(ops.utilization_rate)} utilization`,
    body:
      `The floor is ${formatNumber(ops.headcount)} active staff running at ${formatPercent(ops.utilization_rate)} billable utilization with an average productivity score of ${formatPercent(ops.avg_productivity_score, 0)}. ` +
      `Attrition is ${formatPercent(ops.attrition_rate)} and absence shrinkage ${formatPercent(ops.absence_shrinkage)} — both inside normal range for the sector.`,
  });

  const ranked = findings.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.weight - b.weight
  );

  for (const extra of filler) {
    if (ranked.length >= MIN_INSIGHTS) break;
    ranked.push(extra);
  }

  const insights: AiInsight[] = ranked.slice(0, MAX_INSIGHTS).map((finding, index) => ({
    id: `rule-${index + 1}`,
    headline: finding.headline,
    body: finding.body,
    severity: finding.severity,
    category: finding.category,
  }));

  return {
    insights,
    generated_at: new Date().toISOString(),
    is_fallback: true,
    model: "rule-based",
  };
}
