/**
 * Metric display primitives.
 *
 * The delta arrow deserves a note: direction and desirability are separate
 * inputs. Payroll cost rising is an "up" arrow shown in the critical colour,
 * because up is not always good. `MetricDelta.is_favourable` carries that
 * judgement from the query layer, so no component has to guess.
 */

import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import type { MetricDelta } from "@/lib/types";

export function DeltaBadge({
  delta,
  className,
}: {
  delta: MetricDelta;
  className?: string;
}) {
  const Icon =
    delta.direction === "up"
      ? ArrowUpRight
      : delta.direction === "down"
        ? ArrowDownRight
        : ArrowRight;

  const tone =
    delta.direction === "flat"
      ? "text-muted-foreground"
      : delta.is_favourable
        ? "text-positive"
        : "text-critical";

  // Real minus sign, not a hyphen — hyphens read as dashes at small sizes.
  const magnitude = `${Math.abs(delta.percent).toFixed(1)}%`;
  const sign = delta.direction === "up" ? "+" : delta.direction === "down" ? "−" : "";

  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", tone, className)}>
      <Icon className="size-3.5" aria-hidden />
      <span className="tabular">
        {sign}
        {magnitude}
      </span>
      <span className="font-normal text-muted-foreground">{delta.comparison_label}</span>
    </span>
  );
}

/**
 * The KPI card body. Kept separate from `Panel` so it can be reused inside
 * departmental tabs at a smaller size.
 */
export function Metric({
  label,
  value,
  sub,
  delta,
  size = "xl",
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  delta?: MetricDelta;
  size?: "xl" | "lg" | "md";
  icon?: React.ReactNode;
  className?: string;
}) {
  const valueClass =
    size === "xl" ? "metric-xl" : size === "lg" ? "metric-lg" : "metric-md";

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="label-eyebrow">{label}</span>
        {icon && <span className="text-muted-foreground/70">{icon}</span>}
      </div>
      <div className={valueClass}>{value}</div>
      {(sub || delta) && (
        <div className="space-y-1 pt-0.5">
          {delta && <DeltaBadge delta={delta} />}
          {sub && <div className="caption">{sub}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * Compact label/value row used inside cost breakdowns and summary lists.
 */
export function StatRow({
  label,
  value,
  emphasis = false,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 py-1.5",
        emphasis && "border-t border-border pt-2.5 font-semibold"
      )}
    >
      <span className={cn("text-sm", !emphasis && "text-muted-foreground")}>{label}</span>
      <span className="text-sm tabular">{value}</span>
    </div>
  );
}
