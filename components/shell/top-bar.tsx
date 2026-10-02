/**
 * TOP BAR
 * ---------------------------------------------------------------------------
 * Slim sticky header shared by both registers: page title, the reference-date
 * note, and the persona switcher.
 *
 * This is a Server Component on purpose: it maps the persona table down to a
 * small serialisable projection before handing it to the (client) persona
 * switcher. Shared values come from `@/lib/constants`, the leaf module — never
 * from `lib/data/dataset`, which is `server-only`.
 */

import { format, parseISO } from "date-fns";

import { Separator } from "@/components/ui/separator";
import {
  PersonaSwitcher,
  type ClientOption,
  type PersonaOption,
  type Register,
} from "@/components/shell/persona-switcher";
import {
  canAccessInternal,
  clientPersonas,
  internalPersonas,
  type Persona,
} from "@/lib/auth/personas";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { CLIENTS, REFERENCE_DATE } from "@/lib/constants";
import type { ThemeMode } from "@/lib/theme/theme";
import type { SessionUser } from "@/lib/types";

/** "28 Jul 2026" — the frozen clock the whole dataset is generated against. */
const REFERENCE_LABEL = format(parseISO(REFERENCE_DATE), "d MMM yyyy");

const toOption = (p: Persona): PersonaOption => ({
  id: p.id,
  full_name: p.full_name,
  email: p.email,
  role: p.role,
  scope: p.scope,
  client_name: p.client_name,
});

const CLIENT_OPTIONS: ClientOption[] = CLIENTS.map((c) => ({
  id: c.id,
  name: c.name,
  code: c.code,
}));

export interface TopBarProps {
  title: string;
  description?: string;
  /** Slot for the mobile nav trigger. */
  leading?: React.ReactNode;
  user: SessionUser;
  previewClientId?: string | null;
  register: Register;
  /** The visitor's stored preference — drives the theme control's state. */
  themeMode: ThemeMode;
}

export function TopBar({
  title,
  description,
  leading,
  user,
  previewClientId = null,
  register,
  themeMode,
}: TopBarProps) {
  const isInternal = canAccessInternal(user.role);

  return (
    <header
      aria-label={title}
      className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-sm supports-[backdrop-filter]:bg-background/70 sm:px-6"
    >
      {leading}

      <div className="min-w-0 flex-1">
        {/* Not an <h1>: each page owns its own document heading, and two would
            leave the outline ambiguous for screen readers. */}
        <p className="truncate text-sm font-semibold tracking-[-0.005em]">
          {title}
        </p>
        {description && <p className="caption truncate">{description}</p>}
      </div>

      <p className="caption tabular hidden shrink-0 md:block">
        Data as of {REFERENCE_LABEL}
      </p>
      <Separator
        orientation="vertical"
        className="hidden h-6 self-center md:block"
      />

      <ThemeToggle mode={themeMode} className="hidden sm:inline-flex" />

      {/*
        TENANT ISOLATION — do not remove these guards.

        The persona switcher is a demo affordance. Handing it the full persona
        table unconditionally rendered every client's name into every client's
        page: Karen at Alder Bay could read that Kestrel, Northlake and Ironwood
        Health are also NorthWinds customers. For a healthcare BPO that is a
        confidentiality breach — the customer list is commercially sensitive,
        and the leak is invisible because it sits in a closed dropdown.

        A client_user therefore receives EMPTY lists and sees only their own
        identity and sign-out. Only a ceo_admin gets the preview submenu.
      */}
      <PersonaSwitcher
        user={user}
        internal={isInternal ? internalPersonas.map(toOption) : []}
        clientPortals={isInternal ? clientPersonas.map(toOption) : []}
        previewClients={user.role === "ceo_admin" ? CLIENT_OPTIONS : []}
        previewClientId={previewClientId}
        register={register}
      />
    </header>
  );
}
