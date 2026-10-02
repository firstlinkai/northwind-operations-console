"use client";

/**
 * Dashboard grid + layout controls (PRD §10).
 *
 * The page is a Server Component that fetches data and renders each panel; it
 * hands the finished panels here as a `slots` map. This component owns only
 * ORDER and VISIBILITY, which is what the Zustand store persists.
 *
 * Passing server-rendered nodes into a client component this way keeps the
 * data fetching on the server (no client-side waterfalls, no exposed queries)
 * while still allowing the CEO to rearrange the console.
 *
 * Hydration note: persisted state is not available during SSR, so until
 * `hasHydrated` flips we deliberately render the DEFAULT layout — identical to
 * what the server produced. Reading persisted widgets on the first client
 * render is the classic way to trip a React hydration mismatch.
 */

import { useMemo } from "react";
import { Eye, EyeOff, MoveDown, MoveUp, RotateCcw, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  defaultWidgets,
  useDashboardStore,
  visibleWidgets,
  type WidgetConfig,
} from "@/lib/store/use-dashboard-store";

export function DashboardGrid({ slots }: { slots: Record<string, React.ReactNode> }) {
  const hasHydrated = useDashboardStore((s) => s.hasHydrated);
  const stored = useDashboardStore((s) => s.widgets);

  const widgets = hasHydrated ? stored : defaultWidgets;
  const ordered = useMemo(() => visibleWidgets(widgets), [widgets]);

  return (
    <div className="space-y-5">
      {ordered.map((w) => (
        // `id` is what the sidebar's in-page nav anchors target
        // (`#cashflow-chart`, `#live-heatmap`, …); `scroll-mt` keeps the
        // panel header clear of the sticky top bar when jumped to.
        <section key={w.id} id={w.id} aria-label={w.title} className="scroll-mt-20">
          {slots[w.id] ?? null}
        </section>
      ))}

      {ordered.length === 0 && (
        <div className="surface-well px-6 py-12 text-center">
          <p className="text-sm font-medium">Every panel is hidden</p>
          <p className="caption mt-1">
            Use <span className="font-medium">Customise layout</span> to bring panels back.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The layout menu. Lives in the page header rather than inside the grid so it
 * stays reachable even when every panel is hidden.
 */
export function LayoutControls() {
  const hasHydrated = useDashboardStore((s) => s.hasHydrated);
  const stored = useDashboardStore((s) => s.widgets);
  const toggleWidget = useDashboardStore((s) => s.toggleWidget);
  const moveWidget = useDashboardStore((s) => s.moveWidget);
  const resetLayout = useDashboardStore((s) => s.resetLayout);

  const widgets: WidgetConfig[] = hasHydrated ? stored : defaultWidgets;
  const ordered = useMemo(
    () => [...widgets].sort((a, b) => a.order - b.order),
    [widgets]
  );
  const hiddenCount = ordered.filter((w) => !w.visible).length;

  return (
    <DropdownMenu>
      {/* Base UI uses `render` rather than Radix's `asChild`. */}
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <SlidersHorizontal className="size-3.5" aria-hidden />
        Customise layout
        {hiddenCount > 0 && (
          <span className="pill pill-neutral ml-1">{hiddenCount} hidden</span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex items-center justify-between">
          Panels
          <span className="caption font-normal">Saved to this browser</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {ordered.map((w, index) => (
          <DropdownMenuItem
            key={w.id}
            // Keep the menu open while rearranging — closing after every click
            // would make reordering a chore.
            onSelect={(e) => e.preventDefault()}
            className="flex items-center justify-between gap-2"
          >
            <button
              type="button"
              onClick={() => toggleWidget(w.id)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              aria-pressed={w.visible}
            >
              {w.visible ? (
                <Eye className="size-3.5 shrink-0" aria-hidden />
              ) : (
                <EyeOff className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className={w.visible ? "truncate" : "truncate text-muted-foreground"}>
                {w.title}
              </span>
            </button>

            <span className="flex shrink-0 items-center">
              <button
                type="button"
                onClick={() => moveWidget(w.id, "up")}
                disabled={index === 0}
                aria-label={`Move ${w.title} up`}
                className="rounded p-1 hover:bg-accent disabled:opacity-30"
              >
                <MoveUp className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => moveWidget(w.id, "down")}
                disabled={index === ordered.length - 1}
                aria-label={`Move ${w.title} down`}
                className="rounded p-1 hover:bg-accent disabled:opacity-30"
              >
                <MoveDown className="size-3.5" aria-hidden />
              </button>
            </span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => resetLayout()}>
          <RotateCcw className="size-3.5" aria-hidden />
          Reset to default layout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
