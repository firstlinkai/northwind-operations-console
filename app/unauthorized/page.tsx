import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { Panel, PanelBody } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import { canAccessInternal, personaById } from "@/lib/auth/personas";
import { signOut } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/session";
import type { UserRole } from "@/lib/types";

export const metadata: Metadata = {
  title: "Access restricted",
  description: "This account does not have access to the internal console.",
};

/**
 * Duplicated from `components/shell/persona-switcher.tsx`: that module is
 * `"use client"`, and a Server Component cannot read a value exported from one.
 */
const ROLE_LABEL: Record<UserRole, string> = {
  ceo_admin: "CEO · Admin",
  hr_admin: "HR Director",
  ops_manager: "Operations Manager",
  client_user: "Client portal user",
  staff: "Staff record",
};

/**
 * PRD §12.2 TC-03.
 *
 * A 403 is where most consoles get lazy. This one is demoed on purpose, so it
 * has to do three things: say plainly what happened, name the account and the
 * role it happened to, and put the viewer one click from somewhere they are
 * actually allowed to be.
 */
export default async function UnauthorizedPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const persona = personaById(user.id);
  const allowedInternal = canAccessInternal(user.role);

  const destination = allowedInternal
    ? { href: "/dashboard/admin", label: "Open the executive console" }
    : user.role === "client_user" && user.client_id
      ? {
          href: "/dashboard/client",
          label: `Open the ${user.client_name ?? "client"} portal`,
        }
      : null;

  const details: Array<{ term: string; value: string }> = [
    { term: "Signed in as", value: user.email },
    { term: "Role", value: ROLE_LABEL[user.role] },
    {
      term: "Data scope",
      value:
        persona?.scope ??
        (user.client_name
          ? `${user.client_name} only.`
          : "No portal access is granted to this account."),
    },
  ];

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-12 sm:px-6 sm:py-16">
      <div className="w-full max-w-xl">
        <Panel>
          <div className="flex items-start gap-4 border-b border-border/80 px-5 py-5 sm:px-6">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-md border border-warning/30 bg-warning-muted text-warning"
              aria-hidden
            >
              <ShieldCheck className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="label-eyebrow">Access restricted</p>
              <h1 className="mt-1.5 text-lg leading-snug font-semibold tracking-[-0.015em]">
                This account can&rsquo;t open the internal console
              </h1>
            </div>
          </div>

          <PanelBody className="space-y-5 px-5 py-5 sm:px-6">
            <p className="text-sm leading-relaxed text-muted-foreground">
              You&rsquo;re signed in as{" "}
              <span className="font-medium text-foreground">
                {user.full_name}
              </span>
              , a{" "}
              <span className="font-medium text-foreground">
                {ROLE_LABEL[user.role].toLowerCase()}
              </span>
              {user.client_name ? (
                <>
                  {" "}
                  for{" "}
                  <span className="font-medium text-foreground">
                    {user.client_name}
                  </span>
                </>
              ) : null}
              . Nothing has gone wrong and nothing was lost — the internal
              console carries payroll, margins and every client&rsquo;s data, so
              it is limited to NorthWinds&rsquo;s own admin roles.
            </p>

            <dl className="surface-well divide-y divide-border/70">
              {details.map((row) => (
                <div
                  key={row.term}
                  className="flex flex-col gap-0.5 px-3.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4"
                >
                  <dt className="label-eyebrow sm:w-32 sm:shrink-0">
                    {row.term}
                  </dt>
                  <dd className="min-w-0 text-xs leading-snug break-words">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-wrap items-center gap-2">
              {destination && (
                <Button
                  size="lg"
                  render={<Link href={destination.href} />}
                  className="gap-1.5"
                >
                  {destination.label}
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              )}
              <form action={signOut}>
                <Button type="submit" size="lg" variant="outline">
                  Sign in as someone else
                </Button>
              </form>
            </div>
          </PanelBody>
        </Panel>

        <p className="caption mt-4 text-center">
          Access is re-checked on the server for every request — a link, a
          bookmark or a typed URL all reach the same decision.
        </p>
      </div>
    </main>
  );
}
