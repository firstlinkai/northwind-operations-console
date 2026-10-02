"use client";

/**
 * SlaPanel — contractual service level, as the client sees it (PRD §6).
 *
 * Three required pieces:
 *   1. a 30-day trend of call volume against answer rate, with the 95% target
 *      drawn on the chart;
 *   2. a real radial gauge for first-call resolution against FCR_TARGET;
 *   3. the QA audit score with health context.
 *
 * HONESTY: one tenant sits below target, and this panel is shown to that
 * tenant. A failing state must therefore look designed — an amber or red band
 * with a plain-English sentence and the exact count of days missed — rather
 * than a broken-looking red rectangle. Bars are tinted with the warning token
 * on days the target was missed, so a breach is legible without reading a
 * single number.
 */

import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { StatRow } from "@/components/dashboard/metric";
import { EmptyState, Panel, PanelBody, PanelHeader } from "@/components/dashboard/panel";
import { SlaBadge } from "@/components/dashboard/status-badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import {
  FCR_TARGET,
  QA_SCORE_TARGET,
  SLA_ANSWER_RATE_TARGET,
  type CallingMetrics,
} from "@/lib/types";
import {
  formatDate,
  formatDateShort,
  formatDuration,
  formatNumber,
  formatPercent,
  pluralize,
} from "@/lib/utils/format";

type Tone = "positive" | "warning" | "critical";

function healthTone(value: number, target: number): Tone {
  if (value >= target) return "positive";
  if (value >= target - 3) return "warning";
  return "critical";
}

const TONE_TEXT: Record<Tone, string> = {
  positive: "text-positive",
  warning: "text-warning",
  critical: "text-critical",
};

const TONE_VAR: Record<Tone, string> = {
  positive: "var(--positive)",
  warning: "var(--warning)",
  critical: "var(--critical)",
};

const TONE_NOTICE: Record<Tone, string> = {
  positive: "border-positive/35 bg-positive-muted/45",
  warning: "border-warning/35 bg-warning-muted/45",
  critical: "border-critical/35 bg-critical-muted/45",
};

const trendConfig = {
  total_calls: { label: "Calls handled", color: "var(--chart-1)" },
  answer_rate: { label: "Answer rate", color: "var(--chart-2)" },
} satisfies ChartConfig;

const fcrConfig = {
  value: { label: "First-call resolution" },
} satisfies ChartConfig;

