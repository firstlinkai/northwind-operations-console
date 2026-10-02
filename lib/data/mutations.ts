/**
 * ============================================================================
 * MUTATIONS
 * ============================================================================
 * Writes against the in-memory dataset. When Supabase is connected these
 * become `upsert` calls; the signatures are chosen to survive that swap
 * unchanged.
 *
 * Caveat, stated plainly: this store lives in the Node process, so imports are
 * lost on restart and are not shared between server instances. That is
 * acceptable for a demo and nowhere near acceptable for production — see
 * docs/DATA-PROVENANCE.md.
 */

import "server-only";

import {
  activeStaff,
  createRng,
  hashSeed,
  payrollRecords,
  profiles,
} from "@/lib/data/dataset";
import type { JeonSoftCsvRow, PayrollRecord, UUID } from "@/lib/types";

const round2 = (n: number): number => Math.round(n * 100) / 100;

function newId(seedKey: string): UUID {
  const rng = createRng(hashSeed(seedKey));
  const hex = (len: number) =>
    Array.from({ length: len }, () => "0123456789abcdef"[Math.floor(rng() * 16)]).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

/**
 * Resolve a CSV row to a staff profile. Email is authoritative; employee_id is
 * accepted as a fallback because we have not seen a real JeonSoft export and
 * cannot assume which identifier it emits.
 */
export function resolveEmployee(row: {
  employee_email?: string;
  employee_id?: string;
}): UUID | null {
  const email = row.employee_email?.trim().toLowerCase();
  if (email) {
    const byEmail = profiles.find((p) => p.email.toLowerCase() === email);
    if (byEmail) return byEmail.id;
  }
  const id = row.employee_id?.trim();
  if (id) {
    const byId = profiles.find((p) => p.id === id);
    if (byId) return byId.id;
  }
  return null;
}

/**
 * Apply a parsed payroll import.
 *
 * Idempotent on `(user_id, pay_period_start, pay_period_end)` — re-uploading
 * the same file updates rather than duplicating, which matters because payroll
 * files get re-sent after corrections and double-counted salary would corrupt
 * the headline expense KPI.
 */
export async function applyPayrollImport(
  rows: JeonSoftCsvRow[]
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const userId = resolveEmployee(row);
    if (!userId) continue;

    const record: PayrollRecord = {
      id: newId(`${userId}:${row.pay_period_start}:${row.pay_period_end}`),
      user_id: userId,
      pay_period_start: row.pay_period_start,
      pay_period_end: row.pay_period_end,
      gross_pay_php: round2(row.gross_pay_php),
      night_diff_php: round2(row.night_diff_php),
      overtime_pay_php: round2(row.overtime_pay_php),
      sss_deduction_php: round2(row.sss_php),
      philhealth_deduction_php: round2(row.philhealth_php),
      pagibig_deduction_php: round2(row.pagibig_php),
      tax_withheld_php: round2(row.tax_php),
      net_pay_php: round2(row.net_pay_php),
      created_at: new Date().toISOString(),
    };

    const existingIndex = payrollRecords.findIndex(
      (r) =>
        r.user_id === userId &&
        r.pay_period_start === row.pay_period_start &&
        r.pay_period_end === row.pay_period_end
    );

    if (existingIndex >= 0) {
      payrollRecords[existingIndex] = { ...record, id: payrollRecords[existingIndex]!.id };
      updated += 1;
    } else {
      payrollRecords.push(record);
      inserted += 1;
    }
  }

  return { inserted, updated };
}

/** Known staff emails — used by the import UI to explain unresolved rows. */
export function knownStaffEmails(): string[] {
  return activeStaff.map((s) => s.email).sort();
}
