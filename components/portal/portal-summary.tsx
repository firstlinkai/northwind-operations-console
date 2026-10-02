/**
 * PortalSummary — the reassurance strip at the top of the client portal.
 *
 * Register note: this is the LIGHT side of the product. Where the CEO console
 * packs numbers, this deliberately shows four and gives them room. The client
 * is answering two questions — "is my team performing?" and "what do I owe?" —
 * so the 30-day answer rate is the visual anchor and everything else supports
 * it.
 *
 * Tenancy: every figure here comes from `ClientPortalData`, which the query
 * layer has already scoped to one client. Nothing on this panel may reference
 * another tenant, and no compensation figure exists on any type it touches.
 */

import { CalendarClock, PhoneCall, Users, Wallet } from "lucide-react";

import { Metric } from "@/components/dashboard/metric";
import { Panel, PanelBody, PanelHeader } from "@/components/dashboard/panel";
import { PresenceDot, SlaBadge } from "@/components/dashboard/status-badge";
import { cn } from "@/lib/utils";
import type { ClientPortalData } from "@/lib/types";
import {
  formatDate,
  formatNumber,
  formatPercent,
  formatUsd,
  pluralize,
} from "@/lib/utils/format";

/**
 * SLA health bands, matched to `SlaBadge` so the badge and the figure it
 * describes can never disagree: met, near-miss (within 3 points), breached.
 */
function healthTone(value: number, target: number): "positive" | "warning" | "critical" {
  if (value >= target) return "positive";
  if (value >= target - 3) return "warning";
  return "critical";
}

const TONE_TEXT: Record<"positive" | "warning" | "critical", string> = {
  positive: "text-positive",
  warning: "text-warning",
  critical: "text-critical",
};

export function PortalSummary({ data }: { data: ClientPortalData }) {
  const { client, summary, invoices } = data;

  const tone = healthTone(summary.answer_rate_30d, summary.sla_target);

  const openInvoices = invoices.filter((invoice) => invoice.status !== "Paid");
  const nextInvoice =
    summary.next_invoice_due === null
      ? null
      : (openInvoices.find(
          (invoice) => invoice.due_date === summary.next_invoice_due
        ) ?? null);

  return (
    <Panel>
      <PanelHeader
        title={<span className="text-base">Welcome, {client.name}</span>}
        description={`${client.industry} · your NorthWinds International service overview`}
        action={
          <span className="pill pill-neutral" aria-label={`Account code ${client.code}`}>
            {client.code}
          </span>
        }
      />

      <PanelBody flush>
        <div className="grid grid-cols-1 divide-y divide-border/80 sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0">
          {/* --- Team ------------------------------------------------------ */}
          <div className="p-5">
            <Metric
              label="Team assigned"
              size="lg"
              icon={<Users className="size-4" aria-hidden />}
              value={formatNumber(summary.team_size)}
              sub={
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span>{pluralize(summary.team_size, "specialist")}</span>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <PresenceDot status="active" />
                    <span className="tabular">{formatNumber(summary.active_now)}</span>
                    <span>active now</span>
                  </span>
                </span>
              }
            />
          </div>

          {/* --- Answer rate — the anchor ---------------------------------- */}
          <div className="bg-surface-sunken/60 p-5">
            <Metric
              label="Answer rate · 30 days"
              size="xl"
              icon={<PhoneCall className="size-4" aria-hidden />}
              value={
                <span className={cn(TONE_TEXT[tone])}>
                  {formatPercent(summary.answer_rate_30d)}
                </span>
              }
              sub={
                <span className="flex flex-wrap items-center gap-2">
                  <SlaBadge
                    value={summary.answer_rate_30d}
                    target={summary.sla_target}
                  />
                  <span>against a {formatPercent(summary.sla_target, 0)} target</span>
                </span>
              }
            />
          </div>

          {/* --- Outstanding balance --------------------------------------- */}
          <div className="p-5">
            <Metric
              label="Outstanding balance"
              size="lg"
              icon={<Wallet className="size-4" aria-hidden />}
              value={formatUsd(summary.outstanding_balance_usd)}
              sub={
                openInvoices.length === 0
                  ? "All invoices settled"
                  : `${formatNumber(openInvoices.length)} open ${pluralize(
                      openInvoices.length,
                      "invoice"
                    )}`
              }
            />
          </div>

          {/* --- Next invoice due ------------------------------------------ */}
          <div className="p-5">
            <Metric
              label="Next invoice due"
              size="lg"
              icon={<CalendarClock className="size-4" aria-hidden />}
              value={formatDate(summary.next_invoice_due, "None due")}
              sub={
                nextInvoice === null
                  ? "Nothing scheduled for collection"
                  : `${nextInvoice.qbo_invoice_id} · ${formatUsd(nextInvoice.amount_usd)}`
              }
            />
          </div>
        </div>
      </PanelBody>
    </Panel>
  );
}
