"use client";

/**
 * PERSONA SWITCHER
 * ---------------------------------------------------------------------------
 * The demo's tenant-pivot control. Lives in the top bar of both registers.
 *
 * Two deliberate decisions:
 *
 * 1. It receives its persona/client lists as PROPS rather than importing
 *    `@/lib/auth/personas` directly. That module pulls in `lib/data/dataset`,
 *    which builds ~60 profiles x 90 days of logs at module scope — fine on the
 *    server, unacceptable in a client bundle. The server components that render
 *    this pass down the small, serialisable projections below.
 *
 * 2. It takes an explicit `register` prop. The menu popup is rendered through a
 *    portal to <body>, i.e. OUTSIDE the `.dark` wrapper on the admin layout, so
 *    it would otherwise render in light tokens on a dark console. Re-applying
 *    the class on the popup keeps one token set producing two registers.
 */

import * as React from "react";
import { Check, ChevronsUpDown, Eye, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { previewClientPortal, signOut, switchPersona } from "@/lib/auth/actions";
import type { SessionUser, UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Which token register the surrounding subtree is painted in. */
export type Register = "dark" | "light";

/** Serialisable projection of a `Persona`, safe to hand to a client bundle. */
export interface PersonaOption {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  scope: string;
  client_name: string | null;
}

export interface ClientOption {
  id: string;
  name: string;
  code: string;
}

/**
 * Human labels for `UserRole`. Deliberately duplicated in
 * `app/unauthorized/page.tsx` — that file is a Server Component and cannot read
 * a value exported from a `"use client"` module.
 */
export const ROLE_LABEL: Record<UserRole, string> = {
  ceo_admin: "CEO · Admin",
  hr_admin: "HR Director",
  ops_manager: "Operations Manager",
  client_user: "Client portal",
  staff: "Staff",
};

export function initialsOf(name: string): string {
  const parts = name
    .replace(/^(Dr\.?|Mr\.?|Ms\.?|Mrs\.?)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

interface PersonaSwitcherProps {
  user: SessionUser;
  internal: PersonaOption[];
  clientPortals: PersonaOption[];
  /** The four tenants a `ceo_admin` may preview. */
  previewClients: ClientOption[];
  previewClientId: string | null;
  register: Register;
}

export function PersonaSwitcher({
  user,
  internal,
  clientPortals,
  previewClients,
  previewClientId,
  register,
}: PersonaSwitcherProps) {
  const [pending, startTransition] = React.useTransition();
  const isCeo = user.role === "ceo_admin";

  const select = React.useCallback(
    (personaId: string) => {
      startTransition(async () => {
        await switchPersona(personaId);
      });
    },
    [startTransition]
  );

  const preview = React.useCallback(
    (clientId: string) => {
      startTransition(async () => {
        await previewClientPortal(clientId);
      });
    },
    [startTransition]
  );

  const leave = React.useCallback(() => {
    startTransition(async () => {
      await signOut();
    });
  }, [startTransition]);

  const popupClass = cn(
    register === "dark" && "dark",
    "w-[19.5rem] max-w-[calc(100vw-1.5rem)] bg-popover text-popover-foreground"
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="lg"
            aria-label={`Signed in as ${user.full_name}. Switch persona`}
            aria-busy={pending || undefined}
            className="h-10 gap-2 pr-2 pl-2 shadow-none"
          />
        }
      >
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[0.625rem] font-semibold text-muted-foreground"
          aria-hidden
        >
          {initialsOf(user.full_name)}
        </span>
        <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
          <span className="max-w-[10rem] truncate text-xs font-medium">
            {user.full_name}
          </span>
          <span className="max-w-[10rem] truncate text-[0.6875rem] text-muted-foreground">
            {user.client_name ?? ROLE_LABEL[user.role]}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={6} className={popupClass}>
        <div className="px-1.5 py-1.5">
          <p className="label-eyebrow">Signed in as</p>
          <p className="mt-1 truncate text-sm font-medium">{user.full_name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>

        {/*
          Each group renders ONLY when it was actually given entries. A
          client_user is passed empty lists (see the guard in top-bar.tsx), so
          they never see other tenants' names — not even as an empty labelled
          section hinting that other customers exist.
        */}
        {internal.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="label-eyebrow px-1.5 py-1.5">
                Internal
              </DropdownMenuLabel>
              {internal.map((persona) => (
                <PersonaMenuItem
                  key={persona.id}
                  persona={persona}
                  current={persona.id === user.id}
                  onSelect={select}
                />
              ))}
            </DropdownMenuGroup>
          </>
        )}

        {clientPortals.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="label-eyebrow px-1.5 py-1.5">
                Client portals
              </DropdownMenuLabel>
              {clientPortals.map((persona) => (
                <PersonaMenuItem
                  key={persona.id}
                  persona={persona}
                  current={persona.id === user.id}
                  onSelect={select}
                />
              ))}
            </DropdownMenuGroup>
          </>
        )}

        {isCeo && previewClients.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2 px-1.5 py-1.5">
                <Eye className="size-4 text-muted-foreground" />
                <span>Preview client portal</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                className={cn(
                  register === "dark" && "dark",
                  "w-60 bg-popover text-popover-foreground"
                )}
              >
                {previewClients.map((client) => (
                  <DropdownMenuItem
                    key={client.id}
                    onClick={() => preview(client.id)}
                    className="gap-2 px-1.5 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate">{client.name}</span>
                    <span className="pill pill-neutral shrink-0 tabular">
                      {client.code}
                    </span>
                    {previewClientId === client.id && (
                      <Check className="size-3.5 shrink-0 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={leave} className="gap-2 px-1.5 py-1.5">
          <LogOut className="size-4 text-muted-foreground" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PersonaMenuItem({
  persona,
  current,
  onSelect,
}: {
  persona: PersonaOption;
  current: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <DropdownMenuItem
      onClick={() => onSelect(persona.id)}
      className="items-start gap-2.5 px-1.5 py-1.5"
    >
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-semibold",
          current
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        )}
        aria-hidden
      >
        {initialsOf(persona.full_name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm leading-tight font-medium">
            {persona.full_name}
          </span>
          <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
            {persona.client_name ?? ROLE_LABEL[persona.role]}
          </span>
        </span>
        <span className="mt-0.5 block text-[0.6875rem] leading-snug text-muted-foreground">
          {persona.scope}
        </span>
      </span>
      {current && (
        <Check className="mt-1 size-3.5 shrink-0 text-primary" aria-label="Current" />
      )}
    </DropdownMenuItem>
  );
}
