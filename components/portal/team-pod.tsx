"use client";

/**
 * TeamPod — the staff assigned to this client, as the CLIENT sees them.
 *
 * LAYOUT CHOICE: a card grid, not a table. At 8–16 people a table of six
 * narrow columns reads as an audit sheet; the client portal is meant to feel
 * calm and human. Cards give each person an avatar, a name and a presence
 * state at a glance, and they reflow to a single column on a phone without
 * horizontal scrolling. Above ~40 people a table would win — the pods here are
 * nowhere near that.
 *
 * PRIVACY (PRD §6, `ClientTeamMember`):
 *  - No compensation. The type carries no pay field and none is derived here.
 *  - Presence is Active / Idle / Offline only. No idle minutes, no keystroke
 *    counts, no screenshots, no "last seen" timestamp — the PRD is explicit
 *    that monitoring must not be invasive, and a client does not need it.
 *  - Tenure is the one longevity signal shown, because continuity of care is
 *    what a healthcare client actually wants to know about.
 */

import { useMemo, useState } from "react";
import { Users } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState, Panel, PanelBody, PanelHeader } from "@/components/dashboard/panel";
import { PresenceBadge } from "@/components/dashboard/status-badge";
import { cn } from "@/lib/utils";
import type { ClientTeamMember, DepartmentName, ShiftType } from "@/lib/types";
import { formatNumber, pluralize } from "@/lib/utils/format";

const SHIFT_LABEL: Record<ShiftType, string> = {
  day: "Day shift",
  mid: "Mid shift",
  night: "Night shift",
};

/** `27` → `2 yr 3 mo`. Whole years drop the months, sub-month reads "< 1 mo". */
function formatTenure(months: number): string {
  if (!Number.isFinite(months) || months <= 0) return "< 1 mo";
  const total = Math.round(months);
  const years = Math.floor(total / 12);
  const remainder = total % 12;
  if (years === 0) return `${formatNumber(remainder)} mo`;
  if (remainder === 0) return `${formatNumber(years)} yr`;
  return `${formatNumber(years)} yr ${formatNumber(remainder)} mo`;
}

/** Two-letter monogram. Deliberately no photos — initials only. */
function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

type DepartmentFilter = DepartmentName | "all";

export function TeamPod({ team }: { team: ClientTeamMember[] }) {
  const [department, setDepartment] = useState<DepartmentFilter>("all");

  /** Departments actually present in this pod, in first-appearance order. */
  const departments = useMemo<DepartmentName[]>(() => {
    const seen: DepartmentName[] = [];
    for (const member of team) {
      if (!seen.includes(member.department)) seen.push(member.department);
    }
    return seen;
  }, [team]);

  const visible = useMemo(
    () =>
      department === "all"
        ? team
        : team.filter((member) => member.department === department),
    [team, department]
  );

  // "On shift" = a live workstation of any kind. Idle staff are still on the
  // clock; the portal does not draw a line between active and idle beyond the
  // badge itself.
  const onShift = team.filter((member) => member.status !== "offline").length;

  const showFilter = departments.length > 1;

  return (
    <Panel>
      <PanelHeader
        title="Your team"
        description={
          team.length === 0
            ? "No specialists are currently assigned"
            : `${formatNumber(team.length)} ${pluralize(
                team.length,
                "specialist"
              )} assigned · ${formatNumber(onShift)} on shift now`
        }
        action={<Users className="size-4 text-muted-foreground/70" aria-hidden />}
      />

      {team.length === 0 ? (
        <PanelBody>
          <EmptyState
            title="No team members assigned"
            description="Once your pod is staffed, every specialist assigned to your account appears here with their role, shift and tenure."
            icon={<Users className="size-6" aria-hidden />}
          />
        </PanelBody>
      ) : (
        <PanelBody className="space-y-4">
          {showFilter && (
            <div
              role="group"
              aria-label="Filter team by department"
              className="flex flex-wrap items-center gap-1.5"
            >
              <FilterChip
                label="All"
                count={team.length}
                selected={department === "all"}
                onSelect={() => setDepartment("all")}
              />
              {departments.map((name) => (
                <FilterChip
                  key={name}
                  label={name}
                  count={team.filter((member) => member.department === name).length}
                  selected={department === name}
                  onSelect={() => setDepartment(name)}
                />
              ))}
            </div>
          )}

          {visible.length === 0 ? (
            <EmptyState
              title="No specialists in this department"
              description="Choose another department to see the rest of your pod."
            />
          ) : (
            // Two columns maximum. This panel sits in a half-width column on
            // the portal overview, so a third column squeezed each card to
            // ~200px and truncated people's names to "Fati…". A client should
            // never see their own staff rendered as an ellipsis — the name is
            // the whole point of this panel, so it wraps rather than truncates,
            // and the presence badge moved down to the meta line to stop
            // competing with it for horizontal space.
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {visible.map((member) => (
                <li
                  key={member.user_id}
                  className="flex items-start gap-3 rounded-md border border-border/80 bg-card p-3.5"
                >
                  <Avatar size="lg">
                    <AvatarFallback className="text-xs font-medium">
                      {initialsOf(member.full_name)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="min-w-0">
                      <p className="text-sm leading-snug font-medium">
                        {member.full_name}
                      </p>
                      <p className="caption">{member.job_title}</p>
                    </div>

                    <div className="caption flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span>{member.department}</span>
                      <span aria-hidden>·</span>
                      <span>{SHIFT_LABEL[member.shift]}</span>
                      <span aria-hidden>·</span>
                      <span>
                        <span className="tabular">{formatTenure(member.tenure_months)}</span> with
                        NorthWinds
                      </span>
                    </div>

                    <PresenceBadge status={member.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
      )}
    </Panel>
  );
}

function FilterChip({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        selected
          ? "border-primary/40 bg-accent text-accent-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-muted"
      )}
    >
      {label}
      <span className="tabular opacity-70">{formatNumber(count)}</span>
    </button>
  );
}
