/**
 * ArAgingPanel (PRD §5) — where the money is stuck, and who is sitting on it.
 *
 * Two views of one question, stacked so the eye moves from shape to detail:
 *   1. the ageing distribution, as a single severity-ramped bar;
 *   2. the overdue invoices themselves, worst first.
 *
 * Colour here comes from the semantic ramp (`--positive` → `--warning` →
 * `--critical`), never from `--chart-*`: these buckets are a health scale, not
 * a set of unrelated series, and they must read the same as every other status
 * signal in the product.
 *
 * Server component — no interactivity, all data via props.
 */

import { AlertTriangle, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Panel,
  PanelBody,
  PanelHeader,
  EmptyState,
} from "@/components/dashboard/panel";
import { InvoiceStatusBadge, StatusPill } from "@/components/dashboard/status-badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatDate,
  formatNumber,
  formatPercent,
  formatUsd,
  pluralizeWithCount,
} from "@/lib/utils/format";
import type {
  ArAgingBucket,
  ArAgingRow,
  CashFlowPanelData,
  InvoiceWithClient,
} from "@/lib/types";

/* ---------------------------------------------------------------------------
 * AGEING SCALE
 * ------------------------------------------------------------------------ */

const BUCKET_META: Record<
  ArAgingBucket,
  { label: string; bar: string; dot: string; text: string }
> = {
  current: {
    label: "Current",
    bar: "bg-positive",
    dot: "bg-positive",
    text: "text-positive",
  },
  "1-30": {
    label: "1–30 days",
    bar: "bg-warning/55",
    dot: "bg-warning/55",
    text: "text-warning",
  },
  "31-60": {
    label: "31–60 days",
    bar: "bg-warning",
    dot: "bg-warning",
    text: "text-warning",
  },
  "61-90": {
    label: "61–90 days",
    bar: "bg-critical/65",
    dot: "bg-critical/65",
    text: "text-critical",
  },
  "90+": {
    label: "90+ days",
    bar: "bg-critical",
    dot: "bg-critical",
    text: "text-critical",
  },
};

const BUCKET_ORDER: ArAgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

function orderBuckets(aging: ArAgingRow[]): ArAgingRow[] {
  return [...aging].sort(
    (a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket)
  );
}

