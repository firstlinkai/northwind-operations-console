"use client";

/**
 * InvoiceLedger — the client's own billing history (PRD §6, "downloadable
 * list of invoices").
 *
 * DOWNLOAD: no PDF generator exists in this build, so both the per-row action
 * and "Export all" produce CSV, assembled client-side into a Blob. A real
 * implementation would call QuickBooks Online for the rendered invoice PDF
 * (`GET /v3/company/{realmId}/invoice/{id}?minorversion=…` with an
 * `application/pdf` Accept header) and stream that back through a server route
 * so the QBO token never reaches the browser. The CSV path stays useful either
 * way — clients reconcile in a spreadsheet, not a PDF.
 *
 * TONE: an overdue invoice gets a restrained tint and the ageing in days. The
 * client should feel informed, not scolded — no red banners, no exclamation
 * marks, and the badge already carries the semantic colour.
 */

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, FileText } from "lucide-react";

import {
  EmptyState,
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
} from "@/components/dashboard/panel";
import { InvoiceStatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { InvoiceStatus, InvoiceWithClient } from "@/lib/types";
import { formatDate, formatNumber, formatUsd, pluralize } from "@/lib/utils/format";

type StatusFilter = InvoiceStatus | "all";
type SortKey = "issued_date" | "due_date" | "amount_usd";
type SortDirection = "asc" | "desc";

const STATUS_FILTERS: readonly StatusFilter[] = ["all", "Paid", "Pending", "Overdue"];

const FILTER_LABEL: Record<StatusFilter, string> = {
  all: "All",
  Paid: "Paid",
  Pending: "Pending",
  Overdue: "Overdue",
};

/* ---------------------------------------------------------------------------
 * CSV
 * Dates stay in ISO form and amounts stay unformatted: this file is read by a
 * spreadsheet, not a person, and `$28,500` breaks on import in every locale
 * that uses the comma as a decimal separator.
 * ------------------------------------------------------------------------ */

const CSV_HEADERS = [
  "Invoice",
  "Issued",
  "Due",
  "Amount (USD)",
  "Status",
  "Days overdue",
] as const;

/** UTF-8 byte-order mark, written as an escape so it survives file edits. */
const BOM = "\u{FEFF}";

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(rows: InvoiceWithClient[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.qbo_invoice_id,
        row.issued_date,
        row.due_date,
        row.amount_usd.toFixed(2),
        row.status,
        Math.max(0, row.days_overdue),
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\r\n");
}

function downloadCsv(fileName: string, csv: string): void {
  // U+FEFF byte-order mark so Excel opens the file as UTF-8.
  const blob = new Blob([BOM, csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------------ */

export function InvoiceLedger({ invoices }: { invoices: InvoiceWithClient[] }) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("due_date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const counts = useMemo(() => {
    const base: Record<StatusFilter, number> = {
      all: invoices.length,
      Paid: 0,
      Pending: 0,
      Overdue: 0,
    };
    for (const invoice of invoices) base[invoice.status] += 1;
    return base;
  }, [invoices]);

  const totals = useMemo(() => {
    let outstanding = 0;
    let paid = 0;
    for (const invoice of invoices) {
      if (invoice.status === "Paid") paid += invoice.amount_usd;
      else outstanding += invoice.amount_usd;
    }
    return { outstanding, paid };
  }, [invoices]);

  const rows = useMemo(() => {
    const filtered =
      status === "all"
        ? invoices.slice()
        : invoices.filter((invoice) => invoice.status === status);

    const factor = sortDirection === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      if (sortKey === "amount_usd") return (a.amount_usd - b.amount_usd) * factor;
      const left = a[sortKey];
      const right = b[sortKey];
      if (left === right) return 0;
      return (left < right ? -1 : 1) * factor;
    });
    return filtered;
  }, [invoices, status, sortKey, sortDirection]);

  function toggleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    // A newly chosen column starts on its most useful end: newest date first,
    // largest amount first.
    setSortKey(key);
    setSortDirection("desc");
  }

  function ariaSort(key: SortKey): "ascending" | "descending" | "none" {
    if (key !== sortKey) return "none";
    return sortDirection === "asc" ? "ascending" : "descending";
  }

  return (
    <Panel>
      <PanelHeader
        title="Invoices"
        description={
          invoices.length === 0
            ? "No invoices issued yet"
            : `${formatNumber(invoices.length)} ${pluralize(
                invoices.length,
                "invoice"
              )} · ${formatUsd(totals.outstanding)} outstanding`
        }
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length === 0}
            aria-label={
              status === "all"
                ? "Export all invoices as CSV"
                : `Export ${FILTER_LABEL[status]} invoices as CSV`
            }
            onClick={() =>
              downloadCsv(
                `northwinds-invoices-${status === "all" ? "all" : status.toLowerCase()}.csv`,
                buildCsv(rows)
              )
            }
          >
            <Download className="size-3.5" aria-hidden />
            Export all
          </Button>
        }
      />

      {invoices.length === 0 ? (
        <PanelBody>
          <EmptyState
            title="No invoices to show"
            description="Invoices issued against your account will appear here, with a downloadable copy of each."
            icon={<FileText className="size-6" aria-hidden />}
          />
        </PanelBody>
      ) : (
        <>
          <PanelBody className="border-b border-border/80 px-5 py-3">
            <div
              role="group"
              aria-label="Filter invoices by status"
              className="flex flex-wrap items-center gap-1.5"
            >
              {STATUS_FILTERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={status === option}
                  onClick={() => setStatus(option)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                    status === option
                      ? "border-primary/40 bg-accent text-accent-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  )}
                >
                  {FILTER_LABEL[option]}
                  <span className="tabular opacity-70">{formatNumber(counts[option])}</span>
                </button>
              ))}
            </div>
          </PanelBody>

          {rows.length === 0 ? (
            <PanelBody>
              <EmptyState
                title={`No ${FILTER_LABEL[status].toLowerCase()} invoices`}
                description="Choose another status to see the rest of your billing history."
              />
            </PanelBody>
          ) : (
            <PanelBody flush>
              <Table aria-label="Your invoices" className="text-sm">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-5">Invoice</TableHead>
                    <TableHead aria-sort={ariaSort("issued_date")}>
                      <SortButton
                        label="Issued"
                        active={sortKey === "issued_date"}
                        direction={sortDirection}
                        onClick={() => toggleSort("issued_date")}
                      />
                    </TableHead>
                    <TableHead aria-sort={ariaSort("due_date")}>
                      <SortButton
                        label="Due"
                        active={sortKey === "due_date"}
                        direction={sortDirection}
                        onClick={() => toggleSort("due_date")}
                      />
                    </TableHead>
                    <TableHead className="text-right" aria-sort={ariaSort("amount_usd")}>
                      <SortButton
                        label="Amount"
                        align="end"
                        active={sortKey === "amount_usd"}
                        direction={sortDirection}
                        onClick={() => toggleSort("amount_usd")}
                      />
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="px-5 text-right">
                      <span className="sr-only">Download</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {rows.map((invoice) => {
                    const isOverdue = invoice.status === "Overdue";
                    return (
                      <TableRow
                        key={invoice.id}
                        className={cn(isOverdue && "bg-critical-muted/40")}
                      >
                        <TableCell className="px-5 font-medium">
                          {invoice.qbo_invoice_id}
                        </TableCell>
                        <TableCell className="text-muted-foreground tabular">
                          {formatDate(invoice.issued_date)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "tabular",
                            isOverdue ? "text-critical" : "text-muted-foreground"
                          )}
                        >
                          {formatDate(invoice.due_date)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular">
                          {formatUsd(invoice.amount_usd)}
                        </TableCell>
                        <TableCell>
                          <InvoiceStatusBadge
                            status={invoice.status}
                            daysOverdue={invoice.days_overdue}
                          />
                        </TableCell>
                        <TableCell className="px-5 text-right">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Download invoice ${invoice.qbo_invoice_id}`}
                            onClick={() =>
                              downloadCsv(
                                `${invoice.qbo_invoice_id}.csv`,
                                buildCsv([invoice])
                              )
                            }
                          >
                            <Download className="size-3.5" aria-hidden />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </PanelBody>
          )}

          <PanelFooter>
            <dl className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <dt className="text-muted-foreground">Outstanding</dt>
                <dd className="font-medium tabular">{formatUsd(totals.outstanding)}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt className="text-muted-foreground">Paid to date</dt>
                <dd className="font-medium tabular">{formatUsd(totals.paid)}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt className="text-muted-foreground">Paid</dt>
                <dd className="tabular">{formatNumber(counts.Paid)}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt className="text-muted-foreground">Pending</dt>
                <dd className="tabular">{formatNumber(counts.Pending)}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt className="text-muted-foreground">Overdue</dt>
                <dd className={cn("tabular", counts.Overdue > 0 && "text-critical")}>
                  {formatNumber(counts.Overdue)}
                </dd>
              </div>
            </dl>
          </PanelFooter>
        </>
      )}
    </Panel>
  );
}

function SortButton({
  label,
  active,
  direction,
  align = "start",
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  align?: "start" | "end";
  onClick: () => void;
}) {
  const Icon = direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 font-medium transition-colors",
        "outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        align === "end" && "flex-row-reverse",
        active ? "text-foreground" : "text-muted-foreground"
      )}
    >
      {label}
      <Icon
        className={cn("size-3", active ? "opacity-80" : "opacity-0")}
        aria-hidden
      />
    </button>
  );
}
