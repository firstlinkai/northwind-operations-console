import { NextResponse, type NextRequest } from "next/server";

/**
 * ============================================================================
 * EDGE GUARD — cookie presence only
 * ============================================================================
 *
 * DIVISION OF RESPONSIBILITY (read this before adding a role check here)
 *
 *   middleware  ->  "is there a session at all?"
 *   layouts     ->  "is THIS session allowed on THIS route?"
 *
 * Middleware runs at the edge, before the app's module graph is available. It
 * cannot see the persona table: `lib/auth/personas.ts` pulls in
 * `lib/data/dataset.ts` (60 profiles x 90 days of generated rows) and
 * `lib/auth/session.ts` is marked `server-only` and reads `next/headers`.
 * Dragging any of that into the edge bundle would be slow, fragile, and — worse
 * — would create a SECOND place where access decisions are made, which is
 * exactly how those two places drift apart and a tenant leak appears.
 *
 * So the authoritative checks stay where the data is:
 *   - `requireInternal()`      in app/dashboard/admin/layout.tsx  (-> /unauthorized)
 *   - `requireClientScope()`   in app/dashboard/client/layout.tsx (-> /unauthorized)
 *
 * All this file does is spare a signed-out visitor a pointless render before
 * being bounced to /login. It is an optimisation, never a security boundary.
 *
 * This uses the Next 16 `proxy.ts` file convention (formerly `middleware.ts`).
 */

/**
 * Mirrors `SESSION_COOKIE` from `lib/auth/session.ts`. Copied rather than
 * imported precisely because that module is `server-only` and must not be
 * pulled into the edge bundle. If the cookie name changes, change both.
 */
const SESSION_COOKIE = "northwinds_session";

export function proxy(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
