/**
 * Status vocabulary for the whole product.
 *
 * Every status colour in NorthWinds comes from here. Invoice state, SLA health and
 * staff presence are the three things a viewer scans for, so they must look
 * identical on the CEO console and in the client portal — a viewer should
 * never have to re-learn what amber means when they change page.
 */

import { cn } from "@/lib/utils";
import type { InvoiceStatus, PresenceStatus } from "@/lib/types";

type Tone = "positive" | "warning" | "critical" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  positive: "pill-positive",
  warning: "pill-warning",
  critical: "pill-critical",
  neutral: "pill-neutral",
};

const DOT_CLASS: Record<Tone, string> = {
  positive: "bg-positive",
  warning: "bg-warning",
  critical: "bg-critical",
  neutral: "bg-neutral",
};

export function StatusPill({
  tone,
  children,
  withDot = false,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  withDot?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("pill", TONE_CLASS[tone], className)}>
      {withDot && <span className={cn("presence-dot", DOT_CLASS[tone])} aria-hidden />}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

const INVOICE_TONE: Record<InvoiceStatus, Tone> = {
  Paid: "positive",
  Pending: "warning",
  Overdue: "critical",
};

export function InvoiceStatusBadge({
  status,
  daysOverdue,
}: {
  status: InvoiceStatus;
  daysOverdue?: number;
}) {
  const showAge = status === "Overdue" && typeof daysOverdue === "number" && daysOverdue > 0;
  return (
    <StatusPill tone={INVOICE_TONE[status]}>
      {status}
      {showAge && <span className="opacity-70">· {daysOverdue}d</span>}
    </StatusPill>
  );
}

/* -------------------------------------------------------------------------- */

const PRESENCE_TONE: Record<PresenceStatus, Tone> = {
  active: "positive",
  idle: "warning",
  offline: "neutral",
};

const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  active: "Active",
  idle: "Idle",
  offline: "Offline",
};

export function PresenceBadge({ status }: { status: PresenceStatus }) {
  return (
    <StatusPill tone={PRESENCE_TONE[status]} withDot>
      {PRESENCE_LABEL[status]}
    </StatusPill>
  );
}

/** Bare dot for dense grids where a full pill would not fit. */
export function PresenceDot({
  status,
  className,
}: {
  status: PresenceStatus;
  className?: string;
}) {
  return (
    <span
      className={cn("presence-dot", DOT_CLASS[PRESENCE_TONE[status]], className)}
      role="img"
      aria-label={PRESENCE_LABEL[status]}
    />
  );
}

/* -------------------------------------------------------------------------- */

/**
 * SLA health against a target. Amber is a deliberate near-miss band: a client
 * sitting at 94.2% against a 95% target is not "failing", but the account
 * manager needs to see it before the client does.
 */
export function SlaBadge({
  value,
  target,
  label,
}: {
  value: number;
  target: number;
  label?: string;
}) {
  const tone: Tone = value >= target ? "positive" : value >= target - 3 ? "warning" : "critical";
  const text = value >= target ? "Met" : value >= target - 3 ? "At risk" : "Breached";
  return (
    <StatusPill tone={tone}>
      {label ?? text}
      <span className="opacity-70 tabular">{value.toFixed(1)}%</span>
    </StatusPill>
  );
}
