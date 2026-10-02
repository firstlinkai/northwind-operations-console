/**
 * KpiRow (PRD §5) — the four numbers the CEO reads first.
 *
 * Server component. `getExecutiveKpis()` is awaited by the page and the result
 * arrives here as a prop, so nothing in this file touches the data layer.
 *
 * Every card is the same `Panel` → `PanelBody` → `Metric` stack. That sameness
 * is the point: identical eyebrow, identical figure size, identical delta
 * position, so the eye can compare four unrelated units without re-anchoring.
 */

import { Banknote, Gauge, TrendingUp, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { Metric } from "@/components/dashboard/metric";
import { Panel, PanelBody } from "@/components/dashboard/panel";
import { FxNote } from "@/components/dashboard/provenance";
import {
  formatNumber,
  formatPercent,
  formatPhp,
  formatUsd,
} from "@/lib/utils/format";
import type { ExecutiveKpis, ShiftType } from "@/lib/types";

/* ---------------------------------------------------------------------------
 * SHIFT COVERAGE
 * Night coverage is the operationally interesting number for US-facing
 * healthcare accounts, so the split gets a real (if slim) visual rather than a
 * comma-separated string.
 * ------------------------------------------------------------------------ */

const SHIFTS: ReadonlyArray<{ key: ShiftType; label: string; swatch: string }> = [
  { key: "day", label: "Day", swatch: "bg-chart-3" },
  { key: "mid", label: "Mid", swatch: "bg-chart-1" },
  { key: "night", label: "Night", swatch: "bg-chart-2" },
] as const;

function ShiftCoverage({ coverage }: { coverage: Record<ShiftType, number> }) {
  const counts = SHIFTS.map((shift) => ({
    ...shift,
    count: coverage[shift.key] ?? 0,
  }));
  const total = counts.reduce((acc, item) => acc + item.count, 0);
  const denominator = total > 0 ? total : 1;
  const nightShare = ((coverage.night ?? 0) / denominator) * 100;

  const summary = counts
    .map((item) => `${item.label} shift ${item.count}`)
    .join(", ");

  return (
    <div className="space-y-1.5">
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Shift coverage: ${summary}.`}
      >
        {counts.map((item) =>
          item.count > 0 ? (
            <div
              key={item.key}
              className={item.swatch}
              style={{ width: `${((item.count / denominator) * 100).toFixed(2)}%` }}
            />
          ) : null
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5" aria-hidden>
        {counts.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5">
            <span className={cn("size-1.5 shrink-0 rounded-full", item.swatch)} />
            <span>{item.label}</span>
            <span className="tabular font-medium text-foreground">
              {formatNumber(item.count)}
            </span>
          </span>
        ))}
      </div>

      <p>Night holds {formatPercent(nightShare, 0)} of the floor · US hours</p>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

export function KpiRow({ kpis }: { kpis: ExecutiveKpis }) {
  return (
    <section
      aria-label="Executive key performance indicators"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      <Panel>
        <PanelBody>
          <Metric
            label="Gross Monthly Revenue"
            icon={<TrendingUp className="size-4" aria-hidden />}
            value={formatUsd(kpis.gross_monthly_revenue_usd)}
            delta={kpis.revenue_delta}
            sub="QuickBooks · trailing 30 days"
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelBody>
          <Metric
            label="Net Payroll Expense"
            icon={<Banknote className="size-4" aria-hidden />}
            value={formatPhp(kpis.net_payroll_expense_php)}
            /* `is_favourable` already encodes cost-up-is-bad — pass it through. */
            delta={kpis.payroll_delta}
            sub={
              <div className="space-y-1">
                <p>
                  <span className="tabular">
                    {formatUsd(kpis.net_payroll_expense_usd)}
                  </span>{" "}
                  · JeonSoft net pay
                </p>
                <FxNote fx={kpis.fx_rate} />
              </div>
            }
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelBody>
          <Metric
            label="Avg Operational Productivity"
            icon={<Gauge className="size-4" aria-hidden />}
            value={formatPercent(kpis.avg_productivity_score)}
            delta={kpis.productivity_delta}
            sub={`Controlio · ${formatNumber(kpis.active_headcount)} staff`}
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelBody>
          <Metric
            label="Active Headcount"
            icon={<Users className="size-4" aria-hidden />}
            value={formatNumber(kpis.active_headcount)}
            sub={<ShiftCoverage coverage={kpis.shift_coverage} />}
          />
        </PanelBody>
      </Panel>
    </section>
  );
}
