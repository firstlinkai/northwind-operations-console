/**
 * Regenerates `docs/samples/jeonsoft-sample.csv` from the ACTUAL demo roster.
 *
 * Why this exists: the payroll importer resolves employees by email address.
 * A hand-authored sample whose addresses don't exist in the roster imports
 * zero rows — which looks like a broken parser but is really the resolver
 * doing its job. Generating the sample from `activeStaff` guarantees PRD
 * verification case TC-04 actually passes.
 *
 * Run:  npm run gen:payroll-sample
 *
 * Arithmetic must balance to within ±₱1.00 or the importer rejects the row:
 *   net = gross + night_diff + overtime − (sss + philhealth + pagibig + tax)
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { MONTHLY_HOURS, NIGHT_DIFF_PREMIUM } from "../lib/types";
import { activeStaff, departmentNameById } from "../lib/data/dataset";

const ROW_COUNT = 12;
const PERIOD_START = "2026-07-01";
const PERIOD_END = "2026-07-15";

const round2 = (n: number): number => Math.round(n * 100) / 100;
const money = (n: number): string => n.toFixed(2);

/** Employee-share statutory contributions on a MONTHLY gross. */
function statutory(monthlyGross: number) {
  return {
    sss: Math.min(1350, monthlyGross * 0.045),
    philhealth: Math.min(2500, monthlyGross * 0.025),
    pagibig: Math.min(200, monthlyGross * 0.02),
  };
}

/** Simplified TRAIN-law graduated withholding on monthly taxable income. */
function withholdingTax(monthlyTaxable: number): number {
  if (monthlyTaxable <= 20833) return 0;
  if (monthlyTaxable <= 33333) return (monthlyTaxable - 20833) * 0.15;
  if (monthlyTaxable <= 66667) return 1875 + (monthlyTaxable - 33333) * 0.2;
  if (monthlyTaxable <= 166667) return 8541.8 + (monthlyTaxable - 66667) * 0.25;
  return 33541.8 + (monthlyTaxable - 166667) * 0.3;
}

const HEADER = [
  "Employee No",
  "Email Address",
  "Employee Name",
  "Department",
  "Period From",
  "Period To",
  "Gross Pay",
  "Night Diff",
  "OT Pay",
  "SSS",
  "PhilHealth",
  "Pag-IBIG",
  "W/Tax",
  "Net Pay",
].join(",");

const rows: string[] = [HEADER];

activeStaff.slice(0, ROW_COUNT).forEach((staff, i) => {
  const semiMonthlyHours = MONTHLY_HOURS / 2;

  const gross = round2(staff.hourly_rate_php * semiMonthlyHours);
  const nightDiff = staff.is_night_shift ? round2(gross * NIGHT_DIFF_PREMIUM) : 0;
  // Deterministic, modest overtime on roughly every third row.
  const overtime = i % 3 === 1 ? round2(staff.hourly_rate_php * 1.25 * 4) : 0;

  const periodGross = gross + nightDiff + overtime;
  const monthlyEquivalent = periodGross * 2;

  const { sss, philhealth, pagibig } = statutory(monthlyEquivalent);
  const taxable = monthlyEquivalent - (sss + philhealth + pagibig);

  const sssHalf = round2(sss / 2);
  const phicHalf = round2(philhealth / 2);
  const hdmfHalf = round2(pagibig / 2);
  const taxHalf = round2(withholdingTax(taxable) / 2);

  // Net derived from the ROUNDED components, so the file balances exactly
  // rather than drifting by a centavo and tripping the validator.
  const net = round2(
    periodGross - sssHalf - phicHalf - hdmfHalf - taxHalf
  );

  const department = departmentNameById(staff.department_id) ?? "Operations";
  const name = staff.full_name.includes(",") ? `"${staff.full_name}"` : staff.full_name;

  rows.push(
    [
      `EMP-${1001 + i}`,
      staff.email,
      name,
      department,
      PERIOD_START,
      PERIOD_END,
      money(gross),
      money(nightDiff),
      money(overtime),
      money(sssHalf),
      money(phicHalf),
      money(hdmfHalf),
      money(taxHalf),
      money(net),
    ].join(",")
  );
});

const out = rows.join("\r\n") + "\r\n";

for (const target of [
  resolve(process.cwd(), "docs/samples/jeonsoft-sample.csv"),
  resolve(process.cwd(), "public/samples/jeonsoft-sample.csv"),
]) {
  writeFileSync(target, out, "utf8");
  console.log(`wrote ${target}`);
}

/* ---------------------------------------------------------------------------
 * MALFORMED VARIANT
 * Demonstrates per-row error reporting. Built from the SAME real roster, so
 * only the deliberate defects fail — otherwise every row would be rejected as
 * "unknown employee" and the demo would misrepresent what the validator does.
 * ------------------------------------------------------------------------ */

const clean = rows.slice(1); // generated rows, without the header
const bad: string[] = [HEADER];

const cells = (line: string): string[] => line.split(",");

// Line 2 — clean, but exercises ₱ symbol and thousands separators.
{
  const c = cells(clean[0]!);
  c[6] = `"₱${Number(c[6]).toLocaleString("en-US", { minimumFractionDigits: 2 })}"`;
  bad.push(c.join(","));
}
// Line 3 — missing required field: Employee Name blank.
{
  const c = cells(clean[1]!);
  c[2] = "";
  bad.push(c.join(","));
}
// Line 4 — non-numeric gross pay.
{
  const c = cells(clean[2]!);
  c[6] = "PENDING";
  bad.push(c.join(","));
}
// Line 5 — pay period end before start.
{
  const c = cells(clean[3]!);
  c[4] = "2026-07-15";
  c[5] = "2026-07-01";
  bad.push(c.join(","));
}
// Line 6 — employee not on the NorthWinds roster.
{
  const c = cells(clean[4]!);
  c[0] = "EMP-9042";
  c[1] = "roberto.unknown@northwinds.example";
  c[2] = "Roberto Unknown";
  bad.push(c.join(","));
}
// Line 7 — arithmetic mismatch: net understated by ₱500.
{
  const c = cells(clean[5]!);
  c[13] = money(Number(c[13]) - 500);
  bad.push(c.join(","));
}
// Line 8 — negative deduction.
{
  const c = cells(clean[6]!);
  c[9] = "-875.00";
  bad.push(c.join(","));
}
// Lines 9-11 — clean, so partial success is visibly partial.
bad.push(clean[7]!, clean[8]!, clean[9]!);

// UTF-8 BOM + CRLF: what a Windows payroll export actually emits.
const badOut = "﻿" + bad.join("\r\n") + "\r\n\r\n";

for (const target of [
  resolve(process.cwd(), "docs/samples/jeonsoft-malformed.csv"),
  resolve(process.cwd(), "public/samples/jeonsoft-malformed.csv"),
]) {
  writeFileSync(target, badOut, "utf8");
  console.log(`wrote ${target}`);
}

console.log(`\n${ROW_COUNT} clean rows generated against real roster emails:`);
for (const s of activeStaff.slice(0, 3)) console.log(`  ${s.email}  ${s.full_name}`);
console.log(
  "\nMalformed variant: 10 rows, 6 defects (lines 3,4,5,6,7,8), 4 importable."
);
