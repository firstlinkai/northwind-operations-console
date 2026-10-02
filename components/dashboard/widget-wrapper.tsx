"use client";

/**
 * WidgetWrapper (PRD §11.2)
 *
 * Wraps every high-frequency data panel in an error boundary. The point is
 * blast radius: if the cash-flow panel throws, the CEO still sees their KPIs,
 * their heatmap and their SLAs. One broken integration must never take the
 * whole console down mid-demo.
 *
 * React has no built-in function-component error boundary, so this is one of
 * the few places a class component is still required.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/dashboard/panel";

interface Props {
  children: ReactNode;
  /** Shown in the fallback header so the user knows what failed. */
  title: string;
  fallbackDescription?: string;
}

interface State {
  hasError: boolean;
  message: string | null;
}

export class WidgetErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // In production this would go to the error reporter.
    console.error(`[Widget] "${this.props.title}" failed to render`, error, info);
  }

  private reset = (): void => {
    this.setState({ hasError: false, message: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <Panel className="border-critical/30">
        <PanelHeader
          title={
            <span className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-critical" aria-hidden />
              {this.props.title}
            </span>
          }
          description="This panel could not be displayed."
          action={
            <Button variant="outline" size="sm" onClick={this.reset}>
              <RotateCw className="size-3.5" aria-hidden />
              Retry
            </Button>
          }
        />
        <PanelBody>
          <p className="caption">
            {this.props.fallbackDescription ??
              "The rest of the dashboard is unaffected. If this persists, check the upstream integration."}
          </p>
          {this.state.message && (
            <p className="mt-2 font-mono text-[0.6875rem] text-muted-foreground/80">
              {this.state.message}
            </p>
          )}
        </PanelBody>
      </Panel>
    );
  }
}
