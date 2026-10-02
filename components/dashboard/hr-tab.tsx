"use client";

/**
 * HR departmental tab.
 *
 * ⚠️ PROVENANCE
 * `HrMetrics.is_sample_data` is true for this build — no HRIS feed exists, so
 * attrition, regularization and shrinkage are modelled from the staff roster.
 * The badge sits in the tab's own header, above the first number, because a
 * caveat that appears after the figure has already been read is not a caveat.
 */

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  XAxis,
  YAxis,
} from "recharts";

import { Metric, StatRow } from "@/components/dashboard/metric";
import {
  Panel,
  PanelBody,
  PanelHeader,
} from "@/components/dashboard/panel";
import { SampleDataBadge } from "@/components/dashboard/provenance";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatHours, formatNumber, formatPercent } from "@/lib/utils/format";
import type { HrMetrics, LeaveType } from "@/lib/types";

const LEAVE_LABEL: Record<LeaveType, string> = {
  sick: "Sick",
  vacation: "Vacation",
  emergency: "Emergency",
  unpaid: "Unpaid",
  absent_no_notice: "Absent, no notice",
};

/**
 * `absent_no_notice` is the only leave type that is an operational failure
 * rather than a planned cost, so it gets the critical token while every other
 * type shares one chart hue. Colour is backed up by the "unplanned" caption.
 */
const LEAVE_FILL: Record<LeaveType, string> = {
  sick: "var(--chart-1)",
  vacation: "var(--chart-1)",
  emergency: "var(--chart-3)",
  unpaid: "var(--chart-1)",
  absent_no_notice: "var(--critical)",
};

const attritionChartConfig = {
  rate: { label: "Attrition rate", color: "var(--chart-5)" },
} satisfies ChartConfig;

const leaveChartConfig = {
  hours: { label: "Hours lost", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function HrTab({ data }: { data: HrMetrics }) {
  const leaveRows = data.leave_breakdown.map((row) => ({
    ...row,
    label: LEAVE_LABEL[row.type],
    fill: LEAVE_FILL[row.type],
  }));

  const totalLeaveHours = data.leave_breakdown.reduce(
    (running, row) => running + row.hours,
    0,
  );

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="People & retention"
          description="Attrition, regularization and absence across the active roster."
          action={
            data.is_sample_data ? (
              <SampleDataBadge detail="No HRIS feed is connected. Attrition, days-to-regularization, shrinkage and the leave split are modelled from the staff roster and are for demonstration only — do not report them externally." />
            ) : undefined
          }
        />
        <PanelBody className="grid gap-6 sm:grid-cols-3">
          <Metric
            size="lg"
            label="Attrition rate"
            value={formatPercent(data.attrition_rate)}
            sub="Annualised, trailing 12 months"
          />
          <Metric
            size="lg"
            label="Days to regularization"
            value={formatNumber(data.avg_days_to_regularization)}
            sub="Mean, probationary to regular"
          />
          <Metric
            size="lg"
            label="Absence shrinkage"
            value={formatPercent(data.absence_shrinkage)}
            sub="Lost hours vs scheduled, last 90 days"
          />
        </PanelBody>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-1">
          <PanelHeader title="Headcount" description="Active roster composition" />
          <PanelBody>
            <StatRow
              label="Total active"
              value={<span className="tabular">{formatNumber(data.headcount_total)}</span>}
            />
            <StatRow
              label="Regular"
              value={<span className="tabular">{formatNumber(data.headcount_regular)}</span>}
            />
            <StatRow
              label="Probationary"
              value={
                <span className="tabular">{formatNumber(data.headcount_probationary)}</span>
              }
            />
            <StatRow
              label="Hires, last 90 days"
              value={<span className="tabular">{formatNumber(data.hires_last_90d)}</span>}
            />
            <StatRow
              label="Exits, last 90 days"
              value={<span className="tabular">{formatNumber(data.exits_last_90d)}</span>}
            />
            <StatRow
              emphasis
              label="Net movement, 90 days"
              value={
                <span className="tabular">
                  {formatNumber(data.hires_last_90d - data.exits_last_90d, {
                    showSign: true,
                  })}
                </span>
              }
            />
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Attrition trend"
            description="Annualised monthly attrition, last 12 months"
            action={data.is_sample_data ? <SampleDataBadge /> : undefined}
          />
          <PanelBody>
            <p className="sr-only">
              {`Annualised attrition by month: ${data.attrition_trend
                .map((point) => `${point.month} ${formatPercent(point.rate)}`)
                .join(", ")}.`}
            </p>
            <ChartContainer
              config={attritionChartConfig}
              className="aspect-auto h-[220px] w-full"
            >
              <AreaChart
                data={data.attrition_trend}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                accessibilityLayer
              >
                <defs>
                  <linearGradient id="hr-attrition-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-rate)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--color-rate)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={4}
                />
                <YAxis
                  width={40}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={4}
                  tickFormatter={(value: number) => formatPercent(value, 0)}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => (
                        <span className="tabular">
                          Attrition {formatPercent(Number(value))}
                        </span>
                      )}
                    />
                  }
                />
                <Area
                  dataKey="rate"
                  type="monotone"
                  stroke="var(--color-rate)"
                  strokeWidth={2}
                  fill="url(#hr-attrition-fill)"
                />
              </AreaChart>
            </ChartContainer>
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Leave & absence mix"
          description="Hours lost by reason, last 90 days. Unplanned absence is called out separately."
          action={data.is_sample_data ? <SampleDataBadge /> : undefined}
        />
        <PanelBody className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div>
            <p className="sr-only">
              {`Hours lost by leave type over the last 90 days: ${leaveRows
                .map(
                  (row) =>
                    `${row.label} ${formatHours(row.hours)} (${formatPercent(row.share)})`,
                )
                .join(", ")}.`}
            </p>
            <ChartContainer
              config={leaveChartConfig}
              className="aspect-auto h-[200px] w-full"
            >
              <BarChart
                data={leaveRows}
                layout="vertical"
                margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
                accessibilityLayer
              >
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={4}
                  tickFormatter={(value: number) => formatNumber(value)}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={110}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={4}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => (
                        <span className="tabular">{formatHours(Number(value))} lost</span>
                      )}
                    />
                  }
                />
                <Bar dataKey="hours" radius={3} barSize={16}>
                  {leaveRows.map((row) => (
                    <Cell key={row.type} fill={row.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </div>

          <div>
            <p className="label-eyebrow mb-2">Share of lost hours</p>
            {leaveRows.map((row) => (
              <StatRow
                key={row.type}
                label={
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: row.fill }}
                      aria-hidden
                    />
                    <span
                      className={
                        row.type === "absent_no_notice"
                          ? "font-medium text-critical"
                          : undefined
                      }
                    >
                      {row.label}
                    </span>
                    {row.type === "absent_no_notice" && (
                      <span className="pill pill-critical">Unplanned</span>
                    )}
                  </span>
                }
                value={
                  <span className="tabular">
                    {formatPercent(row.share)}{" "}
                    <span className="text-muted-foreground">
                      · {formatHours(row.hours)}
                    </span>
                  </span>
                }
              />
            ))}
            <StatRow
              emphasis
              label="Total hours lost"
              value={<span className="tabular">{formatHours(totalLeaveHours)}</span>}
            />
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
