/**
 * ============================================================================
 * THEME PREFERENCE
 * ============================================================================
 * NorthWinds ships two visual registers from one token set (see docs/DESIGN.md):
 * the internal console is dark, the client portal is light. That is a design
 * decision, not an accident — so the theme control has three states rather
 * than a simple on/off:
 *
 *   auto  (default)  each area uses its designed register
 *   light            force paper-light everywhere
 *   dark             force deep-ink everywhere
 *
 * A plain two-state toggle would have to fight the per-area default and would
 * leave a user who picked "light" wondering why the console was still dark.
 *
 * WHY A COOKIE, NOT localStorage
 * The preference is read on the SERVER, in the layout, before any HTML is
 * sent. That means:
 *   - no flash of the wrong register on first paint,
 *   - no hydration mismatch (the server already knows the answer),
 *   - no `suppressHydrationWarning` hack or blocking inline script.
 * localStorage is unavailable during SSR, which is exactly why the usual
 * client-side theme switcher flashes.
 */

export type ThemeMode = "light" | "dark" | "auto";

/** A concrete register — what actually gets applied to the DOM. */
export type ThemeRegister = "light" | "dark";

export const THEME_COOKIE = "northwinds_theme";

export const THEME_MODES: readonly ThemeMode[] = ["light", "auto", "dark"] as const;

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "auto";
}

/**
 * Resolve the register to render.
 * `routeDefault` is the area's designed register — dark for the internal
 * console, light for the client portal. It applies only under `auto`.
 */
export function resolveRegister(
  mode: ThemeMode,
  routeDefault: ThemeRegister
): ThemeRegister {
  return mode === "auto" ? routeDefault : mode;
}

/** Human labels for the control. */
export const THEME_LABEL: Record<ThemeMode, string> = {
  light: "Light",
  auto: "Auto",
  dark: "Dark",
};

export const THEME_DESCRIPTION: Record<ThemeMode, string> = {
  light: "Always paper-light.",
  auto: "Dark console, light client portal — as designed.",
  dark: "Always deep-ink.",
};
