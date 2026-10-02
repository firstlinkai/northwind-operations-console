"use client";

/**
 * APP SIDEBAR
 * ---------------------------------------------------------------------------
 * Fixed 240px rail on >=lg, a `Sheet` drawer below that. Both render the exact
 * same body so the two breakpoints can never drift.
 *
 * NAVIGATION MODEL
 * The PRD puts the whole CEO console on `/dashboard/admin/page.tsx` and the
 * whole portal on `/dashboard/client/page.tsx` (§5, §6), so most section links
 * are in-page anchors rather than sub-routes. That is also the safer default
 * mid-build: an anchor whose target does not exist yet is a silent no-op,
 * whereas a link to a route that does not exist is a 404 in the middle of a
 * live demo. Where a real sub-route does exist (`/dashboard/admin/payroll`) the
 * link points at it. Active state combines `usePathname()` with the current
 * hash so exactly one item is ever marked `aria-current`.
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Building2,
  Eye,
  Gauge,
  LogOut,
  Menu,
  Receipt,
  Upload,
  Users,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { signOut } from "@/lib/auth/actions";
import type { SessionUser, UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ROLE_LABEL, initialsOf, type Register } from "@/components/shell/persona-switcher";

export type ShellVariant = "internal" | "client";

type IconType = React.ComponentType<React.SVGProps<SVGSVGElement>>;

interface NavItem {
  label: string;
  href: string;
  icon: IconType;
  /** When set, only these roles see the item. Mirrors the route's own guard. */
  roles?: readonly UserRole[];
}

/**
 * Section hashes match the widget ids in `lib/store/use-dashboard-store.ts`
 * (`cashflow-chart`, `live-heatmap`, `dept-tabs`), which is what
 * `DashboardGrid` keys its `<section>` elements on — so the links land on the
 * right panel as soon as that section carries `id={w.id}`.
 *
 * `Payroll Import` and `Client Preview` are real routes and are filtered by
 * role here to match the guards those routes already run server-side: showing
 * a link that only leads to /unauthorized is a worse experience than not
 * showing it, and the server check remains the actual control.
 */
const INTERNAL_NAV: readonly NavItem[] = [
  { label: "Overview", href: "/dashboard/admin", icon: Gauge },
  { label: "Financials", href: "/dashboard/admin#cashflow-chart", icon: Wallet },
  { label: "Workforce", href: "/dashboard/admin#live-heatmap", icon: Users },
  { label: "Departments", href: "/dashboard/admin#dept-tabs", icon: Building2 },
  {
    label: "Payroll Import",
    href: "/dashboard/admin/payroll",
    icon: Upload,
    roles: ["ceo_admin", "hr_admin"],
  },
  {
    label: "Client Preview",
    href: "/dashboard/client",
    icon: Eye,
    roles: ["ceo_admin"],
  },
] as const;

const CLIENT_NAV: readonly NavItem[] = [
  { label: "Overview", href: "/dashboard/client", icon: Gauge },
  { label: "My Team", href: "/dashboard/client#team", icon: Users },
  { label: "SLA Performance", href: "/dashboard/client#sla", icon: Activity },
  { label: "Invoices", href: "/dashboard/client#invoices", icon: Receipt },
] as const;

/** Splits `/dashboard/admin#financials` into `["/dashboard/admin", "#financials"]`. */
function splitHref(href: string): [path: string, hash: string] {
  const i = href.indexOf("#");
  return i === -1 ? [href, ""] : [href.slice(0, i), href.slice(i)];
}

/**
 * Tracks `window.location.hash` so anchor nav can drive the active state.
 *
 * `useSyncExternalStore` rather than state+effect: it gives a stable ""
 * snapshot during SSR and reads the real value on the client without a
 * cascading render. The extra custom event exists because the Next router
 * mutates history via `pushState` when a link drops the fragment (e.g.
 * `#financials` -> Overview), and `pushState` does not fire `hashchange`.
 */
const HASH_SYNC_EVENT = "northwinds:hashsync";

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  window.addEventListener(HASH_SYNC_EVENT, onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(HASH_SYNC_EVENT, onChange);
  };
}

function useLocationHash(): string {
  return React.useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => ""
  );
}

/** Re-read the hash once the router has settled after a nav click. */
function nudgeHashSync(): void {
  window.setTimeout(() => {
    window.dispatchEvent(new Event(HASH_SYNC_EVENT));
  }, 0);
}

export interface AppSidebarProps {
  variant: ShellVariant;
  user: SessionUser;
  register: Register;
  /** Account name shown under the wordmark in the client portal. */
  clientName?: string | null;
}

