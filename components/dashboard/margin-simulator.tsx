"use client";

/**
 * ============================================================================
 * MARGIN SIMULATOR (PRD §5) — "what-if" tool for the CEO
 * ============================================================================
 * Four sliders, one number that matters: projected gross margin.
 *
 * WHY THERE IS NO LOADING STATE
 *   `runMarginSimulator()` is pure and synchronous (see lib/data/queries.ts),
 *   so the whole projection runs in the browser on every pointer move. A
 *   round trip per slider tick would make the control feel broken; there is
 *   nothing to await here.
 *
 * THE REFERENCE POINT
 *   The untouched inputs ARE today's real position. The unmodified baseline
 *   result is computed once and passed as the second argument to every
 *   subsequent run so `margin_delta_points` is populated against reality
 *   rather than against the previous slider position.
 *
 * ACCESSIBILITY
 *   Base UI renders the thumb's `<input type="range">` inside the shared
 *   `Slider` wrapper, so per-thumb props are not reachable from here. The
 *   accessible name is instead wired with `aria-labelledby` pointing at BOTH
 *   the visible label and the visible value, which is what Slider.Root
 *   forwards to the input (`resolveAriaLabelledBy`). A screen reader
 *   therefore announces "Headcount, 84 staff", not a bare number. `locale`
 *   is pinned so the default `aria-valuetext` cannot differ between the
 *   server render and the browser.
 *
 * ⚠️ BLOCKED ON A CLIENT-SAFE CALCULATOR — one line to fix, do not duplicate
 *   `runMarginSimulator` is pure and browser-safe, and this component imports
 *   it as specified. But it lives in `lib/data/queries.ts`, which starts with
 *   `import "server-only"` — and a re-export does not launder that, the whole
 *   module still refuses to compile into a client bundle.
 *
 *   The agreed fix is `lib/calc/margin.ts`: a leaf module holding the pure
 *   calculator plus the blended rate/cost constants it reads (it must NOT
 *   import `lib/data/dataset.ts` — that is server-only and carries every
 *   employee's salary), re-exported from queries.ts for the server callers.
 *   When that module lands, the only change here is the import specifier:
 *
 *     import { runMarginSimulator } from "@/lib/calc/margin";
 *
 *   The maths is deliberately NOT duplicated in this file.
 * ========================================================================= */

import { useMemo, useState } from "react";
import { Moon, RotateCcw, Tag, Timer, Users } from "lucide-react";

import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/dashboard/panel";
import { Metric, StatRow } from "@/components/dashboard/metric";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
// Imported from the pure leaf module, NOT from `@/lib/data/queries` — that
// module is `server-only`. This keeps the recompute in the browser, so
// dragging a slider updates the margin instantly with no round trip.
import { runMarginSimulator } from "@/lib/calc/margin";
import type { MarginSimulatorInputs, MarginSimulatorResult } from "@/lib/types";
import { formatNumber, formatPercent, formatUsd } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * SLIDER BOUNDS (PRD §5)
 * ------------------------------------------------------------------------ */

const HEADCOUNT = { min: 20, max: 150, step: 1 } as const;
const NIGHT_RATIO = { min: 0, max: 100, step: 1 } as const;
const BILL_RATE = { min: 0.8, max: 1.4, step: 0.01 } as const;
const UTILIZATION = { min: 50, max: 100, step: 1 } as const;

/** Percentages carry a decimal only when they actually have one. */
function pct(value: number): string {
  return formatPercent(value, Number.isInteger(value) ? 0 : 1);
}

/** `1.08` → `+8%`, `1` → `Today's rate`. */
function multiplierLabel(multiplier: number): string {
  const change = Math.round((multiplier - 1) * 100);
  if (change === 0) return "Today's rate";
  return `${formatNumber(change, { decimals: 0, showSign: true })}%`;
}

/* ---------------------------------------------------------------------------
 * SLIDER ROW
 * ------------------------------------------------------------------------ */

function SimSlider({
  id,
  label,
  valueLabel,
  hint,
  icon,
  value,
  min,
  max,
  step,
  minLabel,
  maxLabel,
  onChange,
}: {
  id: string;
  label: string;
  valueLabel: string;
  hint: string;
  icon: React.ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  minLabel: string;
  maxLabel: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span id={`${id}-label`} className="flex items-center gap-1.5 text-sm font-medium">
          <span className="text-muted-foreground/70" aria-hidden>
            {icon}
          </span>
          {label}
        </span>
        <span id={`${id}-value`} className="text-sm font-semibold tabular">
          {valueLabel}
        </span>
      </div>

      <Slider
        // Both ids: the thumb's input is named "<label>, <current value>".
        aria-labelledby={`${id}-label ${id}-value`}
        locale="en-US"
        // Single-element ARRAY, not a bare number: the shared wrapper derives
        // its thumb count from `Array.isArray(value)` and falls back to
        // `[min, max]` — i.e. two thumbs — for a scalar value.
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => {
          onChange(typeof next === "number" ? next : next[0]);
        }}
      />

      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.6875rem] text-muted-foreground tabular">{minLabel}</span>
        <span className="caption text-right">{hint}</span>
        <span className="text-[0.6875rem] text-muted-foreground tabular">{maxLabel}</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * COST BREAKDOWN
 * ------------------------------------------------------------------------ */

