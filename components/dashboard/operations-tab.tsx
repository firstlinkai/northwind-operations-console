"use client";

/**
 * Operations departmental tab — billable seat utilization vs non-billable
 * overhead, and the per-account question the CEO actually asks: are we making
 * money on this client?
 *
 * The revenue/cost pair is drawn as adjacent bars per account rather than a
 * margin number alone, because a 34% margin on $18k and a 34% margin on $2k are
 * not the same conversation. The margin column then colours the verdict.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

import { Metric, StatRow } from "@/components/dashboard/metric";
import { EmptyState, Panel, PanelBody, PanelHeader } from "@/components/dashboard/panel";
import { StatusPill } from "@/components/dashboard/status-badge";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatNumber, formatPercent, formatUsd } from "@/lib/utils/format";
import type { OperationsMetrics } from "@/lib/types";

/** Margin health bands. Under 30% is a concern; over 40% is healthy. */
const MARGIN_HEALTHY = 40;
const MARGIN_CONCERN = 30;

type MarginTone = "positive" | "neutral" | "warning" | "critical";

function marginTone(margin: number): { tone: MarginTone; label: string } {
  if (margin < 0) return { tone: "critical", label: "Loss-making" };
  if (margin < MARGIN_CONCERN) return { tone: "warning", label: "Concern" };
  if (margin < MARGIN_HEALTHY) return { tone: "neutral", label: "Acceptable" };
  return { tone: "positive", label: "Healthy" };
}

const MARGIN_TEXT: Record<MarginTone, string> = {
  positive: "text-positive",
  neutral: "text-foreground",
  warning: "text-warning",
  critical: "text-critical",
};

const chartConfig = {
  revenue_usd: { label: "Revenue", color: "var(--chart-1)" },
  cost_usd: { label: "Fully-loaded cost", color: "var(--chart-3)" },
} satisfies ChartConfig;

