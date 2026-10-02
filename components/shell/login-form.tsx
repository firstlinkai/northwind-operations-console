"use client";

/**
 * LOGIN FORM
 * ---------------------------------------------------------------------------
 * Role picker, not a credential form.
 *
 * This is a public demonstration build running entirely on generated data, so
 * there is no account to protect and nothing is gained by asking for a password
 * that would then have to be printed on the same screen. Publishing a login
 * form beside its own password teaches visitors nothing and looks careless, so
 * the form is gone and the roles are the entry point.
 *
 * The isolation being demonstrated is unaffected: each button signs in as a
 * specific role and tenant, and every boundary is still enforced on the server
 * (see `lib/auth/session.ts`). Real authentication replaces this wholesale when
 * the system is connected to a live database.
 *
 * Each row is its own `<form action={switchPersona.bind(...)}>` rather than an
 * onClick handler: real submit buttons work with the keyboard, work before
 * hydration, and avoid nesting forms (which HTML forbids).
 */

import { ArrowRight } from "lucide-react";

import { switchPersona } from "@/lib/auth/actions";
import {
  ROLE_LABEL,
  initialsOf,
  type PersonaOption,
} from "@/components/shell/persona-switcher";

export function LoginForm({ personas }: { personas: PersonaOption[] }) {
  const internal = personas.filter((p) => p.role !== "client_user");
  const clients = personas.filter((p) => p.role === "client_user");

  return (
    <div className="space-y-7">
      <PersonaGroup
        id="internal-roles"
        heading="Internal roles"
        caption="Each role sees a different slice of the business."
        personas={internal}
      />

      <PersonaGroup
        id="client-portals"
        heading="Client portals"
        caption="Each account sees only its own team, service levels and invoices."
        personas={clients}
      />
    </div>
  );
}

function PersonaGroup({
  id,
  heading,
  caption,
  personas,
}: {
  id: string;
  heading: string;
  caption: string;
  personas: PersonaOption[];
}) {
  if (personas.length === 0) return null;

  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className="flex items-center gap-3">
        <h2 id={`${id}-heading`} className="label-eyebrow shrink-0">
          {heading}
        </h2>
        <span className="rule flex-1" aria-hidden />
      </div>
      <p className="caption mt-1.5">{caption}</p>

      <ul className="mt-3 space-y-1.5">
        {personas.map((persona) => (
          <li key={persona.id}>
            <form action={switchPersona.bind(null, persona.id)}>
              <button
                type="submit"
                className="group flex w-full items-start gap-2.5 rounded-md border border-border/70 bg-card px-3 py-2 text-left transition-colors outline-none hover:border-border hover:bg-surface-sunken focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[0.625rem] font-semibold text-muted-foreground"
                  aria-hidden
                >
                  {initialsOf(persona.full_name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs font-medium">{persona.full_name}</span>
                    <span className="text-[0.6875rem] text-muted-foreground">
                      {ROLE_LABEL[persona.role]}
                      {persona.client_name ? ` · ${persona.client_name}` : ""}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[0.6875rem] leading-snug text-muted-foreground">
                    {persona.scope}
                  </span>
                </span>
                <ArrowRight
                  className="mt-1 size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground"
                  aria-hidden
                />
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
