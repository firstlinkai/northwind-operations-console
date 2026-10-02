"use client";

/**
 * Dashboard layout store (PRD §10).
 *
 * Persisted to localStorage so the CEO's arrangement survives a reload. Two
 * details matter beyond the PRD's sketch:
 *
 *  - `version` + `migrate`: the widget list will change as panels are added.
 *    Without versioning, a returning user's stale persisted array would hide
 *    every new panel, and it would look like the feature was never built.
 *  - `hasHydrated`: persisted state is unavailable during SSR. Components must
 *    wait for hydration before trusting `widgets`, or the server and client
 *    render different layouts and React throws.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface WidgetConfig {
  id: string;
  title: string;
  visible: boolean;
  order: number;
}

interface DashboardState {
  widgets: WidgetConfig[];
  hasHydrated: boolean;
  toggleWidget: (id: string) => void;
  reorderWidgets: (newOrder: WidgetConfig[]) => void;
  moveWidget: (id: string, direction: "up" | "down") => void;
  resetLayout: () => void;
  setHasHydrated: (v: boolean) => void;
}

export const defaultWidgets: WidgetConfig[] = [
  { id: "kpi-cards", title: "Top Level KPIs", visible: true, order: 1 },
  { id: "cashflow-chart", title: "Cash Flow & Forecast", visible: true, order: 2 },
  { id: "ar-aging", title: "Accounts Receivable Ageing", visible: true, order: 3 },
  { id: "live-heatmap", title: "Staff Heatmap & Overtime", visible: true, order: 4 },
  { id: "dept-tabs", title: "Departmental Breakdown", visible: true, order: 5 },
  { id: "margin-simulator", title: "Interactive Margin Simulator", visible: true, order: 6 },
  { id: "ai-insights", title: "Executive AI Briefing", visible: true, order: 7 },
];

const LAYOUT_VERSION = 2;

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
      widgets: defaultWidgets,
      hasHydrated: false,

      toggleWidget: (id) =>
        set((state) => ({
          widgets: state.widgets.map((w) =>
            w.id === id ? { ...w, visible: !w.visible } : w
          ),
        })),

      reorderWidgets: (newOrder) =>
        set({ widgets: newOrder.map((w, i) => ({ ...w, order: i + 1 })) }),

      moveWidget: (id, direction) =>
        set((state) => {
          const sorted = [...state.widgets].sort((a, b) => a.order - b.order);
          const index = sorted.findIndex((w) => w.id === id);
          const target = direction === "up" ? index - 1 : index + 1;
          if (index < 0 || target < 0 || target >= sorted.length) return state;

          const next = [...sorted];
          const a = next[index]!;
          const b = next[target]!;
          next[index] = b;
          next[target] = a;

          return { widgets: next.map((w, i) => ({ ...w, order: i + 1 })) };
        }),

      resetLayout: () => set({ widgets: defaultWidgets }),
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: "northwinds-dashboard-layout",
      version: LAYOUT_VERSION,
      // Any older persisted layout is discarded rather than merged — a stale
      // list would silently hide panels that shipped after it was saved.
      migrate: () => ({ widgets: defaultWidgets }) as Partial<DashboardState>,
      partialize: (state) => ({ widgets: state.widgets }) as Partial<DashboardState>,
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    }
  )
);

/** Widgets in display order, visible only. */
export const visibleWidgets = (widgets: WidgetConfig[]): WidgetConfig[] =>
  [...widgets].filter((w) => w.visible).sort((a, b) => a.order - b.order);
