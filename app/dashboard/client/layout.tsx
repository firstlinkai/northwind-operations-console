import { Eye } from "lucide-react";

import { AppSidebar, MobileNav } from "@/components/shell/app-sidebar";
import { TopBar } from "@/components/shell/top-bar";
import { Button } from "@/components/ui/button";
import { exitPreview } from "@/lib/auth/actions";
import { requireClientScope } from "@/lib/auth/session";
import { CLIENTS } from "@/lib/constants";
import { getThemeMode } from "@/lib/theme/session";
import { resolveRegister } from "@/lib/theme/theme";

/**
 * CLIENT PORTAL LAYOUT — light register by default.
 *
 * External healthcare clients come here to check SLAs and invoices, not to run
 * a business; the paper-light register reads calm and trustworthy where the
 * CEO console reads engineered. That is the designed default — a visitor who
 * prefers dark can override it in the theme control, and the choice is read
 * server-side so the first paint is already correct.
 *
 * `requireClientScope()` returns the tenant whose data may be read. When a
 * `ceo_admin` is impersonating for a demo it flags `isPreview`, and the banner
 * below makes that state impossible to miss — using the WARNING token, because
 * previewing is a caution, not a failure.
 */
export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, clientId, isPreview } = await requireClientScope();
  const client = CLIENTS.find((c) => c.id === clientId);
  const clientName = client?.name ?? "Client portal";

  const themeMode = await getThemeMode();
  const register = resolveRegister(themeMode, "light");

  return (
    <div
      className={`${register === "dark" ? "dark" : ""} flex w-full flex-1 flex-col bg-background text-foreground`}
    >
      <AppSidebar
        variant="client"
        user={user}
        register={register}
        clientName={clientName}
      />

      <div className="flex min-h-svh min-w-0 flex-1 flex-col lg:pl-60">
        {isPreview && (
          <div className="border-b border-warning/30 bg-warning-muted">
            <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
              <p className="flex min-w-0 items-center gap-2 text-xs leading-snug text-warning">
                <Eye className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0">
                  Previewing as{" "}
                  <span className="font-semibold">{clientName}</span> — this is
                  what the client sees.
                </span>
              </p>
              <form action={exitPreview}>
                <Button type="submit" size="sm" variant="outline">
                  Exit preview
                </Button>
              </form>
            </div>
          </div>
        )}

        <TopBar
          title={clientName}
          description={client?.industry}
          user={user}
          previewClientId={isPreview ? clientId : null}
          register={register}
          themeMode={themeMode}
          leading={
            <MobileNav
              variant="client"
              user={user}
              register={register}
              clientName={clientName}
            />
          }
        />

        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
