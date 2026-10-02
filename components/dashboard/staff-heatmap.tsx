"use client";

/**
 * Staff heatmap — the CEO's live workforce grid.
 *
 * WHY A GRID AND NOT A TABLE
 * 60 people do not fit on one screen as rows, and a table forces the eye to
 * read before it can compare. A dense tile grid lets colour do the first pass:
 * the intensity ramp answers "where are the problems" in under a second, and
 * only then does the viewer read a name.
 *
 * HOW PRODUCTIVITY IS ENCODED
 * Tint intensity rises as the score falls, so the *problems* are the loudest
 * cells rather than the wins. The ramp runs positive → warning → critical and
 * every step is an alpha over the panel surface, capped at 32%. That cap is
 * deliberate: at 32% the composited surface stays within ~0.34 L in the dark
 * register and ~0.86 L in the light one, so `text-foreground` clears contrast
 * in both. Nothing on a tile is coloured text on a coloured tint.
 *
 * Colour is never the only channel. Every tile also carries a written band
 * label ("Watch", "Critical"), a proportional score bar, and a full sentence in
 * its accessible name.
 */

import * as React from "react";
import { TriangleAlert } from "lucide-react";

import {
  EmptyState,
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
} from "@/components/dashboard/panel";
import { PresenceDot } from "@/components/dashboard/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatHours, formatNumber } from "@/lib/utils/format";
import type {
  DepartmentName,
  PresenceStatus,
  StaffHeatmapEntry,
} from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Productivity ramp                                                          */
/* -------------------------------------------------------------------------- */

interface ProductivityBand {
  /** Written form of the band — the non-colour carrier of the same meaning. */
  label: string;
  /** Tile tint. Alpha only, never a hardcoded colour. Max 32% — see header. */
  surface: string;
  /** Fill for the score bar, at full strength (it sits on a neutral track). */
  bar: string;
}

