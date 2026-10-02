/**
 * ============================================================================
 * SESSION — server-side
 * ============================================================================
 * Reads the demo session from an httpOnly cookie. Shaped so that swapping in
 * Supabase Auth later means rewriting only `getSessionUser()`; every caller
 * (`requireInternal`, `requireClientScope`, API routes, layouts) keeps working
 * unchanged because they all consume the `SessionUser` contract.
 *
 * The CEO-preview path deserves a note: a `ceo_admin` may view the client
 * portal for demo purposes, but does so through an EXPLICIT impersonation
 * cookie that names the tenant. There is no code path where a role check is
 * simply skipped — impersonation resolves to a concrete `client_id` and every
 * downstream query is scoped to it exactly as a real client's would be.
 */

import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  DEFAULT_PERSONA_ID,
  canAccessClientPortal,
  canAccessInternal,
  personaById,
  toSessionUser,
} from "@/lib/auth/personas";
import { clients } from "@/lib/data/dataset";
import type { SessionUser, UUID } from "@/lib/types";

export const SESSION_COOKIE = "northwinds_session";
/** Set only when a CEO is previewing a specific client's portal. */
export const IMPERSONATION_COOKIE = "northwinds_preview_client";

/**
 * The current session, or null when signed out.
 * Safe to call from Server Components, route handlers and server actions.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const personaId = store.get(SESSION_COOKIE)?.value;
  if (!personaId) return null;

  const persona = personaById(personaId);
  if (!persona) return null;

  return toSessionUser(persona);
}

/** Session or a redirect to the login screen. Use in protected layouts. */
export async function requireSession(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Guard for `/dashboard/admin`.
 * PRD §12.2 TC-03: a client_user navigating here must land on /unauthorized.
 */
export async function requireInternal(): Promise<SessionUser> {
  const user = await requireSession();
  if (!canAccessInternal(user.role)) redirect("/unauthorized");
  return user;
}

/**
 * Guard for `/dashboard/client`. Returns the session together with the tenant
 * whose data may be read.
 *
 * Every client-portal query MUST take its `client_id` from this function's
 * return value and never from a route param, search param or request body.
 * That is the single rule that makes tenant isolation hold: the tenant is
 * derived from the session, so it cannot be tampered with by the caller.
 */
export async function requireClientScope(): Promise<{
  user: SessionUser;
  clientId: UUID;
  isPreview: boolean;
}> {
  const user = await requireSession();

  if (!canAccessClientPortal(user.role)) redirect("/unauthorized");

  if (user.role === "client_user") {
    // A client_user without a tenant is a broken account, not a wildcard.
    if (!user.client_id) redirect("/unauthorized");
    return { user, clientId: user.client_id, isPreview: false };
  }

  // ceo_admin previewing a tenant during a demo.
  const store = await cookies();
  const previewId = store.get(IMPERSONATION_COOKIE)?.value;
  const target = clients.find((c) => c.id === previewId) ?? clients[0];
  if (!target) redirect("/unauthorized");

  return { user, clientId: target.id, isPreview: true };
}

/** Which tenant, if any, the CEO is currently previewing. */
export async function getPreviewClientId(): Promise<UUID | null> {
  const store = await cookies();
  const id = store.get(IMPERSONATION_COOKIE)?.value;
  if (!id) return null;
  return clients.some((c) => c.id === id) ? id : null;
}

export { DEFAULT_PERSONA_ID };
