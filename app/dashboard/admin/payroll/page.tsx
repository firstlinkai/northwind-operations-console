/**
 * Payroll import screen (PRD verification case TC-04).
 *
 * Restricted to the CEO and HR — payroll is the most sensitive data in the
 * system. `requireInternal()` keeps client users out entirely; the narrower
 * role check below keeps Operations out too, and the API route revalidates
 * both server-side so the UI guard is convenience, not the control.
 */

import { redirect } from "next/navigation";

import { requireInternal } from "@/lib/auth/session";
import { getExecutiveKpis } from "@/lib/data/queries";
import { formatPhp, formatUsd } from "@/lib/utils/format";

import { Metric } from "@/components/dashboard/metric";
import { Panel, PanelBody } from "@/components/dashboard/panel";
import { PayrollImport } from "@/components/dashboard/payroll-import";
import { FxNote } from "@/components/dashboard/provenance";

export const metadata = {
  title: "Payroll Import",
};

export default async function PayrollPage() {
  const user = await requireInternal();

  // Operations managers can see productivity but not compensation.
  if (user.role !== "ceo_admin" && user.role !== "hr_admin") {
    redirect("/unauthorized");
  }

  const kpis = await getExecutiveKpis();

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-[-0.015em]">Payroll</h1>
        <p className="caption mt-0.5">
          Import the JeonSoft register and reconcile against the monthly expense figure.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <Panel>
          <PanelBody className="space-y-5">
            <Metric
              label="Net payroll expense"
              value={formatPhp(kpis.net_payroll_expense_php)}
              size="lg"
              delta={kpis.payroll_delta}
              sub={
                <span className="flex flex-col gap-1">
                  <span>{formatUsd(kpis.net_payroll_expense_usd)} converted</span>
                  <FxNote fx={kpis.fx_rate} />
                </span>
              }
            />
            <div className="rule" />
            <Metric
              label="Staff on payroll"
              value={kpis.active_headcount}
              size="md"
              sub={`${kpis.shift_coverage.night} night · ${kpis.shift_coverage.mid} mid · ${kpis.shift_coverage.day} day`}
            />
          </PanelBody>
        </Panel>

        <PayrollImport />
      </div>
    </div>
  );
}