function productivityBand(score: number): ProductivityBand {
  if (score >= 85) {
    return { label: "Strong", surface: "bg-positive/20", bar: "bg-positive" };
  }
  if (score >= 75) {
    return { label: "Healthy", surface: "bg-positive/10", bar: "bg-positive" };
  }
  if (score >= 65) {
    return { label: "Watch", surface: "bg-warning/16", bar: "bg-warning" };
  }
  if (score >= 55) {
    return { label: "Low", surface: "bg-warning/32", bar: "bg-warning" };
  }
  return { label: "Critical", surface: "bg-critical/32", bar: "bg-critical" };
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

type PresenceFilter = PresenceStatus | "all";
type DepartmentFilter = DepartmentName | "all";

const PRESENCE_LABEL: Record<PresenceFilter, string> = {
  all: "All presence",
  active: "Active",
  idle: "Idle",
  offline: "Offline",
};

const PRESENCE_OPTIONS: PresenceFilter[] = ["all", "active", "idle", "offline"];

const STATUS_WORD: Record<PresenceStatus, string> = {
  active: "Active",
  idle: "Idle",
  offline: "Offline",
};

/* -------------------------------------------------------------------------- */

export function StaffHeatmap({ staff }: { staff: StaffHeatmapEntry[] }) {
  const [presence, setPresence] = React.useState<PresenceFilter>("all");
  const [department, setDepartment] = React.useState<DepartmentFilter>("all");
  const [riskOnly, setRiskOnly] = React.useState(false);

  const riskToggleId = React.useId();

  const departments = React.useMemo<DepartmentName[]>(
    () => Array.from(new Set(staff.map((entry) => entry.department))).sort(),
    [staff],
  );

  const visible = React.useMemo(() => {
    const filtered = staff.filter((entry) => {
      if (presence !== "all" && entry.status !== presence) return false;
      if (department !== "all" && entry.department !== department) return false;
      if (riskOnly && !entry.overtime_risk) return false;
      return true;
    });

    // The incoming array is already risk-first; re-assert it after filtering.
    // Array#sort is stable, so everything else keeps the query layer's order.
    return [...filtered].sort(
      (a, b) => Number(b.overtime_risk) - Number(a.overtime_risk),
    );
  }, [staff, presence, department, riskOnly]);

  // Counts describe the whole roster, not the filtered view — the CEO needs the
  // denominator to stay put while they slice.
  const counts = React.useMemo(() => {
    let active = 0;
    let idle = 0;
    let offline = 0;
    let atRisk = 0;
    for (const entry of staff) {
      if (entry.status === "active") active += 1;
      else if (entry.status === "idle") idle += 1;
      else offline += 1;
      if (entry.overtime_risk) atRisk += 1;
    }
    return { active, idle, offline, atRisk };
  }, [staff]);

  return (
    <Panel>
      <PanelHeader
        title="Staff heatmap"
        description="Live presence and productivity across the floor. Tint intensity rises as productivity falls."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Select
              value={presence}
              onValueChange={(value: PresenceFilter | null) =>
                setPresence(value ?? "all")
              }
            >
              <SelectTrigger size="sm" aria-label="Filter by presence status">
                <SelectValue>
                  {(value: PresenceFilter | null) =>
                    PRESENCE_LABEL[value ?? "all"]
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PRESENCE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {PRESENCE_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={department}
              onValueChange={(value: DepartmentFilter | null) =>
                setDepartment(value ?? "all")
              }
            >
              <SelectTrigger size="sm" aria-label="Filter by department">
                <SelectValue>
                  {(value: DepartmentFilter | null) =>
                    value === null || value === "all" ? "All departments" : value
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <label
              htmlFor={riskToggleId}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-input px-2.5 py-1.5 text-xs font-medium select-none"
            >
              <Switch
                id={riskToggleId}
                size="sm"
                checked={riskOnly}
                onCheckedChange={(checked: boolean) => setRiskOnly(checked)}
              />
              Overtime risk only
            </label>
          </div>
        }
      />

      <PanelBody>
        {visible.length === 0 ? (
          <EmptyState
            title="No staff match these filters"
            description="Widen the presence or department filter, or turn off the overtime-risk toggle."
          />
        ) : (
          <TooltipProvider delay={120}>
            <p className="sr-only">
              {`Showing ${visible.length} of ${staff.length} staff. Each tile states the person's name, job title, client, presence and productivity band.`}
            </p>
            <ul
              className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8"
              aria-label="Staff productivity and presence tiles"
            >
              {visible.map((entry) => (
                <StaffTile key={entry.user_id} entry={entry} />
              ))}
            </ul>
          </TooltipProvider>
        )}
      </PanelBody>

      <PanelFooter>
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
          aria-live="polite"
        >
          <LegendCount tone="bg-positive" label="Active" value={counts.active} />
          <LegendCount tone="bg-warning" label="Idle" value={counts.idle} />
          <LegendCount tone="bg-neutral" label="Offline" value={counts.offline} />
          <span className="text-critical">
            <span className="tabular font-semibold">
              {formatNumber(counts.atRisk)}
            </span>{" "}
            flagged for overtime risk
          </span>
          <span className="ml-auto text-muted-foreground">
            <span className="tabular">{formatNumber(visible.length)}</span> of{" "}
            <span className="tabular">{formatNumber(staff.length)}</span> shown
          </span>
        </div>
      </PanelFooter>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function LegendCount({
  tone,
  label,
  value,
}: {
  tone: string;
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className={cn("presence-dot", tone)} aria-hidden />
      <span className="tabular font-semibold text-foreground">
        {formatNumber(value)}
      </span>
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

function StaffTile({ entry }: { entry: StaffHeatmapEntry }) {
  const band = productivityBand(entry.productivity_score);
  const scoreWidth = Math.max(0, Math.min(100, entry.productivity_score));
  const client = entry.client_code ?? "Internal";

  // The accessible name carries every channel the tint carries, in words.
  const description = [
    entry.full_name,
    entry.job_title,
    `${client} account`,
    `${STATUS_WORD[entry.status]} now`,
    `${entry.shift} shift`,
    `productivity ${formatNumber(entry.productivity_score)} of 100 — ${band.label}`,
    `${formatHours(entry.active_hours)} active, ${formatHours(entry.idle_hours)} idle, ${formatHours(entry.overtime_hours)} overtime`,
    entry.overtime_risk ? "Flagged: overtime risk" : null,
  ]
    .filter((part): part is string => part !== null)
    .join(". ");

  return (
    <li>
      <Tooltip>
        <TooltipTrigger
          aria-label={description}
          className={cn(
            "flex w-full flex-col gap-1.5 rounded-md border p-2.5 text-left transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            band.surface,
            entry.overtime_risk
              ? "border-critical ring-1 ring-critical/40"
              : "border-border/70",
          )}
        >
          <span className="flex items-center gap-1.5">
            <PresenceDot status={entry.status} />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
              {entry.full_name}
            </span>
            {entry.overtime_risk && (
              <TriangleAlert className="size-3.5 shrink-0 text-critical" aria-hidden />
            )}
          </span>

          {/* Secondary text is foreground/70, not muted-foreground: measured
              against every band above, muted-foreground drops to 3.2:1 on
              warning/32 while foreground/70 never falls below 4.9:1. */}
          <span className="block truncate text-[0.6875rem] leading-tight text-foreground/70">
            {entry.job_title}
          </span>

          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[0.625rem] font-medium tracking-[0.06em] text-foreground/70 uppercase">
              {client}
            </span>
            <span className="tabular text-xs font-semibold text-foreground">
              {formatNumber(entry.productivity_score)}
            </span>
          </span>

          <span className="block h-1 w-full overflow-hidden rounded-full bg-foreground/10">
            <span
              className={cn("block h-full rounded-full", band.bar)}
              style={{ inlineSize: `${scoreWidth}%` }}
              aria-hidden
            />
          </span>

          <span className="text-[0.625rem] leading-none font-medium text-muted-foreground">
            {band.label}
          </span>
        </TooltipTrigger>

        <TooltipContent className="max-w-xs flex-col items-start gap-1">
          <span className="text-xs font-semibold">{entry.full_name}</span>
          <span className="text-[0.6875rem] opacity-80">
            {entry.job_title} · {client} · {entry.department}
          </span>
          <span className="tabular text-[0.6875rem]">
            Active {formatHours(entry.active_hours)} · Idle{" "}
            {formatHours(entry.idle_hours)} · Overtime{" "}
            {formatHours(entry.overtime_hours)}
          </span>
          <span className="tabular text-[0.6875rem]">
            Productivity {formatNumber(entry.productivity_score)}/100 ·{" "}
            {band.label}
          </span>
          {entry.overtime_risk && (
            <span className="text-[0.6875rem] font-semibold">
              ⚠ Overtime risk — high hours, productivity not keeping pace.
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}
