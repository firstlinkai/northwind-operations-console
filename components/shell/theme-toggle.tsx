"use client";

/**
 * Theme control — a three-segment switch rather than a dropdown.
 *
 * At three options, a segmented control shows every state at once and takes
 * one click; a dropdown would hide the current value behind a menu and take
 * two. It also makes "Auto" discoverable, which matters because Auto is the
 * default and explains why the console and the portal look different.
 *
 * The mode is persisted server-side (see lib/theme/actions.ts), so the change
 * survives reload and renders correctly on first paint with no flash.
 */

import { useOptimistic, useTransition } from "react";
import { Moon, Sun, SunMoon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setThemeMode } from "@/lib/theme/actions";
import {
  THEME_DESCRIPTION,
  THEME_LABEL,
  THEME_MODES,
  type ThemeMode,
} from "@/lib/theme/theme";

const ICON: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  auto: SunMoon,
  dark: Moon,
};

export function ThemeToggle({
  mode,
  className,
}: {
  mode: ThemeMode;
  className?: string;
}) {
  const [isPending, startTransition] = useTransition();

  // The server action round-trips before the layout re-renders. Optimistic
  // state moves the selected segment immediately so the control never feels
  // laggy, even though the actual repaint waits for the server.
  const [optimisticMode, setOptimisticMode] = useOptimistic(mode);

  const choose = (next: ThemeMode) => {
    if (next === optimisticMode) return;
    startTransition(async () => {
      setOptimisticMode(next);
      await setThemeMode(next);
    });
  };

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      aria-busy={isPending || undefined}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-sunken p-0.5",
        className
      )}
    >
      {THEME_MODES.map((m) => {
        const Icon = ICON[m];
        const active = m === optimisticMode;

        return (
          <Tooltip key={m}>
            <TooltipTrigger
              render={<button type="button" />}
              role="radio"
              aria-checked={active}
              aria-label={`${THEME_LABEL[m]} theme`}
              onClick={() => choose(m)}
              className={cn(
                "flex size-7 items-center justify-center rounded-full transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" aria-hidden />
            </TooltipTrigger>
            <TooltipContent>
              <span className="font-medium">{THEME_LABEL[m]}</span>
              <span className="opacity-70"> · {THEME_DESCRIPTION[m]}</span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
