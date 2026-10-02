import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { format, parseISO } from "date-fns";

import { LoginForm } from "@/components/shell/login-form";
import type { PersonaOption } from "@/components/shell/persona-switcher";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { PERSONAS, canAccessInternal } from "@/lib/auth/personas";
import { getSessionUser } from "@/lib/auth/session";
import { CLIENTS, REFERENCE_DATE } from "@/lib/constants";
import { getThemeMode } from "@/lib/theme/session";
import { resolveRegister } from "@/lib/theme/theme";
// Server Component, so reaching into the `server-only` dataset for a real
// roster figure is safe — nothing here crosses into the client bundle.
import { DATASET_META } from "@/lib/data/dataset";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to the NorthWinds International operations console.",
};

const POSITIONING =
  "One console for the money, the people and the service levels — reconciled every morning, in Manila and on the client's desk.";

/**
 * The brand mark: a rhombus aperture around a four-point star ("northwinds").
 * Inline SVG on `currentColor` so it inherits whichever register it sits in —
 * no raster asset, no emoji, no second copy to keep in sync with the palette.
 * Declared here rather than imported so the login page ships no extra JS.
 */
function NorthWindsMark({ className }: { className?: string }) {
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

export default async function LoginPage() {
  // Already signed in? Send them where they belong rather than showing a form.
  const user = await getSessionUser();
  if (user) {
    redirect(canAccessInternal(user.role) ? "/dashboard/admin" : "/dashboard/client");
  }

  const personas: PersonaOption[] = PERSONAS.map((p) => ({
    id: p.id,
    full_name: p.full_name,
    email: p.email,
    role: p.role,
    scope: p.scope,
    client_name: p.client_name,
  }));

  const stats: Array<{ label: string; value: string; unit?: string }> = [
    { label: "Specialists on seat", value: String(DATASET_META.active_headcount) },
    { label: "Healthcare accounts", value: String(CLIENTS.length) },
    { label: "Coverage", value: "24/7", unit: "day · mid · night" },
  ];

  // Sign-in has no designed register of its own, so it follows the visitor's
  // choice and falls back to light. The brand panel opposite stays dark either
  // way — it is artwork, not chrome.
  const themeMode = await getThemeMode();
  const register = resolveRegister(themeMode, "light");

  return (
    <div
      className={`${register === "dark" ? "dark" : ""} flex min-h-svh w-full flex-1 flex-col bg-background text-foreground lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)]`}
    >
      {/* ------------------------------------------------------ sign-in side */}
      <div className="flex flex-1 flex-col px-6 py-8 sm:px-10 lg:px-14 lg:py-10">
        <header className="flex items-center justify-between gap-2.5">
          <span className="flex items-center gap-2.5">
            <NorthWindsMark className="size-7 shrink-0 text-primary" />
            <span className="flex flex-col leading-none">
              <span className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
                NorthWinds
              </span>
              <span className="label-eyebrow mt-1 text-[0.5625rem]">
                International
              </span>
            </span>
          </span>

          <ThemeToggle mode={themeMode} />
        </header>

        <div className="flex flex-1 items-center py-10">
          <div className="mx-auto w-full max-w-[26rem] lg:mx-0">
            <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
              Choose a role to explore
            </h1>
            <p className="caption mt-2">
              A demonstration build of an operations console for a healthcare
              BPO, running on generated data. Pick a role below — access is
              scoped on the server for every request, so each one genuinely sees
              a different system.
            </p>

            <div className="mt-7">
              <LoginForm personas={personas} />
            </div>
          </div>
        </div>

        <footer className="caption">
          © 2026 NorthWinds International · Manila, Philippines
        </footer>
      </div>

      {/* ------------------------------------------------------- brand panel */}
      {/* `dark` here paints the panel in the command-centre register from the
          same token set the CEO console uses — no bespoke colours. */}
      <aside className="dark relative hidden flex-col justify-between border-l border-border bg-surface-sunken px-12 py-10 text-foreground lg:flex">
        <div className="flex items-center gap-3">
          <NorthWindsMark className="size-9 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold tracking-[0.14em] uppercase">
              NorthWinds International
            </p>
            <p className="label-eyebrow mt-1">
              Healthcare BPO · Manila, Philippines
            </p>
          </div>
        </div>

        <p className="max-w-md text-[1.6875rem] leading-[1.28] font-medium tracking-[-0.02em] text-balance">
          {POSITIONING}
        </p>

        <div>
          <dl className="border-t border-border">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="flex items-baseline justify-between gap-6 border-b border-border py-3.5"
              >
                <dt className="label-eyebrow">{stat.label}</dt>
                <dd className="metric-lg">
                  {stat.value}
                  {stat.unit && (
                    <span className="ml-2 text-xs font-normal tracking-normal text-muted-foreground">
                      {stat.unit}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <p className="caption tabular mt-3">
            Demo dataset · deterministic as of{" "}
            {format(parseISO(REFERENCE_DATE), "d MMM yyyy")}
          </p>
        </div>
      </aside>
    </div>
  );
}
