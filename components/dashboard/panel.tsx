/**
 * Panel — the standard container for every dashboard module.
 *
 * Using one wrapper everywhere is what makes a dense dashboard feel designed
 * rather than assembled: identical header rhythm, identical padding, identical
 * border weight, no matter which agent or which page built the contents.
 */

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export function Panel({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <Card
      className={cn(
        "gap-0 overflow-hidden rounded-lg border-border/80 py-0 shadow-none",
        padded && "p-0",
        className
      )}
    >
      {children}
    </Card>
  );
}

export function PanelHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-border/80 px-5 py-3.5",
        className
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <h3 className="panel-title truncate">{title}</h3>
        {description && <p className="caption">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PanelBody({
  children,
  className,
  flush = false,
}: {
  children: React.ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return <div className={cn(!flush && "px-5 py-4", className)}>{children}</div>;
}

export function PanelFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-t border-border/80 bg-surface-sunken/50 px-5 py-2.5",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Consistent empty state so no panel ever renders a blank rectangle. */
export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-muted-foreground/60">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="caption max-w-sm">{description}</p>}
    </div>
  );
}