function AgingDistribution({ aging }: { aging: ArAgingRow[] }) {
  const rows = orderBuckets(aging);
  const total = rows.reduce((acc, row) => acc + row.amount_usd, 0);
  const denominator = total > 0 ? total : 1;

  const summary = rows
    .map(
      (row) =>
        `${BUCKET_META[row.bucket].label}: ${formatUsd(row.amount_usd)} across ${pluralizeWithCount(row.invoice_count, "invoice")}`
    )
    .join("; ");

  return (
    <div className="space-y-3">
      <div
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Receivables ageing distribution. ${summary}.`}
      >
        {rows.map((row) =>
          row.amount_usd > 0 ? (
            <div
              key={row.bucket}
              className={BUCKET_META[row.bucket].bar}
              style={{
                width: `${((row.amount_usd / denominator) * 100).toFixed(2)}%`,
              }}
            />
          ) : null
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map((row) => (
          <div key={row.bucket} className="space-y-0.5">
            <dt className="flex items-center gap-1.5 text-[0.6875rem] font-medium tracking-[0.02em] text-muted-foreground">
              <span
                className={cn("size-1.5 shrink-0 rounded-full", BUCKET_META[row.bucket].dot)}
                aria-hidden
              />
              {BUCKET_META[row.bucket].label}
            </dt>
            <dd className="space-y-0.5">
              <div className="metric-md">{formatUsd(row.amount_usd)}</div>
              <div className="caption tabular">
                {formatNumber(row.invoice_count)} inv ·{" "}
                {formatPercent(row.share_percent, 0)}
              </div>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * WORST OFFENDER
 * The CEO should not have to read a table to find the problem. "Worst" here is
 * the largest overdue balance — the biggest single exposure — rather than the
 * oldest, because a small ancient invoice is a collections chore and a large
 * one is a cash-flow event.
 * ------------------------------------------------------------------------ */

function worstOffender(
  invoices: InvoiceWithClient[]
): InvoiceWithClient | null {
  return invoices.reduce<InvoiceWithClient | null>(
    (worst, invoice) =>
      worst === null || invoice.amount_usd > worst.amount_usd ? invoice : worst,
    null
  );
}

function WorstOffenderCallout({ invoice }: { invoice: InvoiceWithClient }) {
  return (
    <div className="surface-well flex flex-wrap items-center justify-between gap-3 border-critical/35 bg-critical-muted px-3.5 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />
        <div className="min-w-0 space-y-0.5">
          <p className="label-eyebrow text-critical">Largest exposure</p>
          <p className="text-sm font-medium">
            {invoice.client_name}{" "}
            <span className="text-muted-foreground">
              · {invoice.qbo_invoice_id}
            </span>
          </p>
          <p className="caption">
            Due {formatDate(invoice.due_date)} ·{" "}
            <span className="tabular">
              {pluralizeWithCount(invoice.days_overdue, "day")}
            </span>{" "}
            overdue
          </p>
        </div>
      </div>
      <div className="metric-lg text-critical">{formatUsd(invoice.amount_usd)}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * OVERDUE TABLE
 * ------------------------------------------------------------------------ */

function OverdueTable({
  invoices,
  highlightId,
}: {
  invoices: InvoiceWithClient[];
  highlightId: string | null;
}) {
  return (
    <div className="max-h-[22rem] overflow-y-auto">
      <Table aria-label="Overdue invoices, worst first">
        <TableCaption className="sr-only">
          Overdue invoices sorted worst first, showing invoice number, client,
          amount in US dollars, due date, days overdue and status.
        </TableCaption>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead>Invoice</TableHead>
            <TableHead>Client</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Due</TableHead>
            <TableHead className="text-right">Days overdue</TableHead>
            <TableHead className="text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((invoice) => {
            const isWorst = invoice.id === highlightId;
            return (
              <TableRow
                key={invoice.id}
                className={cn(isWorst && "bg-critical-muted/50")}
              >
                <TableCell className="font-mono text-xs">
                  {invoice.qbo_invoice_id}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className="truncate">{invoice.client_name}</span>
                    <span className="pill pill-neutral">{invoice.client_code}</span>
                  </span>
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular font-medium",
                    isWorst && "text-critical"
                  )}
                >
                  {formatUsd(invoice.amount_usd)}
                </TableCell>
                <TableCell className="text-right tabular text-muted-foreground">
                  {formatDate(invoice.due_date)}
                </TableCell>
                <TableCell className="text-right tabular">
                  {formatNumber(invoice.days_overdue)}
                </TableCell>
                <TableCell className="text-right">
                  <InvoiceStatusBadge
                    status={invoice.status}
                    daysOverdue={invoice.days_overdue}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

export function ArAgingPanel({ data }: { data: CashFlowPanelData }) {
  const worst = worstOffender(data.overdue_invoices);
  const overdueCount = data.overdue_invoices.length;

  return (
    <Panel>
      <PanelHeader
        title="Accounts Receivable Ageing"
        description={`${formatUsd(data.total_receivable_usd)} outstanding across all open invoices`}
        action={
          overdueCount > 0 ? (
            <StatusPill tone="critical">
              <span className="tabular">
                {formatUsd(data.total_overdue_usd)}
              </span>
              overdue
            </StatusPill>
          ) : (
            <StatusPill tone="positive">Nothing overdue</StatusPill>
          )
        }
      />

      <PanelBody className="space-y-4 px-5 py-4">
        <AgingDistribution aging={data.aging} />

        {worst && <WorstOffenderCallout invoice={worst} />}
      </PanelBody>

      <div className="border-t border-border/80">
        <div className="flex items-baseline justify-between gap-4 px-5 py-3">
          <h4 className="panel-title">Overdue invoices</h4>
          <span className="caption tabular">
            {pluralizeWithCount(overdueCount, "invoice")}
          </span>
        </div>

        {overdueCount === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="size-6" aria-hidden />}
            title="Every invoice is inside terms"
            description="Nothing is past due. Collections are keeping pace with billing — the receivables book is as clean as it gets."
          />
        ) : (
          <div className="px-5 pb-4">
            <OverdueTable
              invoices={data.overdue_invoices}
              highlightId={worst?.id ?? null}
            />
          </div>
        )}
      </div>
    </Panel>
  );
}
