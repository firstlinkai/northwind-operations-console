"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { THEME_COOKIE, isThemeMode, type ThemeMode } from "@/lib/theme/theme";

/**
 * Persist the theme preference.
 *
 * Not httpOnly: this is a display preference, not a credential, and leaving it
 * readable lets any future client-side code (or a print stylesheet) see the
 * same value the server used. One year, because nobody wants to re-pick their
 * theme every week.
 *
 * `revalidatePath("/", "layout")` re-renders the server layouts so the new
 * register is applied everywhere in one pass — including portalled UI, which
 * takes its register as a prop from the layout.
 */
export async function setThemeMode(mode: ThemeMode): Promise<void> {
  if (!isThemeMode(mode)) return;

  const store = await cookies();
  store.set(THEME_COOKIE, mode, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
}
