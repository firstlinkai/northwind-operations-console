/**
 * CEO MASTER DASHBOARD (PRD §5)
 *
 * Composition root. Everything is fetched here, on the server, in parallel —
 * so there are no client-side data waterfalls and no query logic ships to the
 * browser. Finished panels are handed to `DashboardGrid`, which applies the
 * CEO's saved order and visibility.
 *
 * Every panel is individually wrapped in an error boundary. If QuickBooks is
 * down and the cash-flow panel throws, the KPIs, heatmap and SLAs all still
 * render. One broken integration must never take the console down mid-demo.
 */

import { Suspense } from "react";

import { requireInternal } from "@/lib/auth/session";
import {
  getCallingMetrics,
  getCashFlowPanel,
  getExecutiveKpis,
  getHrMetrics,
  getMarginBaseline,
  getOperationsMetrics,
  getStaffHeatmap,
} from "@/lib/data/queries";

import { DashboardGrid, LayoutControls } from "@/components/dashboard/dashboard-grid";
import { WidgetErrorBoundary } from "@/components/dashboard/widget-wrapper";
import { Skeleton } from "@/components/ui/skeleton";

import { KpiRow } from "@/components/dashboard/kpi-row";
import { CashFlowPanel } from "@/components/dashboard/cashflow-panel";
import { ArAgingPanel } from "@/components/dashboard/ar-aging-panel";
import { StaffHeatmap } from "@/components/dashboard/staff-heatmap";
import { DepartmentTabs } from "@/components/dashboard/department-tabs";
import { MarginSimulator } from "@/components/dashboard/margin-simulator";
import { AiBriefing } from "@/components/dashboard/ai-briefing";

export const metadata = {
  title: "Executive Overview",
};

function PanelSkeleton({ height = 280 }: { height?: number }) {
  return <Skeleton className="w-full rounded-lg" style={{ height }} />;
}

export default async function AdminDashboardPage() {
  const user = await requireInternal();

  // Fetched in parallel — these are independent reads.
  const [kpis, cashFlow, operations, marginBaseline] = await Promise.all([
    getExecutiveKpis(),
    getCashFlowPanel(),
    getOperationsMetrics(),
    getMarginBaseline(),
  ]);

  // Synchronous derivations from the in-memory dataset.
  const heatmap = getStaffHeatmap();
  const hr = getHrMetrics();
  const calling = getCallingMetrics(null, 30);

  const firstName = user.full_name.split(" ")[0];

  const slots: Record<string, React.ReactNode> = {
    "kpi-cards": (
      <WidgetErrorBoundary title="Top Level KPIs">
        <KpiRow kpis={kpis} />
      </WidgetErrorBoundary>
    ),
    "cashflow-chart": (
      <WidgetErrorBoundary
        title="Cash Flow & Forecast"
        fallbackDescription="The forecast could not be rendered. Underlying invoice data is unaffected."
      >
        <Suspense fallback={<PanelSkeleton height={380} />}>
          <CashFlowPanel data={cashFlow} />
        </Suspense>
      </WidgetErrorBoundary>
    ),
    "ar-aging": (
      <WidgetErrorBoundary title="Accounts Receivable Ageing">
        <ArAgingPanel data={cashFlow} />
      </WidgetErrorBoundary>
    ),
    "live-heatmap": (
      <WidgetErrorBoundary title="Staff Heatmap & Overtime">
        <StaffHeatmap staff={heatmap} />
      </WidgetErrorBoundary>
    ),
    "dept-tabs": (
      <WidgetErrorBoundary title="Departmental Breakdown">
        <DepartmentTabs hr={hr} operations={operations} calling={calling} />
      </WidgetErrorBoundary>
    ),
    "margin-simulator": (
      <WidgetErrorBoundary title="Interactive Margin Simulator">
        <MarginSimulator baseline={marginBaseline} />
      </WidgetErrorBoundary>
    ),
    "ai-insights": (
      <WidgetErrorBoundary title="Executive AI Briefing">
        <AiBriefing />
      </WidgetErrorBoundary>
    ),
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.015em]">
            Good evening, {firstName}
          </h1>
          <p className="caption mt-0.5">
            {kpis.active_headcount} staff across {calling.by_client.length} healthcare
            accounts · {kpis.shift_coverage.night} on night coverage
          </p>
        </div>
        <LayoutControls />
      </header>

      <DashboardGrid slots={slots} />
    </div>
  );
}
