/**
 * Data provenance markers.
 *
 * Some figures on this dashboard are modelled rather than sourced from a live
 * system of record — HR attrition in particular, because no HRIS feed exists
 * yet. Showing an invented number to a CEO without saying so is how a
 * dashboard loses its credibility permanently, so panels carrying modelled
 * data must render one of these.
 */

import { FlaskConical, Info, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FxRate } from "@/lib/types";

/** Marks a panel whose numbers are modelled, not measured. */
export function SampleDataBadge({
  detail = "No HRIS feed is connected yet. These figures are modelled from the staff roster and are for demonstration only.",
  className,
}: {
  detail?: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        className={cn("pill pill-warning cursor-help", className)}
      >
        <FlaskConical className="size-3" aria-hidden />
        Sample data
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{detail}</TooltipContent>
    </Tooltip>
  );
}

/** Shown when an integration is serving cached or fallback values. */
export function DegradedBadge({
  service,
  className,
}: {
  service: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        className={cn("pill pill-warning cursor-help", className)}
      >
        <WifiOff className="size-3" aria-hidden />
        Cached
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {service} could not be reached. Showing the last known values so the
        dashboard keeps working.
      </TooltipContent>
    </Tooltip>
  );
}

/** FX provenance — the rate is live, so say when it is not. */
export function FxNote({ fx, className }: { fx: FxRate; className?: string }) {
  const label = fx.is_stale
    ? `₱${fx.rate.toFixed(2)} · cached`
    : `₱${fx.rate.toFixed(2)} · live`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        className={cn(
          "inline-flex cursor-help items-center gap-1 text-[0.6875rem] tabular",
          fx.is_stale ? "text-warning" : "text-muted-foreground",
          className
        )}
      >
        <Info className="size-3" aria-hidden />
        USD/PHP {label}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {fx.is_stale
          ? `Live FX unavailable — using the ${fx.source} rate published ${fx.as_of}.`
          : `European Central Bank reference rate published ${fx.as_of}.`}
      </TooltipContent>
    </Tooltip>
  );
}
