"use server";

/**
 * Session mutations. Server actions so the persona switcher works without a
 * client-side auth SDK — the cookie is httpOnly and never touched by JS.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  canAccessInternal,
  personaById,
} from "@/lib/auth/personas";
import { IMPERSONATION_COOKIE, SESSION_COOKIE } from "@/lib/auth/session";
import { clients } from "@/lib/data/dataset";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  // 8 hours — a working shift.
  maxAge: 60 * 60 * 8,
} as const;

/** Landing route for a given role. */
function homeFor(personaId: string): string {
  const persona = personaById(personaId);
  if (!persona) return "/login";
  return canAccessInternal(persona.role) ? "/dashboard/admin" : "/dashboard/client";
}

/**
 * Sign in as a role.
 *
 * There is deliberately no credential check. This is a public demonstration
 * build on generated data: there is no account to protect, and a password form
 * whose password had to be printed on the same page would be theatre rather
 * than security. Authentication is one of the items replaced wholesale when the
 * system is connected to a real database — see the README.
 *
 * What this does NOT skip is authorisation. The persona resolves to a concrete
 * role and tenant, and every guard in `lib/auth/session.ts` and every query in
 * `lib/data/queries.ts` enforces the boundary server-side exactly as it would
 * for a real session.
 */
export async function switchPersona(personaId: string): Promise<void> {
  const persona = personaById(personaId);
  if (!persona) return;

  const store = await cookies();
  store.set(SESSION_COOKIE, persona.id, COOKIE_OPTS);
  store.delete(IMPERSONATION_COOKIE);

  redirect(homeFor(persona.id));
}

/**
 * CEO previews a client's portal. Rejected for anyone who is not an internal
 * admin — a client_user must never be able to set this and pivot to another
 * tenant. The cookie only ever holds a known client id.
 */
export async function previewClientPortal(clientId: string): Promise<void> {
  const store = await cookies();
  const personaId = store.get(SESSION_COOKIE)?.value;
  const persona = personaId ? personaById(personaId) : undefined;

  if (!persona || persona.role !== "ceo_admin") redirect("/unauthorized");
  if (!clients.some((c) => c.id === clientId)) return;

  store.set(IMPERSONATION_COOKIE, clientId, COOKIE_OPTS);
  redirect("/dashboard/client");
}

export async function exitPreview(): Promise<void> {
  const store = await cookies();
  store.delete(IMPERSONATION_COOKIE);
  redirect("/dashboard/admin");
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(IMPERSONATION_COOKIE);
  redirect("/login");
}
