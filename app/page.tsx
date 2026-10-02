import { redirect } from "next/navigation";

import { canAccessInternal } from "@/lib/auth/personas";
import { getSessionUser } from "@/lib/auth/session";

/**
 * Root route. There is no marketing surface here — the app is an internal
 * console, so `/` is purely a router: internal roles land on the CEO command
 * centre, `client_user` lands on their own portal, everyone else signs in.
 */
export default async function RootPage() {
  const user = await getSessionUser();

  if (!user) redirect("/login");

  redirect(canAccessInternal(user.role) ? "/dashboard/admin" : "/dashboard/client");
}
