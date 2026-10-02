"use client";

/**
 * CashFlowPanel (PRD §5) — the centrepiece of the CEO console.
 *
 * 180 daily points (90 back, 90 forward) is far too dense to plot raw: real
 * collections land in lumps, so a daily line is 85% zeroes. The default view
 * therefore buckets the series into weeks anchored on `REFERENCE_DATE`, which
 * makes the split between measured and modelled cash fall exactly on a bucket
 * boundary. A daily view is still one click away for anyone chasing a specific
 * pay run.
 *
 * ACTUAL vs PROJECTED
 * Same hue (`--chart-1`) because it is the same quantity, but the forecast is
 * drawn with a dashed stroke over a diagonal hatch fill instead of a solid
 * gradient. Hue carries "what", texture carries "how sure" — so the forecast
 * stays legible in greyscale and for viewers who cannot separate the two by
 * colour at all.
 *
 * Data arrives entirely via props; this component never calls the data layer.
 */

import * as React from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
} from "@/components/dashboard/panel";
// From the leaf constants module — `lib/data/dataset.ts` is server-only and
// importing it here would pull the whole staff/payroll dataset into the client
// bundle.
import { REFERENCE_DATE } from "@/lib/constants";
import { formatDate, formatDateShort, formatUsd } from "@/lib/utils/format";
import type { CashFlowPanelData, CashFlowPoint } from "@/lib/types";

/* ---------------------------------------------------------------------------
 * SHAPE
 * ------------------------------------------------------------------------ */

type Granularity = "weekly" | "daily";

interface ChartRow {
  /** Bucket identity — the ISO date of its first day. */
  key: string;
  /** Compact x-axis label. */
  label: string;
  /** Full range, used as the tooltip heading. */
  rangeLabel: string;
  actual: number | null;
  projected: number | null;
  /** Negative, so pay runs read as money leaving. */
  payroll: number;
  position: number;
  /**
   * True on the single bucket where the forecast is seeded from the last
   * measured value purely so the two areas meet. Suppressed in the tooltip —
   * it is a drawing artefact, not a projection.
   */
  bridge: boolean;
}

const CHART_CONFIG = {
  actual: { label: "Collected", color: "var(--chart-1)" },
  projected: { label: "Projected", color: "var(--chart-1)" },
  payroll: { label: "Payroll outflow", color: "var(--chart-3)" },
  position: { label: "Cash position", color: "var(--chart-2)" },
} satisfies ChartConfig;

const BUCKET_DAYS = 7;

function sumDefined(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0
    ? null
    : present.reduce((acc, value) => acc + value, 0);
}

/**
 * Buckets anchored on today rather than on the calendar week, so bucket 0 is
 * "the seven days ending today" (all measured) and bucket 1 is "the next seven
 * days" (all modelled). No bucket ever mixes the two.
 */
function bucketIndex(index: number, anchor: number): number {
  return index <= anchor
    ? -Math.floor((anchor - index) / BUCKET_DAYS)
    : Math.floor((index - anchor - 1) / BUCKET_DAYS) + 1;
}

function toRows(series: CashFlowPoint[], granularity: Granularity): ChartRow[] {
  if (series.length === 0) return [];

  if (granularity === "daily") {
    return series.map((point) => ({
      key: point.date,
      label: formatDateShort(point.date),
      rangeLabel: formatDate(point.date),
      actual: point.actual_usd,
      projected: point.projected_usd,
      payroll: -point.payroll_outflow_usd,
      position: point.net_position_usd,
      bridge: false,
    }));
  }

  const todayIndex = series.findIndex((point) => point.date === REFERENCE_DATE);
  const fallbackIndex = series.findIndex((point) => point.actual_usd === null);
  const anchor =
    todayIndex >= 0
      ? todayIndex
      : fallbackIndex > 0
        ? fallbackIndex - 1
        : series.length - 1;

  const buckets = new Map<number, CashFlowPoint[]>();
  series.forEach((point, index) => {
    const id = bucketIndex(index, anchor);
    const existing = buckets.get(id);
    if (existing) existing.push(point);
    else buckets.set(id, [point]);
  });

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, points]) => {
      const first = points[0];
      const last = points[points.length - 1];
      return {
        key: first.date,
        label: formatDateShort(first.date),
        rangeLabel: `${formatDate(first.date)} → ${formatDate(last.date)}`,
        actual: sumDefined(points.map((p) => p.actual_usd)),
        projected: sumDefined(points.map((p) => p.projected_usd)),
        payroll: -points.reduce((acc, p) => acc + p.payroll_outflow_usd, 0),
        // A running position is a stock, not a flow: carry the closing value.
        position: last.net_position_usd,
        bridge: false,
      };
    });
}

