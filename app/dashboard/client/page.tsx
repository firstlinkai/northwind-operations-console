/**
 * CLIENT PORTAL (PRD §6)
 *
 * Composition root for the multi-tenant portal.
 *
 * THE ISOLATION RULE, in one place:
 * `requireClientScope()` derives `clientId` from the SESSION. It is never read
 * from a route param, a search param or a request body — so a client cannot
 * pivot to another tenant by editing a URL. Every query below is scoped by
 * that single value, and `getClientPortalData()` returns only rows belonging
 * to it. When Supabase is connected, the RLS policies in
 * `supabase/policies.sql` enforce exactly the same rule inside Postgres, so
 * the guarantee survives even if this page were bypassed entirely.
 *
 * Defence in depth: a `client_user` whose account has no `client_id` is
 * treated as broken and redirected, never as a wildcard.
 */

import { notFound } from "next/navigation";

import { requireClientScope } from "@/lib/auth/session";
import { getClientPortalData } from "@/lib/data/queries";

import { WidgetErrorBoundary } from "@/components/dashboard/widget-wrapper";
import { PortalSummary } from "@/components/portal/portal-summary";
import { TeamPod } from "@/components/portal/team-pod";
import { SlaPanel } from "@/components/portal/sla-panel";
import { InvoiceLedger } from "@/components/portal/invoice-ledger";

export const metadata = {
  title: "Client Portal",
};

export default async function ClientPortalPage() {
  const { clientId } = await requireClientScope();

  const data = getClientPortalData(clientId);
  if (!data) notFound();

  return (
    <div className="space-y-5">
      <WidgetErrorBoundary title="Account Summary">
        <PortalSummary data={data} />
      </WidgetErrorBoundary>

      <WidgetErrorBoundary title="SLA & Calling Performance">
        <SlaPanel sla={data.sla} />
      </WidgetErrorBoundary>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <WidgetErrorBoundary title="Your Assigned Team">
          <TeamPod team={data.team} />
        </WidgetErrorBoundary>

        <WidgetErrorBoundary title="Billing & Invoices">
          <InvoiceLedger invoices={data.invoices} />
        </WidgetErrorBoundary>
      </div>
    </div>
  );
}