/* -------------------------------------------------------------------------- */

export function NorthWindsMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      role="img"
      aria-label="NorthWinds International"
    >
      <path
        d="M12 1.9 22.1 12 12 22.1 1.9 12Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        opacity="0.34"
      />
      <path
        d="M12 4.9q.95 6.15 7.1 7.1-6.15.95-7.1 7.1-.95-6.15-7.1-7.1 6.15-.95 7.1-7.1Z"
        fill="currentColor"
      />
    </svg>
  );
}

function Wordmark({
  variant,
  clientName,
  onNavigate,
}: {
  variant: ShellVariant;
  clientName?: string | null;
  onNavigate?: () => void;
}) {
  const home = variant === "internal" ? "/dashboard/admin" : "/dashboard/client";
  return (
    <div className="px-3 pt-4 pb-3">
      <Link
        href={home}
        onClick={() => {
          nudgeHashSync();
          onNavigate?.();
        }}
        className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <NorthWindsMark className="size-7 shrink-0 text-primary" />
        <span className="flex min-w-0 flex-col leading-none">
          <span className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
            NorthWinds
          </span>
          <span className="label-eyebrow mt-1 text-[0.5625rem]">International</span>
        </span>
      </Link>

      {variant === "client" && clientName && (
        <div className="surface-well mt-3.5 px-2.5 py-2">
          <p className="label-eyebrow">Account</p>
          <p className="mt-0.5 truncate text-xs font-medium">{clientName}</p>
        </div>
      )}
    </div>
  );
}

function SidebarNav({
  variant,
  user,
  onNavigate,
}: {
  variant: ShellVariant;
  user: SessionUser;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const hash = useLocationHash();

  const items = (variant === "internal" ? INTERNAL_NAV : CLIENT_NAV).filter(
    (item) => !item.roles || item.roles.includes(user.role)
  );

  return (
    <nav
      aria-label={variant === "internal" ? "Internal console" : "Client portal"}
      className="flex-1 overflow-y-auto px-3 pb-4"
    >
      <ul className="space-y-0.5">
        {items.map((item) => {
          const [itemPath, itemHash] = splitHref(item.href);
          const active = pathname === itemPath && hash === itemHash;
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => {
                  nudgeHashSync();
                  onNavigate?.();
                }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium",
                  "transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{item.label}</span>
                {active && (
                  <span
                    className="ml-auto h-4 w-0.5 shrink-0 rounded-full bg-primary"
                    aria-hidden
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SidebarUser({ user }: { user: SessionUser }) {
  return (
    <div className="border-t border-sidebar-border p-3">
      <div className="flex items-center gap-2.5">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[0.6875rem] font-semibold text-muted-foreground"
          aria-hidden
        >
          {initialsOf(user.full_name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{user.full_name}</p>
          <p className="truncate text-[0.6875rem] text-muted-foreground">
            {user.client_name ?? ROLE_LABEL[user.role]}
          </p>
        </div>
        <form action={signOut}>
          <Button
            type="submit"
            variant="ghost"
            size="icon-sm"
            aria-label={`Sign out ${user.full_name}`}
          >
            <LogOut />
          </Button>
        </form>
      </div>
    </div>
  );
}

function SidebarBody({
  variant,
  user,
  clientName,
  onNavigate,
}: AppSidebarProps & { onNavigate?: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Wordmark variant={variant} clientName={clientName} onNavigate={onNavigate} />
      <SidebarNav variant={variant} user={user} onNavigate={onNavigate} />
      <SidebarUser user={user} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Desktop rail. Hidden below `lg`; pair with `lg:pl-60` on the content column. */
export function AppSidebar(props: AppSidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:block">
      <SidebarBody {...props} />
    </aside>
  );
}

/**
 * Mobile/tablet drawer. Rendered into the top bar's leading slot.
 * The popup is portalled outside the `.dark` wrapper, so the register class is
 * re-applied here — same reasoning as the persona switcher.
 */
export function MobileNav(props: AppSidebarProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open navigation"
            className="lg:hidden"
          />
        }
      >
        <Menu />
      </SheetTrigger>
      <SheetContent
        side="left"
        showCloseButton={false}
        className={cn(
          props.register === "dark" && "dark",
          "w-[17rem] gap-0 border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground sm:max-w-[17rem]"
        )}
      >
        <SheetTitle className="sr-only">NorthWinds navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Primary navigation for the NorthWinds operations console.
        </SheetDescription>
        <SidebarBody {...props} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