/** Seeds the forecast area from the last measured point so the curves meet. */
function bridgeForecast(rows: ChartRow[]): ChartRow[] {
  const lastActual = rows.reduce(
    (found, row, index) => (row.actual !== null ? index : found),
    -1
  );
  if (lastActual < 0 || rows[lastActual].projected !== null) return rows;

  return rows.map((row, index) =>
    index === lastActual
      ? { ...row, projected: row.actual, bridge: true }
      : row
  );
}

/* ---------------------------------------------------------------------------
 * LEGEND
 * Recharts' legend cannot express "same colour, different certainty", which is
 * the one thing this chart has to communicate. So it is written by hand.
 * ------------------------------------------------------------------------ */

function Legend({ showPosition }: { showPosition: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      <li className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-[2px] bg-chart-1" aria-hidden />
        Collected
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span
          className="h-2.5 w-4 rounded-[2px] border border-dashed border-chart-1 bg-chart-1/15"
          aria-hidden
        />
        Projected
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2 rounded-[1px] bg-chart-3/70" aria-hidden />
        Payroll outflow
      </li>
      {showPosition && (
        <li className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-chart-2" aria-hidden />
          Cash position
        </li>
      )}
    </ul>
  );
}

/* ------------------------------------------------------------------------- */

export function CashFlowPanel({ data }: { data: CashFlowPanelData }) {
  const [granularity, setGranularity] = React.useState<Granularity>("weekly");
  const [showPosition, setShowPosition] = React.useState(true);

  const rawId = React.useId().replace(/:/g, "");
  const actualFillId = `cf-actual-${rawId}`;
  const projectedFillId = `cf-projected-${rawId}`;

  const rows = React.useMemo(
    () => bridgeForecast(toRows(data.series, granularity)),
    [data.series, granularity]
  );

  const todayKey = React.useMemo(() => {
    const bridged = rows.find((row) => row.bridge);
    if (bridged) return bridged.key;
    const exact = rows.find((row) => row.key === REFERENCE_DATE);
    if (exact) return exact.key;
    return rows.reduce(
      (found, row) => (row.actual !== null ? row.key : found),
      rows[0]?.key ?? REFERENCE_DATE
    );
  }, [rows]);

  /** ~12 labels regardless of granularity. 180 tick labels is not a chart. */
  const tickInterval = Math.max(0, Math.ceil(rows.length / 12) - 1);

  const projectedTotal = rows.reduce(
    (acc, row) => acc + (row.bridge ? 0 : (row.projected ?? 0)),
    0
  );
  const closingPosition = rows[rows.length - 1]?.position ?? 0;

  return (
    <Panel>
      <PanelHeader
        title="Cash Flow & Collections"
        description={`90 days measured, 90 days modelled · anchored ${formatDate(REFERENCE_DATE)}`}
        action={
          <dl className="flex items-start gap-6 text-right">
            <div className="space-y-0.5">
              <dt className="label-eyebrow">Receivable</dt>
              <dd className="metric-md">
                {formatUsd(data.total_receivable_usd)}
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="label-eyebrow">Overdue</dt>
              <dd className="metric-md text-critical">
                {formatUsd(data.total_overdue_usd)}
              </dd>
            </div>
          </dl>
        }
      />

      <PanelBody className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Legend showPosition={showPosition} />

          <div className="flex items-center gap-1.5">
            <Button
              size="xs"
              variant={showPosition ? "secondary" : "ghost"}
              aria-pressed={showPosition}
              onClick={() => setShowPosition((value) => !value)}
            >
              Cash position
            </Button>
            <div
              className="flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5"
              role="group"
              aria-label="Chart granularity"
            >
              {(["weekly", "daily"] as const).map((option) => (
                <Button
                  key={option}
                  size="xs"
                  variant={granularity === option ? "secondary" : "ghost"}
                  aria-pressed={granularity === option}
                  className={cn(granularity !== option && "text-muted-foreground")}
                  onClick={() => setGranularity(option)}
                >
                  {option === "weekly" ? "Weekly" : "Daily"}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Screen readers cannot read an SVG. State the shape of it. */}
        <p className="sr-only">
          Cash flow chart. Total receivable {formatUsd(data.total_receivable_usd)},
          of which {formatUsd(data.total_overdue_usd)} is overdue. Collections are
          measured up to {formatDate(REFERENCE_DATE)} and modelled for the
          following 90 days, over which {formatUsd(projectedTotal)} is forecast to
          land. Payroll leaves twice monthly. The projected closing cash position
          at the end of the window is {formatUsd(closingPosition)}.
        </p>

        <ChartContainer
          config={CHART_CONFIG}
          className="aspect-auto h-[280px] w-full sm:h-[320px]"
        >
          <ComposedChart
            data={rows}
            margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id={actualFillId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--color-actual)"
                  stopOpacity={0.32}
                />
                <stop
                  offset="100%"
                  stopColor="var(--color-actual)"
                  stopOpacity={0.02}
                />
              </linearGradient>
              {/* Hatch = forecast. Texture survives greyscale and colour blindness. */}
              <pattern
                id={projectedFillId}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect
                  width="6"
                  height="6"
                  fill="var(--color-projected)"
                  fillOpacity={0.07}
                />
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="6"
                  stroke="var(--color-projected)"
                  strokeOpacity={0.4}
                  strokeWidth={1.5}
                />
              </pattern>
            </defs>

            {/* Horizontal rules only — vertical gridlines add nothing here. */}
            <CartesianGrid vertical={false} strokeDasharray="3 3" />

            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              minTickGap={12}
              interval={tickInterval}
            />
            <YAxis
              yAxisId="usd"
              width={58}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              tickFormatter={(value: number) =>
                formatUsd(value, { compact: true, decimals: 0 })
              }
            />
            {showPosition && (
              <YAxis
                yAxisId="position"
                orientation="right"
                width={58}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                tickFormatter={(value: number) =>
                  formatUsd(value, { compact: true, decimals: 0 })
                }
              />
            )}

            <ReferenceLine
              yAxisId="usd"
              y={0}
              stroke="var(--border)"
              strokeOpacity={0.9}
            />
            <ReferenceLine
              yAxisId="usd"
              x={todayKey}
              stroke="var(--foreground)"
              strokeOpacity={0.4}
              strokeDasharray="3 3"
              label={{
                value: "Today",
                position: "insideTopRight",
                className: "fill-muted-foreground text-[10px]",
              }}
            />

            <ChartTooltip
              cursor={{ strokeOpacity: 0.4 }}
              content={
                <ChartTooltipContent
                  className="min-w-52"
                  labelFormatter={(_value, payload) => {
                    const row = payload?.[0]?.payload as ChartRow | undefined;
                    return row?.rangeLabel ?? "";
                  }}
                  formatter={(value, name, item) => {
                    const row = item?.payload as ChartRow | undefined;
                    const key = String(name);

                    if (value === null || value === undefined) return null;
                    if (key === "projected" && row?.bridge) return null;

                    const numeric =
                      typeof value === "number" ? value : Number(value);
                    if (!Number.isFinite(numeric)) return null;
                    if (key === "payroll" && numeric === 0) return null;

                    const label =
                      CHART_CONFIG[key as keyof typeof CHART_CONFIG]?.label ??
                      key;

                    return (
                      <div className="flex w-full items-center justify-between gap-4">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span
                            className="size-2 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: item?.color }}
                            aria-hidden
                          />
                          {label}
                        </span>
                        <span className="tabular font-medium text-foreground">
                          {formatUsd(numeric)}
                        </span>
                      </div>
                    );
                  }}
                />
              }
            />

            {/* Outflow first so the collection areas sit above it. */}
            <Bar
              yAxisId="usd"
              dataKey="payroll"
              fill="var(--color-payroll)"
              fillOpacity={0.65}
              radius={[0, 0, 2, 2]}
              maxBarSize={granularity === "weekly" ? 16 : 6}
              isAnimationActive={false}
            />

            <Area
              yAxisId="usd"
              type="monotone"
              dataKey="actual"
              stroke="var(--color-actual)"
              strokeWidth={2}
              fill={`url(#${actualFillId})`}
              connectNulls={false}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
            <Area
              yAxisId="usd"
              type="monotone"
              dataKey="projected"
              stroke="var(--color-projected)"
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeOpacity={0.85}
              fill={`url(#${projectedFillId})`}
              connectNulls={false}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />

            {showPosition && (
              <Line
                yAxisId="position"
                type="monotone"
                dataKey="position"
                stroke="var(--color-position)"
                strokeWidth={1.75}
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ChartContainer>
      </PanelBody>

      <PanelFooter>
        <p className="caption">
          Forecast lands each open invoice at its due date plus that client&rsquo;s
          observed payment lag; overdue invoices are modelled as recovering, not
          written off. Payroll is converted from PHP at the rate shown on the KPI
          row.
        </p>
      </PanelFooter>
    </Panel>
  );
}
