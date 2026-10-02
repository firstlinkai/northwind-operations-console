import "server-only";

import { cookies } from "next/headers";

import { THEME_COOKIE, isThemeMode, type ThemeMode } from "@/lib/theme/theme";

/**
 * The visitor's theme preference, read server-side so the correct register is
 * in the very first byte of HTML. Defaults to `auto` — each area's designed
 * register — when no choice has been made.
 */
export async function getThemeMode(): Promise<ThemeMode> {
  const store = await cookies();
  const raw = store.get(THEME_COOKIE)?.value;
  return isThemeMode(raw) ? raw : "auto";
}
