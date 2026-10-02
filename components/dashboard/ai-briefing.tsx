"use client";

/**
 * ============================================================================
 * AI EXECUTIVE BRIEFING (PRD §7)
 * ============================================================================
 * On-demand only. The CEO presses the button; nothing fires on mount — an
 * automatic call would spend API credit on every page load and every hot
 * reload, and a briefing nobody asked for is noise.
 *
 * The endpoint assembles its own figures server-side, so this component sends
 * no body and holds no secrets. It only renders what comes back.
 *
 * HONESTY
 *   When `is_fallback` is true the briefing was written by rules, not by the
 *   model, and the badge says exactly that. Passing deterministic output off
 *   as model output is how a tool like this loses the room.
 * ========================================================================= */

import { useCallback, useState } from "react";
import { LoaderCircle, RefreshCw, Sparkles, TriangleAlert, WifiOff } from "lucide-react";

import { EmptyState, Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/dashboard/panel";
import { StatusPill } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AiInsight, AiInsightResponse } from "@/lib/types";
import { formatDate, formatTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

const ENDPOINT = "/api/ai-insights";

type Status = "idle" | "loading" | "ready" | "error";
type Tone = "positive" | "warning" | "critical" | "neutral";

const SEVERITY_TONE: Record<AiInsight["severity"], Tone> = {
  critical: "critical",
  warning: "warning",
  info: "neutral",
};

const SEVERITY_ACCENT: Record<AiInsight["severity"], string> = {
  critical: "border-l-critical",
  warning: "border-l-warning",
  info: "border-l-neutral",
};

const SEVERITY_LABEL: Record<AiInsight["severity"], string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

const CATEGORY_LABEL: Record<AiInsight["category"], string> = {
  financial: "Financial",
  operational: "Operations",
  sla: "Client SLA",
  workforce: "Workforce",
};

/* ---------------------------------------------------------------------------
 * RESPONSE HANDLING
 * ------------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural check only — the route is the authority on the contents. */
function isBriefing(value: unknown): value is AiInsightResponse {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.insights)) return false;
  if (typeof value.generated_at !== "string") return false;
  if (typeof value.is_fallback !== "boolean") return false;
  if (typeof value.model !== "string") return false;

  return value.insights.every(
    (insight) =>
      isRecord(insight) &&
      typeof insight.id === "string" &&
      typeof insight.headline === "string" &&
      typeof insight.body === "string" &&
      typeof insight.severity === "string" &&
      typeof insight.category === "string"
  );
}

/** Plain language only — the CEO does not need a status code. */
function messageForStatus(status: number, retryAfter: string | null): string {
  if (status === 401) {
    return "Your session has expired. Sign in again to generate a briefing.";
  }
  if (status === 403) {
    return "This briefing is only available on the executive account.";
  }
  if (status === 429) {
    const seconds = Number(retryAfter);
    const wait =
      Number.isFinite(seconds) && seconds > 0
        ? `Try again in about ${Math.max(1, Math.ceil(seconds / 60))} ${Math.ceil(seconds / 60) === 1 ? "minute" : "minutes"}.`
        : "Try again shortly.";
    return `You have generated several briefings in a short window. ${wait}`;
  }
  return "The briefing could not be generated right now. Please try again.";
}

/* ---------------------------------------------------------------------------
 * PIECES
 * ------------------------------------------------------------------------ */

function InsightCard({ insight }: { insight: AiInsight }) {
  return (
    <article
      className={cn(
        "surface-well border-l-2 px-4 py-3",
        SEVERITY_ACCENT[insight.severity]
      )}
    >
      <div className="flex flex-wrap items-center gap-2 pb-1.5">
        <StatusPill tone={SEVERITY_TONE[insight.severity]}>
          {SEVERITY_LABEL[insight.severity]}
        </StatusPill>
        <span className="label-eyebrow">{CATEGORY_LABEL[insight.category]}</span>
      </div>
      <h4 className="text-sm leading-snug font-semibold">{insight.headline}</h4>
      <p className="pt-1 text-sm leading-relaxed text-muted-foreground">{insight.body}</p>
    </article>
  );
}

function LoadingSkeletons() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className="surface-well space-y-2 border-l-2 border-l-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * PANEL
 * ------------------------------------------------------------------------ */

export function AiBriefing() {
  const [status, setStatus] = useState<Status>("idle");
  const [briefing, setBriefing] = useState<AiInsightResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setStatus("loading");
    setError(null);

    try {
      // No body: the server builds the figures itself. See the route header.
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        setError(messageForStatus(response.status, response.headers.get("Retry-After")));
        setStatus("error");
        return;
      }

      const data: unknown = await response.json();
      if (!isBriefing(data)) {
        setError("The briefing came back in an unexpected format. Please try again.");
        setStatus("error");
        return;
      }

      setBriefing(data);
      setStatus("ready");
    } catch {
      // Offline, DNS, aborted — never surface the raw failure.
      setError("Could not reach the server. Check your connection and try again.");
      setStatus("error");
    }
  }, []);

  const isLoading = status === "loading";
  const hasBriefing = status === "ready" && briefing !== null;

  return (
    <Panel>
      <PanelHeader
        title="AI executive briefing"
        description="Claude reads today's live figures and flags what needs a decision."
        action={
          <Button size="sm" onClick={generate} disabled={isLoading}>
            {isLoading ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : hasBriefing ? (
              <RefreshCw aria-hidden />
            ) : (
              <Sparkles aria-hidden />
            )}
            {isLoading ? "Analysing…" : hasBriefing ? "Regenerate" : "Generate briefing"}
          </Button>
        }
      />

      <PanelBody>
        <div aria-live="polite" aria-busy={isLoading}>
          {status === "idle" && (
            <EmptyState
              icon={<Sparkles className="size-5" aria-hidden />}
              title="No briefing generated yet"
              description="Press Generate briefing and Claude will review this month's revenue, receivables, utilization, attrition and per-client SLA performance, then return three to five findings ranked by urgency. Nothing is sent until you ask."
            />
          )}

          {isLoading && <LoadingSkeletons />}

          {status === "error" && (
            <div className="surface-well flex items-start gap-3 border-l-2 border-l-critical px-4 py-3">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />
              <div className="space-y-2">
                <p className="text-sm font-medium">Briefing unavailable</p>
                <p className="caption">{error}</p>
                <Button size="xs" variant="outline" onClick={generate}>
                  Try again
                </Button>
              </div>
            </div>
          )}

          {hasBriefing && (
            <div className="space-y-3">
              {briefing.is_fallback && (
                <div className="flex items-start gap-2 rounded-md bg-warning-muted px-3 py-2">
                  <WifiOff className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                  <p className="text-xs leading-snug text-warning">
                    <span className="font-medium">
                      Offline analysis — generated from live figures without the model.
                    </span>{" "}
                    Claude could not be reached, so these findings were derived by rule from
                    the same numbers. Every figure below is real.
                  </p>
                </div>
              )}

              {briefing.insights.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}
            </div>
          )}
        </div>
      </PanelBody>

      {hasBriefing && (
        <PanelFooter>
          <p className="caption">
            Generated {formatDate(briefing.generated_at)} at{" "}
            <span className="tabular">{formatTime(briefing.generated_at)}</span> UTC ·{" "}
            {briefing.is_fallback
              ? "rule-based analysis (no model call)"
              : `model ${briefing.model}`}
          </p>
        </PanelFooter>
      )}
    </Panel>
  );
}