export function SlaPanel({ sla }: { sla: CallingMetrics }) {
  const answerTone = healthTone(sla.answer_rate, SLA_ANSWER_RATE_TARGET);
  const fcrTone = healthTone(sla.fcr_percentage, FCR_TARGET);
  const qaTone = healthTone(sla.qa_audit_score, QA_SCORE_TARGET);

  const trend = sla.trend;
  const daysMissed = trend.filter((day) => !day.sla_met).length;
  const daysMet = trend.length - daysMissed;
  const meetsTarget = sla.answer_rate >= SLA_ANSWER_RATE_TARGET;

  const chartData = trend.map((day) => ({
    date: day.metric_date,
    total_calls: day.total_calls,
    answer_rate: day.answer_rate,
    sla_met: day.sla_met,
  }));

  // Keep the target line inside the plotted band even on a good month, and drop
  // the floor far enough that a bad day is not clipped against the axis.
  const rateFloor = Math.max(
    0,
    Math.min(
      SLA_ANSWER_RATE_TARGET - 5,
      Math.floor(Math.min(...trend.map((day) => day.answer_rate), 100) - 3)
    )
  );

  const fcrValue = Math.max(0, Math.min(100, sla.fcr_percentage));
  const fcrGaugeData = [
    { key: "actual", value: fcrValue, fill: TONE_VAR[fcrTone] },
    { key: "target", value: FCR_TARGET, fill: "var(--neutral)" },
  ];

  const periodLabel =
    trend.length === 0
      ? "no reported days"
      : `${formatDate(trend[0]?.metric_date)} – ${formatDate(
          trend[trend.length - 1]?.metric_date
        )}`;

  return (
    <Panel>
      <PanelHeader
        title="Service level"
        description={`Rolling ${formatNumber(trend.length)}-day window · ${periodLabel}`}
        action={
          <SlaBadge value={sla.answer_rate} target={SLA_ANSWER_RATE_TARGET} />
        }
      />

      <PanelBody className="space-y-5">
        {/* --- Headline state -------------------------------------------- */}
        {trend.length > 0 && (
          <div
            className={cn(
              "flex items-start gap-3 rounded-md border p-3.5",
              TONE_NOTICE[meetsTarget ? "positive" : answerTone]
            )}
          >
            {meetsTarget ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden />
            ) : (
              <AlertCircle
                className={cn("mt-0.5 size-4 shrink-0", TONE_TEXT[answerTone])}
                aria-hidden
              />
            )}
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {meetsTarget
                  ? "Answer rate is meeting the contractual target"
                  : "Answer rate is below the contractual target"}
              </p>
              <p className="caption">
                <span className="tabular">{formatPercent(sla.answer_rate)}</span> answered
                against a <span className="tabular">{formatPercent(SLA_ANSWER_RATE_TARGET, 0)}</span>{" "}
                target. The target was met on{" "}
                <span className="tabular">{formatNumber(daysMet)}</span> of{" "}
                <span className="tabular">{formatNumber(trend.length)}</span>{" "}
                {pluralize(trend.length, "day")}
                {daysMissed > 0
                  ? `; the ${formatNumber(daysMissed)} missed ${pluralize(
                      daysMissed,
                      "day is",
                      "days are"
                    )} reviewed with your account team.`
                  : "."}
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-3">
          {/* --- Trend ---------------------------------------------------- */}
          <section className="space-y-3 lg:col-span-2" aria-label="Call volume and answer rate trend">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="panel-title">Calls handled vs answer rate</h4>
              <ul className="caption flex flex-wrap items-center gap-3">
                <LegendSwatch label="Calls" swatchClass="bg-chart-1" />
                <LegendSwatch label="Below target" swatchClass="bg-warning" />
                <LegendSwatch label="Answer rate" swatchClass="bg-chart-2" />
                <li className="flex items-center gap-1.5">
                  <span
                    className="h-0 w-3 border-t-2 border-dashed border-critical"
                    aria-hidden
                  />
                  {formatPercent(SLA_ANSWER_RATE_TARGET, 0)} target
                </li>
              </ul>
            </div>

            {trend.length === 0 ? (
              <div className="surface-well">
                <EmptyState
                  title="No calling activity reported"
                  description="Daily call volume and answer rate appear here once the telephony feed reports for this account."
                />
              </div>
            ) : (
              <>
                <ChartContainer
                  config={trendConfig}
                  className="aspect-auto h-[280px] w-full"
                >
                  <ComposedChart
                    accessibilityLayer
                    data={chartData}
                    margin={{ top: 12, right: 4, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      minTickGap={24}
                      interval="preserveStartEnd"
                      tickFormatter={(value) => formatDateShort(String(value))}
                    />
                    <YAxis
                      yAxisId="calls"
                      tickLine={false}
                      axisLine={false}
                      width={44}
                      tickMargin={4}
                      tickFormatter={(value) =>
                        formatNumber(Number(value), { compact: true })
                      }
                    />
                    <YAxis
                      yAxisId="rate"
                      orientation="right"
                      domain={[rateFloor, 100]}
                      tickLine={false}
                      axisLine={false}
                      width={46}
                      tickMargin={4}
                      tickFormatter={(value) => formatPercent(Number(value), 0)}
                    />
                    <ChartTooltip
                      cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                      content={
                        <ChartTooltipContent
                          labelFormatter={(value) => formatDate(String(value))}
                          formatter={(value, name) => (
                            <div className="flex w-full items-center justify-between gap-4">
                              <span className="text-muted-foreground">
                                {String(name) === "answer_rate"
                                  ? trendConfig.answer_rate.label
                                  : trendConfig.total_calls.label}
                              </span>
                              <span className="tabular font-medium text-foreground">
                                {String(name) === "answer_rate"
                                  ? formatPercent(Number(value))
                                  : formatNumber(Number(value))}
                              </span>
                            </div>
                          )}
                        />
                      }
                    />
                    <Bar
                      yAxisId="calls"
                      dataKey="total_calls"
                      radius={[2, 2, 0, 0]}
                      maxBarSize={18}
                    >
                      {chartData.map((day) => (
                        <Cell
                          key={day.date}
                          fill={
                            day.sla_met
                              ? "var(--color-total_calls)"
                              : "var(--warning)"
                          }
                        />
                      ))}
                    </Bar>
                    <ReferenceLine
                      yAxisId="rate"
                      y={SLA_ANSWER_RATE_TARGET}
                      stroke="var(--critical)"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                    />
                    <Line
                      yAxisId="rate"
                      type="monotone"
                      dataKey="answer_rate"
                      stroke="var(--color-answer_rate)"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </ComposedChart>
                </ChartContainer>

                {/* Screen readers cannot read an SVG chart. */}
                <p className="sr-only">
                  Daily call volume and answer rate for the last{" "}
                  {formatNumber(trend.length)} {pluralize(trend.length, "day")}.{" "}
                  {formatNumber(sla.total_calls)} calls handled in total, of which{" "}
                  {formatNumber(sla.answered_calls)} were answered, an overall answer rate of{" "}
                  {formatPercent(sla.answer_rate)} against a target of{" "}
                  {formatPercent(SLA_ANSWER_RATE_TARGET, 0)}. The target was met on{" "}
                  {formatNumber(daysMet)} {pluralize(daysMet, "day")} and missed on{" "}
                  {formatNumber(daysMissed)} {pluralize(daysMissed, "day")}.
                </p>
              </>
            )}
          </section>

          {/* --- FCR gauge + QA ------------------------------------------- */}
          <div className="space-y-4">
            <section
              className="surface-well p-4"
              aria-label="First-call resolution against target"
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="panel-title">First-call resolution</h4>
                <SlaBadge value={sla.fcr_percentage} target={FCR_TARGET} />
              </div>

              <div className="relative mx-auto mt-2 aspect-square w-full max-w-[196px]">
                <ChartContainer
                  config={fcrConfig}
                  className="aspect-square h-full w-full"
                >
                  <RadialBarChart
                    data={fcrGaugeData}
                    startAngle={90}
                    endAngle={-270}
                    innerRadius="56%"
                    outerRadius="100%"
                    barSize={13}
                  >
                    <PolarAngleAxis
                      type="number"
                      domain={[0, 100]}
                      angleAxisId={0}
                      tick={false}
                    />
                    <RadialBar
                      background
                      dataKey="value"
                      cornerRadius={6}
                      isAnimationActive={false}
                    />
                  </RadialBarChart>
                </ChartContainer>

                {/*
                  Padded to ~24% a side so the label stays inside the gauge's
                  56% inner radius. Unconstrained, the tracked-out eyebrow ran
                  wider than the hole and printed straight over the arc.
                */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-[24%] text-center">
                  <span className={cn("metric-lg", TONE_TEXT[fcrTone])}>
                    {formatPercent(sla.fcr_percentage)}
                  </span>
                  <span className="label-eyebrow text-[0.5625rem] leading-[1.25] tracking-[0.06em]">
                    resolved
                    <br />
                    first call
                  </span>
                </div>
              </div>

              <p className="caption mt-3 text-center">
                Outer ring is your result; the inner ring marks the{" "}
                <span className="tabular">{formatPercent(FCR_TARGET, 0)}</span> target.
              </p>
              <p className="sr-only">
                First-call resolution is {formatPercent(sla.fcr_percentage)} against a target of{" "}
                {formatPercent(FCR_TARGET, 0)}.
              </p>
            </section>

            <section className="surface-well p-4" aria-label="Quality audit score">
              <div className="flex items-center justify-between gap-2">
                <h4 className="panel-title">QA audit score</h4>
                <SlaBadge value={sla.qa_audit_score} target={QA_SCORE_TARGET} />
              </div>
              <p className={cn("metric-xl mt-2", TONE_TEXT[qaTone])}>
                {formatPercent(sla.qa_audit_score)}
              </p>
              <p className="caption mt-1">
                Audited against a{" "}
                <span className="tabular">{formatPercent(QA_SCORE_TARGET, 0)}</span> compliance
                threshold.
              </p>
            </section>

            <div className="px-1">
              <StatRow
                label="Average handle time"
                value={formatDuration(sla.avg_handle_time_sec)}
              />
              <StatRow label="Calls handled" value={formatNumber(sla.total_calls)} />
              <StatRow
                label="Calls answered"
                value={formatNumber(sla.answered_calls)}
              />
              <StatRow
                label="Answer rate"
                value={
                  <span className={TONE_TEXT[answerTone]}>
                    {formatPercent(sla.answer_rate)}
                  </span>
                }
                emphasis
              />
            </div>
          </div>
        </div>
      </PanelBody>
    </Panel>
  );
}

function LegendSwatch({
  label,
  swatchClass,
}: {
  label: string;
  swatchClass: string;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={cn("size-2 rounded-[2px]", swatchClass)} aria-hidden />
      {label}
    </li>
  );
}
