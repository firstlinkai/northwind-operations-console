import { AppSidebar, MobileNav } from "@/components/shell/app-sidebar";
import { TopBar } from "@/components/shell/top-bar";
import { getPreviewClientId, requireInternal } from "@/lib/auth/session";
import { getThemeMode } from "@/lib/theme/session";
import { resolveRegister } from "@/lib/theme/theme";

/**
 * INTERNAL CONSOLE LAYOUT — dark register by default.
 *
 * The register class on the root wrapper re-declares the token set for this
 * entire subtree (see the `.dark` block in app/globals.css). Nothing here picks
 * a colour: the same `bg-card` / `text-muted-foreground` classes the client
 * portal uses simply resolve to deep ink instead of paper.
 *
 * Dark is this area's DESIGNED default, not a hardcode — a visitor who picks
 * Light in the theme control overrides it. The preference is read from a
 * cookie on the server, so the correct register is in the first byte of HTML:
 * no flash, no hydration mismatch.
 *
 * Portalled UI (the persona menu, the mobile drawer) escapes this wrapper, so
 * those components take an explicit `register` prop and re-apply the class on
 * their popup. That is the only place the register is ever named twice.
 *
 * `requireInternal()` is the authoritative guard — see proxy.ts.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireInternal();
  const previewClientId = await getPreviewClientId();

  const themeMode = await getThemeMode();
  const register = resolveRegister(themeMode, "dark");

  return (
    <div
      className={`${register === "dark" ? "dark" : ""} flex w-full flex-1 flex-col bg-background text-foreground`}
    >
      <AppSidebar variant="internal" user={user} register={register} />

      <div className="flex min-h-svh min-w-0 flex-1 flex-col lg:pl-60">
        <TopBar
          title="Executive Console"
          description="Finance, workforce and payroll — one operational ledger"
          user={user}
          previewClientId={previewClientId}
          register={register}
          themeMode={themeMode}
          leading={
            <MobileNav variant="internal" user={user} register={register} />
          }
        />

        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