export function OperationsTab({ data }: { data: OperationsMetrics }) {
  const totalSeats = data.billable_seats + data.non_billable_seats;
  const grossMargin = data.billable_revenue_usd - data.overhead_cost_usd;
  const rows = data.utilization_by_client;

  const totals = rows.reduce(
    (running, row) => ({
      seats: running.seats + row.billable_seats,
      revenue: running.revenue + row.revenue_usd,
      cost: running.cost + row.cost_usd,
    }),
    { seats: 0, revenue: 0, cost: 0 },
  );
  const blendedMargin =
    totals.revenue > 0 ? ((totals.revenue - totals.cost) / totals.revenue) * 100 : 0;

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Seat utilization"
          description="Billable capacity against non-billable overhead, this month."
        />
        <PanelBody className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            size="lg"
            label="Utilization rate"
            value={formatPercent(data.utilization_rate)}
            sub={`${formatNumber(data.billable_seats)} of ${formatNumber(totalSeats)} seats billable`}
          />
          <Metric
            size="lg"
            label="Billable / non-billable"
            value={
              <span>
                {formatNumber(data.billable_seats)}
                <span className="text-muted-foreground"> / </span>
                {formatNumber(data.non_billable_seats)}
              </span>
            }
            sub="Seats carried on client accounts vs internal overhead"
          />
          <Metric
            size="lg"
            label="Billable revenue"
            value={formatUsd(data.billable_revenue_usd)}
            sub="Monthly recurring, all accounts"
          />
          <Metric
            size="lg"
            label="Overhead cost"
            value={formatUsd(data.overhead_cost_usd)}
            sub="Fully-loaded monthly cost of non-billable seats"
          />
        </PanelBody>

        <PanelBody className="border-t border-border/80">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="label-eyebrow">Seat mix</span>
              <span className="tabular text-muted-foreground">
                {formatPercent(data.utilization_rate)} billable
              </span>
            </div>
            <div
              className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`${formatNumber(data.billable_seats)} billable seats and ${formatNumber(
                data.non_billable_seats,
              )} non-billable seats, ${formatPercent(data.utilization_rate)} utilization.`}
            >
              <div
                className="h-full bg-positive"
                style={{
                  inlineSize: `${Math.min(100, Math.max(0, data.utilization_rate))}%`,
                }}
              />
              <div className="h-full flex-1 bg-neutral/50" />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="presence-dot bg-positive" aria-hidden />
                Billable{" "}
                <span className="tabular text-foreground">
                  {formatNumber(data.billable_seats)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="presence-dot bg-neutral" aria-hidden />
                Non-billable{" "}
                <span className="tabular text-foreground">
                  {formatNumber(data.non_billable_seats)}
                </span>
              </span>
              <span className="ml-auto">
                Revenue less overhead:{" "}
                <span
                  className={cn(
                    "tabular font-semibold",
                    grossMargin >= 0 ? "text-positive" : "text-critical",
                  )}
                >
                  {formatUsd(grossMargin, { showSign: true })}
                </span>
              </span>
            </div>
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title="Revenue vs cost by account"
          description="Monthly billable revenue against fully-loaded cost, including pro-rata overhead."
        />
        <PanelBody>
          {rows.length === 0 ? (
            <EmptyState title="No client accounts to report" />
          ) : (
            <>
              <p className="sr-only">
                {`Revenue against fully-loaded cost by account: ${rows
                  .map(
                    (row) =>
                      `${row.client_code}, revenue ${formatUsd(row.revenue_usd)}, cost ${formatUsd(
                        row.cost_usd,
                      )}, margin ${formatPercent(row.margin_percent)}`,
                  )
                  .join("; ")}.`}
              </p>
              <ChartContainer
                config={chartConfig}
                className="aspect-auto h-[240px] w-full"
              >
                <BarChart
                  data={rows}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                  accessibilityLayer
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="client_code"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <YAxis
                    width={56}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={4}
                    tickFormatter={(value: number) => formatUsd(value, { compact: true })}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, name) => (
                          <span className="flex w-full justify-between gap-3">
                            <span className="text-muted-foreground">
                              {name === "cost_usd" ? "Cost" : "Revenue"}
                            </span>
                            <span className="tabular font-medium">
                              {formatUsd(Number(value))}
                            </span>
                          </span>
                        )}
                      />
                    }
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="revenue_usd" fill="var(--color-revenue_usd)" radius={3} />
                  <Bar dataKey="cost_usd" fill="var(--color-cost_usd)" radius={3} />
                </BarChart>
              </ChartContainer>
            </>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title="Account economics"
          description="Margin under 30% is a concern; over 40% is healthy."
        />
        <PanelBody flush>
          <Table aria-label="Billable seat utilization, revenue, cost and margin by client account">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Client</TableHead>
                <TableHead className="text-right">Billable seats</TableHead>
                <TableHead className="text-right">Revenue / mo</TableHead>
                <TableHead className="text-right">Cost / mo</TableHead>
                <TableHead className="text-right">Gross margin</TableHead>
                <TableHead className="pr-5 text-right">Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const health = marginTone(row.margin_percent);
                return (
                  <TableRow key={row.client_id}>
                    <TableCell className="pl-5 font-medium">{row.client_code}</TableCell>
                    <TableCell className="tabular text-right">
                      {formatNumber(row.billable_seats)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatUsd(row.revenue_usd)}
                    </TableCell>
                    <TableCell className="tabular text-right text-muted-foreground">
                      {formatUsd(row.cost_usd)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatUsd(row.revenue_usd - row.cost_usd)}
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <span className="inline-flex items-center justify-end gap-2">
                        <span
                          className={cn(
                            "tabular font-semibold",
                            MARGIN_TEXT[health.tone],
                          )}
                        >
                          {formatPercent(row.margin_percent)}
                        </span>
                        <StatusPill tone={health.tone}>{health.label}</StatusPill>
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="pl-5">All accounts</TableCell>
                <TableCell className="tabular text-right">
                  {formatNumber(totals.seats)}
                </TableCell>
                <TableCell className="tabular text-right">
                  {formatUsd(totals.revenue)}
                </TableCell>
                <TableCell className="tabular text-right">
                  {formatUsd(totals.cost)}
                </TableCell>
                <TableCell className="tabular text-right">
                  {formatUsd(totals.revenue - totals.cost)}
                </TableCell>
                <TableCell
                  className={cn(
                    "tabular pr-5 text-right",
                    MARGIN_TEXT[marginTone(blendedMargin).tone],
                  )}
                >
                  {formatPercent(blendedMargin)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Overhead check" description="What the non-billable base costs against what the floor earns." />
        <PanelBody className="max-w-xl">
          <StatRow
            label="Billable revenue"
            value={<span className="tabular">{formatUsd(data.billable_revenue_usd)}</span>}
          />
          <StatRow
            label="Non-billable overhead"
            value={
              <span className="tabular text-muted-foreground">
                {formatUsd(data.overhead_cost_usd)}
              </span>
            }
          />
          <StatRow
            label="Overhead as share of revenue"
            value={
              <span className="tabular">
                {formatPercent(
                  data.billable_revenue_usd > 0
                    ? (data.overhead_cost_usd / data.billable_revenue_usd) * 100
                    : 0,
                )}
              </span>
            }
          />
          <StatRow
            emphasis
            label="Revenue less overhead"
            value={
              <span
                className={cn(
                  "tabular",
                  grossMargin >= 0 ? "text-positive" : "text-critical",
                )}
              >
                {formatUsd(grossMargin)}
              </span>
            }
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
