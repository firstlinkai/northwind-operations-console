"use client";

/**
 * Onboarding & Calling tab — contact-centre SLA health.
 *
 * The 95% answer-rate target is contractual, so it is drawn as a reference line
 * rather than left to the reader to infer from the axis. Accounts below target
 * are given a tinted row and an explicit "below target" marker: the whole point
 * of this panel is that a failing account cannot be scrolled past.
 */

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { Metric } from "@/components/dashboard/metric";
import { EmptyState, Panel, PanelBody, PanelHeader } from "@/components/dashboard/panel";
import { SlaBadge, StatusPill } from "@/components/dashboard/status-badge";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  formatDateShort,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/lib/utils/format";
import {
  FCR_TARGET,
  QA_SCORE_TARGET,
  SLA_ANSWER_RATE_TARGET,
  type CallingMetrics,
} from "@/lib/types";

const chartConfig = {
  total_calls: { label: "Total calls", color: "var(--chart-6)" },
  answer_rate: { label: "Answer rate", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function CallingTab({ data }: { data: CallingMetrics }) {
  const trend = data.trend;

  // Anchor the rate axis just below the worst day so the 95% line has room to
  // read as a threshold rather than sitting flush against the top edge.
  const rates = trend.map((point) => point.answer_rate);
  const lowestRate = rates.length > 0 ? Math.min(...rates) : SLA_ANSWER_RATE_TARGET;
  const rateFloor = Math.max(0, Math.floor(Math.min(lowestRate, SLA_ANSWER_RATE_TARGET) - 4));

  const breaches = trend.filter((point) => !point.sla_met).length;
  const failingClients = data.by_client.filter(
    (client) => client.answer_rate < SLA_ANSWER_RATE_TARGET,
  );

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Contact centre performance"
          description={`Rolling 30 days, all accounts. Contractual answer-rate target is ${formatPercent(
            SLA_ANSWER_RATE_TARGET,
            0,
          )}.`}
          action={
            breaches > 0 ? (
              <StatusPill tone="warning">
                {breaches} {breaches === 1 ? "day" : "days"} below target
              </StatusPill>
            ) : (
              <StatusPill tone="positive">Target met every day</StatusPill>
            )
          }
        />
        <PanelBody className="grid gap-6 sm:grid-cols-3 xl:grid-cols-5">
          <Metric
            size="lg"
            label="Total calls"
            value={formatNumber(data.total_calls)}
            sub={`${formatNumber(data.answered_calls)} answered`}
          />
          <Metric
            size="lg"
            label="Answer rate"
            value={
              <span
                className={
                  data.answer_rate >= SLA_ANSWER_RATE_TARGET
                    ? "text-positive"
                    : "text-critical"
                }
              >
                {formatPercent(data.answer_rate)}
              </span>
            }
            sub={`Target ${formatPercent(SLA_ANSWER_RATE_TARGET, 0)}`}
          />
          <Metric
            size="lg"
            label="Avg handle time"
            value={formatDuration(data.avg_handle_time_sec)}
            sub="Talk plus after-call work"
          />
          <Metric
            size="lg"
            label="First contact resolution"
            value={formatPercent(data.fcr_percentage)}
            sub={`Target ${formatPercent(FCR_TARGET, 0)}`}
          />
          <Metric
            size="lg"
            label="QA audit score"
            value={formatNumber(data.qa_audit_score, { decimals: 1 })}
            sub={`Target ${formatNumber(QA_SCORE_TARGET)}`}
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title="Call volume and answer rate"
          description="Daily volume against the 95% contractual answer-rate target, last 30 days."
        />
        <PanelBody>
          {trend.length === 0 ? (
            <EmptyState title="No call data for this period" />
          ) : (
            <>
              <p className="sr-only">
                {`Over ${trend.length} days, total calls ranged from ${formatNumber(
                  Math.min(...trend.map((point) => point.total_calls)),
                )} to ${formatNumber(
                  Math.max(...trend.map((point) => point.total_calls)),
                )} per day. Answer rate ranged from ${formatPercent(
                  lowestRate,
                )} to ${formatPercent(Math.max(...rates))}, against a ${formatPercent(
                  SLA_ANSWER_RATE_TARGET,
                  0,
                )} target, missed on ${breaches} of ${trend.length} days.`}
              </p>
              <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
                <ComposedChart
                  data={trend}
                  margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
                  accessibilityLayer
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="metric_date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={24}
                    tickFormatter={(value: string) => formatDateShort(value)}
                  />
                  <YAxis
                    yAxisId="calls"
                    width={48}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={4}
                    tickFormatter={(value: number) => formatNumber(value, { compact: true })}
                  />
                  <YAxis
                    yAxisId="rate"
                    orientation="right"
                    width={48}
                    domain={[rateFloor, 100]}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={4}
                    tickFormatter={(value: number) => formatPercent(value, 0)}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_label, payload) =>
                          formatDateShort(
                            String(payload?.[0]?.payload?.metric_date ?? ""),
                          )
                        }
                        formatter={(value, name) => (
                          <span className="flex w-full justify-between gap-3">
                            <span className="text-muted-foreground">
                              {name === "answer_rate" ? "Answer rate" : "Total calls"}
                            </span>
                            <span className="tabular font-medium">
                              {name === "answer_rate"
                                ? formatPercent(Number(value))
                                : formatNumber(Number(value))}
                            </span>
                          </span>
                        )}
                      />
                    }
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar
                    yAxisId="calls"
                    dataKey="total_calls"
                    fill="var(--color-total_calls)"
                    fillOpacity={0.55}
                    radius={2}
                  />
                  <ReferenceLine
                    yAxisId="rate"
                    y={SLA_ANSWER_RATE_TARGET}
                    stroke="var(--critical)"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    label={{
                      value: `SLA ${SLA_ANSWER_RATE_TARGET}%`,
                      position: "insideTopRight",
                      fill: "var(--critical)",
                      fontSize: 10,
                    }}
                  />
                  <Line
                    yAxisId="rate"
                    dataKey="answer_rate"
                    type="monotone"
                    stroke="var(--color-answer_rate)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                </ComposedChart>
              </ChartContainer>
            </>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title="SLA by account"
          description={
            failingClients.length > 0
              ? `${failingClients
                  .map((client) => client.client_name)
                  .join(", ")} ${failingClients.length === 1 ? "is" : "are"} below the contractual answer-rate target.`
              : "Every account is clearing the contractual answer-rate target."
          }
        />
        <PanelBody flush>
          {data.by_client.length === 0 ? (
            <EmptyState title="No accounts reporting call metrics" />
          ) : (
            <Table aria-label="Answer rate, first contact resolution and QA audit score by client account">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Account</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Answer rate</TableHead>
                  <TableHead className="text-right">FCR</TableHead>
                  <TableHead className="text-right">QA score</TableHead>
                  <TableHead className="pr-5 text-right">SLA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.by_client.map((client) => {
                  const below = client.answer_rate < SLA_ANSWER_RATE_TARGET;
                  return (
                    <TableRow
                      key={client.client_id}
                      className={cn(below && "bg-critical/10 hover:bg-critical/15")}
                    >
                      <TableCell className="pl-5">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className={cn(
                              "h-4 w-0.5 shrink-0 rounded-full",
                              below ? "bg-critical" : "bg-transparent",
                            )}
                            aria-hidden
                          />
                          <span className="truncate font-medium">{client.client_name}</span>
                          <span className="shrink-0 text-[0.6875rem] tracking-[0.06em] text-muted-foreground uppercase">
                            {client.client_code}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {formatNumber(client.total_calls)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "tabular text-right font-semibold",
                          below ? "text-critical" : "text-foreground",
                        )}
                      >
                        {formatPercent(client.answer_rate)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "tabular text-right",
                          client.fcr_percentage < FCR_TARGET
                            ? "text-warning"
                            : "text-foreground",
                        )}
                      >
                        {formatPercent(client.fcr_percentage)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "tabular text-right",
                          client.qa_audit_score < QA_SCORE_TARGET
                            ? "text-warning"
                            : "text-foreground",
                        )}
                      >
                        {formatNumber(client.qa_audit_score, { decimals: 1 })}
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <SlaBadge
                          value={client.answer_rate}
                          target={SLA_ANSWER_RATE_TARGET}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