interface CostSegment {
  key: keyof MarginSimulatorResult["cost_breakdown"];
  label: string;
  value: number;
  /** Categorical, not status — chart tokens are correct here. */
  bar: string;
  dot: string;
}

function costSegments(result: MarginSimulatorResult): CostSegment[] {
  const b = result.cost_breakdown;
  return [
    {
      key: "base_salary_usd",
      label: "Base salary",
      value: b.base_salary_usd,
      bar: "bg-chart-1",
      dot: "bg-chart-1",
    },
    {
      key: "night_differential_usd",
      label: "Night differential",
      value: b.night_differential_usd,
      bar: "bg-chart-3",
      dot: "bg-chart-3",
    },
    {
      key: "statutory_contributions_usd",
      label: "Statutory contributions",
      value: b.statutory_contributions_usd,
      bar: "bg-chart-2",
      dot: "bg-chart-2",
    },
    {
      key: "overhead_usd",
      label: "Overhead",
      value: b.overhead_usd,
      bar: "bg-chart-6",
      dot: "bg-chart-6",
    },
  ];
}

/* ---------------------------------------------------------------------------
 * PANEL
 * ------------------------------------------------------------------------ */

export function MarginSimulator({ baseline }: { baseline: MarginSimulatorInputs }) {
  const [inputs, setInputs] = useState<MarginSimulatorInputs>(baseline);

  // Today's real position. Computed once from the untouched inputs and reused
  // as the comparison for every projection below.
  const baselineResult = useMemo(() => runMarginSimulator(baseline), [baseline]);
  const result = useMemo(
    () => runMarginSimulator(inputs, baselineResult),
    [inputs, baselineResult]
  );

  const isModified =
    inputs.headcount !== baseline.headcount ||
    inputs.night_shift_ratio !== baseline.night_shift_ratio ||
    inputs.bill_rate_multiplier !== baseline.bill_rate_multiplier ||
    inputs.utilization_rate !== baseline.utilization_rate;

  const delta = result.margin_delta_points;
  const deltaTone =
    delta > 0 ? "text-positive" : delta < 0 ? "text-critical" : "text-muted-foreground";

  const segments = costSegments(result);
  const costTotal = segments.reduce((sum, segment) => sum + segment.value, 0);
  const share = (value: number) => (costTotal > 0 ? (value / costTotal) * 100 : 0);

  const set = <K extends keyof MarginSimulatorInputs>(key: K, value: MarginSimulatorInputs[K]) => {
    setInputs((current) => ({ ...current, [key]: value }));
  };

  return (
    <Panel>
      <PanelHeader
        title="Margin simulator"
        description={
          isModified
            ? "Modelled scenario — nothing here is saved or applied."
            : "Showing today's actual position. Move a slider to model a change."
        }
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setInputs(baseline)}
            disabled={!isModified}
          >
            <RotateCcw aria-hidden />
            Reset to current
          </Button>
        }
      />

      <PanelBody className="grid gap-6 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ---------------------------------------------------------------- */}
        {/* CONTROLS                                                         */}
        {/* ---------------------------------------------------------------- */}
        <div className="space-y-5">
          <SimSlider
            id="sim-headcount"
            label="Headcount"
            icon={<Users className="size-3.5" />}
            valueLabel={`${formatNumber(inputs.headcount)} staff`}
            hint={`Today: ${formatNumber(baseline.headcount)}`}
            value={inputs.headcount}
            min={HEADCOUNT.min}
            max={HEADCOUNT.max}
            step={HEADCOUNT.step}
            minLabel={formatNumber(HEADCOUNT.min)}
            maxLabel={formatNumber(HEADCOUNT.max)}
            onChange={(next) => set("headcount", next)}
          />

          <SimSlider
            id="sim-night"
            label="Night-shift ratio"
            icon={<Moon className="size-3.5" />}
            valueLabel={pct(inputs.night_shift_ratio)}
            hint={`Today: ${pct(baseline.night_shift_ratio)} · 10% statutory premium`}
            value={inputs.night_shift_ratio}
            min={NIGHT_RATIO.min}
            max={NIGHT_RATIO.max}
            step={NIGHT_RATIO.step}
            minLabel={pct(NIGHT_RATIO.min)}
            maxLabel={pct(NIGHT_RATIO.max)}
            onChange={(next) => set("night_shift_ratio", next)}
          />

          <SimSlider
            id="sim-bill-rate"
            label="Bill rate"
            icon={<Tag className="size-3.5" />}
            valueLabel={multiplierLabel(inputs.bill_rate_multiplier)}
            hint="Change against today's blended rate"
            value={inputs.bill_rate_multiplier}
            min={BILL_RATE.min}
            max={BILL_RATE.max}
            step={BILL_RATE.step}
            minLabel={multiplierLabel(BILL_RATE.min)}
            maxLabel={multiplierLabel(BILL_RATE.max)}
            onChange={(next) => set("bill_rate_multiplier", next)}
          />

          <SimSlider
            id="sim-utilization"
            label="Utilization rate"
            icon={<Timer className="size-3.5" />}
            valueLabel={pct(inputs.utilization_rate)}
            hint={`Today: ${pct(baseline.utilization_rate)} · share of seats billable`}
            value={inputs.utilization_rate}
            min={UTILIZATION.min}
            max={UTILIZATION.max}
            step={UTILIZATION.step}
            minLabel={pct(UTILIZATION.min)}
            maxLabel={pct(UTILIZATION.max)}
            onChange={(next) => set("utilization_rate", next)}
          />
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* READOUT                                                          */}
        {/* ---------------------------------------------------------------- */}
        <div className="space-y-4">
          <div className="surface-well px-4 py-3.5" aria-live="polite">
            <span className="label-eyebrow">
              {isModified ? "Projected gross margin" : "Gross margin today"}
            </span>
            <div className="metric-xl pt-1">{formatPercent(result.gross_margin_percent)}</div>
            <div className="pt-1.5">
              {isModified ? (
                <span className={cn("text-sm font-medium tabular", deltaTone)}>
                  {formatNumber(delta, { decimals: 1, showSign: true })} pts
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    vs {formatPercent(baselineResult.gross_margin_percent)} today
                  </span>
                </span>
              ) : (
                <span className="caption">
                  This is NorthWinds&rsquo;s real position right now — your reference point.
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Metric
              size="md"
              label="Monthly revenue"
              value={formatUsd(result.monthly_revenue_usd)}
              sub={
                isModified
                  ? `${formatUsd(result.monthly_revenue_usd - baselineResult.monthly_revenue_usd, {
                      showSign: true,
                    })} vs today`
                  : undefined
              }
            />
            <Metric
              size="md"
              label="Monthly cost"
              value={formatUsd(result.monthly_cost_usd)}
              sub={
                isModified
                  ? `${formatUsd(result.monthly_cost_usd - baselineResult.monthly_cost_usd, {
                      showSign: true,
                    })} vs today`
                  : undefined
              }
            />
          </div>

          <Metric
            size="lg"
            label="Gross margin"
            value={formatUsd(result.gross_margin_usd)}
            sub={
              isModified
                ? `${formatUsd(result.gross_margin_usd - baselineResult.gross_margin_usd, {
                    showSign: true,
                  })} vs today`
                : "Revenue less fully-loaded cost"
            }
          />

          {/* Cost composition — what is actually driving the number. */}
          <div className="space-y-2">
            <span className="label-eyebrow">What drives the cost</span>
            <div
              className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={segments
                .map((segment) => `${segment.label} ${pct(Math.round(share(segment.value)))}`)
                .join(", ")}
            >
              {segments.map((segment) => (
                <div
                  key={segment.key}
                  className={segment.bar}
                  style={{ width: `${share(segment.value)}%` }}
                />
              ))}
            </div>

            <div>
              {segments.map((segment) => (
                <StatRow
                  key={segment.key}
                  label={
                    <span className="flex items-center gap-2">
                      <span
                        className={cn("size-2 shrink-0 rounded-full", segment.dot)}
                        aria-hidden
                      />
                      {segment.label}
                    </span>
                  }
                  value={
                    <>
                      {formatUsd(segment.value)}
                      <span className="ml-2 text-muted-foreground">
                        {formatPercent(share(segment.value), 0)}
                      </span>
                    </>
                  }
                />
              ))}
              <StatRow label="Total monthly cost" value={formatUsd(costTotal)} emphasis />
            </div>
          </div>
        </div>
      </PanelBody>

      <PanelFooter>
        <p className="caption">
          Modelled at USD/PHP {formatNumber(inputs.usd_php_rate, { decimals: 2 })}. Cost includes
          the 10% statutory night differential and employer contributions; revenue assumes every
          billable seat is filled.
        </p>
      </PanelFooter>
    </Panel>
  );
}
