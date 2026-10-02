"use client";

/**
 * JeonSoft payroll import (PRD §11.2, verification case TC-04).
 *
 * Two things this UI has to get right:
 *
 *  1. Partial success is the normal case. Payroll files come out of JeonSoft
 *     with the odd malformed row, and refusing the whole file because line 7
 *     has a typo would be useless to the person doing the import. Good rows
 *     commit; bad rows are reported with their exact line number.
 *
 *  2. Errors have to be actionable. "Import failed" tells a payroll officer
 *     nothing. Every error names the line, the column and the offending value,
 *     and the list is exportable so they can hand it back to whoever produced
 *     the file.
 */

import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/dashboard/panel";
import { StatRow } from "@/components/dashboard/metric";
import { StatusPill } from "@/components/dashboard/status-badge";
import { formatPhp, formatNumber, pluralize } from "@/lib/utils/format";
import type { PayrollImportResult } from "@/lib/types";

const MAX_BYTES = 5 * 1024 * 1024;

export function PayrollImport() {
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<PayrollImportResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("That file isn't a CSV", {
        description: "Export the payroll register from JeonSoft as CSV and try again.",
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("File is too large", {
        description: "The maximum upload size is 5 MB.",
      });
      return;
    }

    setIsUploading(true);
    setResult(null);

    try {
      const body = new FormData();
      body.append("file", file);

      const res = await fetch("/api/payroll/upload", { method: "POST", body });

      if (res.status === 401) {
        toast.error("Your session has expired", { description: "Sign in again to continue." });
        return;
      }
      if (res.status === 403) {
        toast.error("You don't have permission to import payroll", {
          description: "Only the CEO and HR administrators can run payroll imports.",
        });
        return;
      }

      const payload = (await res.json()) as PayrollImportResult & { error?: string };

      if (!res.ok && res.status !== 207) {
        toast.error("Import failed", {
          description: payload.error ?? "The file could not be read.",
        });
        return;
      }

      setResult(payload);

      if (payload.recordsFailed === 0) {
        toast.success("Payroll synced", {
          description: `${formatNumber(payload.recordsProcessed)} ${pluralize(
            payload.recordsProcessed,
            "record"
          )} imported from ${payload.fileName}.`,
        });
      } else {
        toast.warning("Imported with errors", {
          description: `${formatNumber(payload.recordsProcessed)} of ${formatNumber(
            payload.totalRows
          )} rows imported. ${payload.recordsFailed} could not be processed.`,
        });
      }
    } catch {
      toast.error("Upload failed", {
        description: "The server could not be reached. Check your connection and retry.",
      });
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void upload(file);
    },
    [upload]
  );

  /** Hand the error list back to whoever produced the file. */
  const downloadErrors = useCallback(() => {
    if (!result || result.errors.length === 0) return;
    const header = "line,column,value,message\n";
    const rows = result.errors
      .map((e) =>
        [e.line, e.column ?? "", e.rawValue ?? "", `"${e.message.replace(/"/g, '""')}"`].join(",")
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-import-errors-${result.fileName.replace(/\.csv$/i, "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <Panel>
      <PanelHeader
        title="JeonSoft payroll import"
        description="Upload the semi-monthly payroll register exported from JeonSoft."
        action={
          // Base UI uses `render` rather than Radix's `asChild`.
          <Button
            variant="outline"
            size="sm"
            render={<a href="/samples/jeonsoft-sample.csv" download />}
          >
            <Download className="size-3.5" aria-hidden />
            Sample file
          </Button>
        }
      />

      <PanelBody className="space-y-4">
        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={[
            "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-10 transition-colors",
            isDragging ? "border-primary bg-accent/40" : "border-border bg-surface-sunken/50",
          ].join(" ")}
        >
          <FileSpreadsheet className="size-7 text-muted-foreground/70" aria-hidden />
          <div className="text-center">
            <p className="text-sm font-medium">Drop the payroll CSV here</p>
            <p className="caption mt-0.5">CSV up to 5 MB · semi-monthly register</p>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            id="payroll-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            type="button"
            size="sm"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
          >
            {isUploading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Processing…
              </>
            ) : (
              <>
                <Upload className="size-3.5" aria-hidden />
                Choose file
              </>
            )}
          </Button>
        </div>

        {/* Result summary */}
        {result && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {result.recordsFailed === 0 ? (
                <StatusPill tone="positive">
                  <CheckCircle2 className="size-3" aria-hidden />
                  All {formatNumber(result.totalRows)} rows imported
                </StatusPill>
              ) : (
                <StatusPill tone="warning">
                  <AlertTriangle className="size-3" aria-hidden />
                  {formatNumber(result.recordsProcessed)} imported ·{" "}
                  {formatNumber(result.recordsFailed)} rejected
                </StatusPill>
              )}
              <span className="caption">{result.fileName}</span>
            </div>

            <div className="surface-well px-4 py-2">
              <StatRow label="Gross pay" value={formatPhp(result.totals.gross_php)} />
              <StatRow label="Total deductions" value={formatPhp(result.totals.deductions_php)} />
              <StatRow label="Net pay" value={formatPhp(result.totals.net_php)} emphasis />
            </div>

            {result.errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="panel-title">
                    {result.errors.length} {pluralize(result.errors.length, "row")} rejected
                  </h4>
                  <Button variant="ghost" size="sm" onClick={downloadErrors}>
                    <Download className="size-3.5" aria-hidden />
                    Export errors
                  </Button>
                </div>

                <ScrollArea className="max-h-64 rounded-md border border-border">
                  <Table aria-label="Rows that could not be imported">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Line</TableHead>
                        <TableHead className="w-40">Column</TableHead>
                        <TableHead>Problem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.errors.map((err, i) => (
                        <TableRow key={`${err.line}-${err.column}-${i}`}>
                          <TableCell className="tabular font-medium">{err.line}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {err.column ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {err.message}
                            {err.rawValue && (
                              <span className="ml-1 font-mono text-muted-foreground">
                                (got &ldquo;{err.rawValue}&rdquo;)
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            )}

            <Button variant="ghost" size="sm" onClick={() => setResult(null)}>
              <X className="size-3.5" aria-hidden />
              Clear
            </Button>
          </div>
        )}
      </PanelBody>

      <PanelFooter className="space-y-1.5">
        <p className="caption">
          Imports are idempotent — re-uploading the same period updates existing records
          rather than duplicating them.
        </p>
        {/*
          Said plainly, because this build is handed to client reviewers who are
          asked to test exactly this flow. The file really is parsed and totalled
          (the figures above are computed by the parser, so they are always
          correct), but storage is in-memory: on serverless hosting the write may
          land on one instance while the next page render is served by another.
          Better they read this than report it as a bug.
        */}
        <p className="caption flex items-start gap-1.5 text-warning">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>
            <span className="font-medium">Evaluation build:</span> the file is fully
            parsed and validated, but imported records are held in memory only and are
            not written to a database. Totals shown above are accurate; the dashboard
            figures will not stay changed.
          </span>
        </p>
      </PanelFooter>
    </Panel>
  );
}
