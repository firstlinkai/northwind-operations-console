# NorthWinds International — Database Layer

PostgreSQL / Supabase schema, row-level security and demo data for the NorthWinds
International operational dashboard.

| File | Contains | Apply order |
|---|---|---|
| `schema.sql` | DDL, enums, `SECURITY DEFINER` helpers, triggers, indexes, the client-safe view | 1 |
| `policies.sql` | `GRANT`/`REVOKE` + every RLS policy | 2 |
| `seed.sql` | Demo data only | 3 |

`schema.sql` is the SQL mirror of `lib/types.ts`. That file is the canonical
domain contract — every column here matches a field there by name, nullability
and numeric precision. **If the two ever disagree, `lib/types.ts` is right.**

---

## Applying locally

The local stack applies these three files in order on every reset.

```powershell
npx supabase start
npx supabase db reset
```

If your `supabase/config.toml` does not already list them, wire them up as
migration + seed files, or apply them by hand against the local database:

```powershell
npx supabase db reset          # clean database
$env:PGPASSWORD = "postgres"
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/policies.sql
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

All three files are re-runnable. `schema.sql` drops its own objects first;
`policies.sql` drops each policy before recreating it; `seed.sql` runs inside a
single transaction and every insert ends in `ON CONFLICT DO NOTHING`.

> `schema.sql` drops tables with `CASCADE`, which takes the policies with them.
> **Always re-run `policies.sql` after `schema.sql`.** A table with RLS enabled
> and no policies is invisible to the app, which looks exactly like an empty
> database.

## Applying to hosted Supabase

Run the same three files in the SQL Editor, in order, as the `postgres` role.

Two things behave differently on hosted:

1. **`CREATE EXTENSION`** — `uuid-ossp` and `pgcrypto` already exist in the
   `extensions` schema. The `IF NOT EXISTS` calls are no-ops.
2. **Seeding `auth.users` directly is not supported by Supabase.** It works, but
   Supabase's guidance is to create users through the Admin API so GoTrue's own
   invariants are respected. See the next section.

---

## The auth model: 76 profiles, 7 logins

`profiles.id` has a foreign key to `auth.users(id)`, but only **7 of the 76
people** in the seed are ever meant to sign in. The other 69 are workforce —
they are the *subject* of this dashboard, not users of it.

**Chosen approach: keep the FK, create disabled `auth.users` rows.**

Each workforce member gets an `auth.users` row with:

| Column | Value | Effect |
|---|---|---|
| `encrypted_password` | `NULL` | no password grant is possible |
| `email_confirmed_at` | `NULL` | GoTrue refuses sign-in for an unconfirmed email |
| `auth.identities` | *no row* | no provider linkage of any kind |

Alternatives considered and rejected:

- **Dropping the FK** — loses `ON DELETE CASCADE`, so deleting a user would
  orphan every productivity log, payslip and leave record attached to them.
- **A nullable `auth_user_id` column instead of the FK on `id`** — diverges from
  `lib/types.ts`, where `Profile.id` *is* the user id, and would have forced a
  join into every single query in the app.

Defence in depth: even if a workforce session were somehow minted, their
`profiles.role` is `'staff'`, and `'staff'` appears in **zero** RLS policies. It
would read nothing.

### Hosted alternative: create the 7 logins via the Admin API

If you would rather not write to `auth.users` from SQL on a hosted project,
create only the seven logins through the Admin API and let the seed fill in the
rest. Run this **before** `seed.sql`; it uses the same fixed UUIDs, so
`seed.sql`'s `ON CONFLICT (id) DO NOTHING` will skip them and insert only the
matching `profiles` rows.

```ts
// scripts/seed-auth-users.ts — run with the SERVICE ROLE key, never in the browser
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,          // server-side only
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const LOGINS = [
  { id: "a0000000-0000-4000-8000-000000000001", email: "ceo_admin@northwinds.example" },
  { id: "a0000000-0000-4000-8000-000000000002", email: "hr_admin@northwinds.example" },
  { id: "a0000000-0000-4000-8000-000000000003", email: "ops_manager@northwinds.example" },
  { id: "c0000000-0000-4000-8000-000000000001", email: "client_alderbay@alderbay.example" },
  { id: "c0000000-0000-4000-8000-000000000002", email: "client_kestrel@kestrelmed.example" },
  { id: "c0000000-0000-4000-8000-000000000003", email: "client_northlake@northlaketele.example" },
  { id: "c0000000-0000-4000-8000-000000000004", email: "client_ironwood@ironwoodhealth.example" },
];

for (const u of LOGINS) {
  const { error } = await admin.auth.admin.createUser({
    id: u.id,
    email: u.email,
    password: "***REMOVED***",
    email_confirm: true,
  });
  if (error && !/already registered/i.test(error.message)) throw error;
}
```

The 69 workforce `auth.users` rows still come from `seed.sql`; there is no Admin
API call that creates a permanently disabled user, and creating them as real
users with real passwords would be strictly worse.

---

## Demo credentials

Password for all seven accounts: **`***REMOVED***`**

| Email | Role | Sees |
|---|---|---|
| `ceo_admin@northwinds.example` | `ceo_admin` | Everything — all clients, all financials, all payroll |
| `hr_admin@northwinds.example` | `hr_admin` | Profiles, payroll, leave, productivity, presence. **No client billing** |
| `ops_manager@northwinds.example` | `ops_manager` | Profiles, productivity, presence, calling SLAs, bill rates. **No payroll, no leave** |
| `client_alderbay@alderbay.example` | `client_user` | Alder Bay only — team, presence, SLAs, invoices |
| `client_kestrel@kestrelmed.example` | `client_user` | Kestrel only |
| `client_northlake@northlaketele.example` | `client_user` | Northlake only |
| `client_ironwood@ironwoodhealth.example` | `client_user` | Ironwood Health only |

The 69 workforce accounts have no password and cannot sign in.

---

## The RLS model

Five roles, one rule each:

- **`ceo_admin`** — full read/write on everything.
- **`hr_admin`** — the workforce: profiles, payroll, leave, productivity,
  presence. Can create and edit workforce rows but is pinned to `role = 'staff'`
  on both `USING` and `WITH CHECK`, so HR cannot mint an administrator. No
  client billing at all.
- **`ops_manager`** — delivery: profiles, productivity, presence, calling
  metrics and the bill-rate card behind utilization. Read-only on rates. No
  payroll records, no leave (leave reasons are sensitive personal data).
- **`client_user`** — one tenant, read-only: their own `clients` row, their own
  team's profiles/presence/productivity, their own SLA metrics, their own
  invoices and invoice lines. Nothing else, ever.
- **`staff`** — the default. Appears in **zero** policies. Reads nothing.

### What was wrong with the PRD's policies

| # | Defect | Fix |
|---|---|---|
| 1 | Every policy inlined `(SELECT role FROM profiles WHERE id = auth.uid())`. On `profiles` that is a policy reading the table it guards — Postgres error **42P17, infinite recursion** — and it breaks the whole dashboard, not just one query. | `SECURITY DEFINER` helpers (`auth_role()`, `auth_client_id()`, `user_client_id()`, `invoice_client_id()`) run as the table owner, who is exempt from RLS. The recursion is broken by an ownership hop. |
| 2 | No policy let a `client_user` read their own `profiles` row — yet every portal query begins with exactly that lookup. The portal returned zero rows with no error to explain it. | `profiles_self_read`: `USING (id = auth.uid())`, `SELECT` only (a self-`UPDATE` would allow `SET role = 'ceo_admin'`). |
| 3 | `hr_admin` and `ops_manager` existed in the enum with no policies at all. Both saw nothing. | Scoped policies for both, as described above. |
| 4 | `clients` and `departments` never had RLS enabled — the full customer roster was readable by every tenant. | RLS on **all 11 tables**. A `client_user` reads exactly one `clients` row. |
| 5 | `FOR ALL USING (...)` with no `WITH CHECK` — writes were unconstrained, so a permitted user could insert or update a row into a state they are not allowed to read (e.g. re-point an invoice at another tenant). | `WITH CHECK` on every write-capable policy. |
| 6 | *(Inherited from the role model.)* A tenant check without a role check is not isolation: workforce rows carry the `client_id` of the account they serve, so `client_id = auth_client_id()` alone would have matched every NorthWinds employee. | Every portal policy asserts `auth_role() = 'client_user'` **and** the tenant match. `profiles.role` also defaults to `'staff'`, so a carelessly inserted row is inert. |

### Two boundaries that are enforced, not just documented

**Client users can never read `payroll_records`.** There is no `client_user`
policy on that table and none may be added. With RLS on and no matching policy
the table simply does not exist for a portal session. `lib/types.ts` enforces
the same boundary in the type system: `ClientTeamMember` has no compensation
field.

**RLS filters rows, not columns.** The `client_user` policy on `profiles`
correctly limits a client to their own team's rows — but those rows still
contain `hourly_rate_php`. A careless `select('*')` would leak every team
member's pay rate.

> **The client portal must read the `client_team_pod` view, not `profiles`.**

`client_team_pod` exposes exactly the fields in `lib/types.ts ::
ClientTeamMember` and physically cannot return a pay figure. It is declared
`security_invoker = true`, so the caller's own RLS on `profiles` still applies
and tenant isolation is enforced in one place.

---

## What the seed contains

`seed.sql` is much larger than PRD §8 because PRD §8 seeded **zero** profiles,
**zero** productivity logs and **zero** payroll records — yet three of the four
headline KPIs read from exactly those three tables, and it seeded a single day
of calling metrics, which cannot draw a trend line.

| Table | Rows | Notes |
|---|---|---|
| `clients` | 4 | PRD UUIDs and names preserved; codes `ALDR` / `KSTL` / `NLAK` / `IRON` |
| `departments` | 4 | PRD UUIDs preserved |
| `profiles` | 76 | 60 active workforce + 9 leavers + 7 logins |
| `client_bill_rates` | 24 | 2025 and 2026 rate cards, 12 client/department pairs |
| `staff_presence` | 69 | ~70% active / ~20% idle / ~10% offline |
| `productivity_logs` | ~4,400 | 90 days, Mon–Sat, hire/exit aware |
| `leave_records` | ~180 | ~3.9% of scheduled days |
| `payroll_records` | ~480 | 7 closed semi-monthly periods |
| `calling_metrics` | 360 | 90 days × 4 clients |
| `financial_invoices` | 24 | 6 monthly cycles × 4 clients |
| `invoice_line_items` | 72 | one line per staffed department |

### Headcount is 60, not 52

PRD §5 labels the headcount KPI "(52)". The real figure is **60 active staff**.

```sql
SELECT count(*) FROM profiles WHERE role = 'staff' AND exited_at IS NULL;  -- 60
```

All seven login rows have `department_id IS NULL`, so
`WHERE department_id IS NOT NULL AND exited_at IS NULL` returns the same 60.
Both discriminators agree by construction — dashboard operators are never
counted as seats.

Nine further workforce rows carry `exited_at`, retained so attrition,
`exits_last_90d` and the attrition trend have real history instead of zeroes.

### Workforce shape

- **Departments** — HR 5 · Operations 15 · Onboarding 12 · Calling 28
- **Seats** — 52 billable / 8 non-billable → **86.7% utilization**
- **Clients** — ALDR 15 · KSTL 12 · NLAK 18 · IRON 7
- **Shifts** — day 15 · mid 15 · **night 30**. Half the workforce is on nights
  because these teams cover US healthcare business hours from Manila. It is
  also what makes the statutory 10% night differential a material payroll line
  rather than a rounding error — the point of the simulator's night-shift slider.
- **Status** — 51 regular / 9 probationary. Probationary hire dates are anchored
  to `CURRENT_DATE`, so "hires last 90 days" is never zero on a stale database.
- **Rates** — ₱170–420/hour. Entry patient-access work sits near the Ironwood
  Manila BPO floor; licensed RNs on US telehealth triage command the top.

### Financial calibration

| | Monthly |
|---|---|
| Revenue — 52 billable seats at the 2026 rate card | ~**USD 91.6k** |
| Cost — ₱2.95M gross payroll (incl. night differential + overtime) plus ~10% employer statutory share, at ₱58.5/USD | ~**USD 55.4k** |
| **Blended gross margin** | ~**39%** |

Invoices carry per-client terms (Ironwood net-15 through Kestrel net-45) so the
90-day cash-flow projection has a non-trivial curve; ~82% of matured invoices
are `Paid` with `paid_date` scattered from five days early to eleven days late,
giving the forecast real payment lag to anchor on. The remainder sit `Overdue`
across the 1-30 / 31-60 / 61-90 ageing buckets, so the AR table is populated at
every level. Invoice totals are reconciled to the sum of their line items.

Calling metrics are deliberately spread against the 95% answer-rate target:
Northlake clears it comfortably, Alder Bay hovers on it, Kestrel and Ironwood breach it
often enough that the SLA panel has something to flag. A dashboard where every
client is green demonstrates nothing.

### Determinism

All variation comes from `get_byte(decode(md5(<stable key>), 'hex'), n)`, never
`random()`. Two consequences:

- `supabase db reset` produces byte-identical data every time, so a demo
  screenshot taken today still matches the database tomorrow.
- Productivity and leave share one hash key per (person, day), so nobody is
  simultaneously on sick leave and logging eight active hours.

Date-anchored data is generated relative to `CURRENT_DATE`, so the demo never
goes stale. Fixed history — hire dates, tenure — uses absolute dates.

---

## Verifying a reset

```sql
-- 60 active workforce, 9 leavers, 7 logins
SELECT role,
       count(*) FILTER (WHERE exited_at IS NULL) AS active,
       count(*)                                  AS total
FROM profiles GROUP BY role ORDER BY role;

-- the three tables PRD §8 left empty
SELECT count(*) FROM productivity_logs;   -- ~4,400
SELECT count(*) FROM payroll_records;     -- ~480
SELECT count(*) FROM calling_metrics;     -- 360

-- utilization ~86.7%, shift coverage 15/15/30
SELECT seat_type, count(*) FROM profiles
WHERE role = 'staff' AND exited_at IS NULL GROUP BY seat_type;
SELECT shift, count(*) FROM profiles
WHERE role = 'staff' AND exited_at IS NULL GROUP BY shift;

-- invoices reconcile to their lines (expect zero rows)
SELECT fi.qbo_invoice_id
FROM financial_invoices fi
JOIN (SELECT invoice_id, SUM(amount_usd) t FROM invoice_line_items GROUP BY invoice_id) l
  ON l.invoice_id = fi.id
WHERE ROUND(l.t, 2) <> fi.amount_usd;

-- AR mix across all three statuses
SELECT status, count(*), SUM(amount_usd) FROM financial_invoices GROUP BY status;
```

### Multi-tenant isolation (PRD §12.2)

RLS can only be tested from a real session — `psql` as `postgres` owns the
tables and bypasses every policy. Sign in through the app, or impersonate in the
SQL editor:

```sql
-- Impersonate the Alder Bay client contact
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT count(*) FROM clients;             -- 1   (their own row only)
SELECT count(*) FROM financial_invoices;  -- 6   (Alder Bay only)
SELECT count(*) FROM payroll_records;     -- 0   (must always be 0)
SELECT count(*) FROM client_bill_rates;   -- 0   (rate card is never exposed)
SELECT count(*) FROM client_team_pod;     -- 15  (Alder Bay team, no pay columns)

RESET role;
```

---

## Assumptions

These were decisions the PRD did not settle. Flagging them so they can be
overridden rather than discovered.

1. **Headcount is 60, not the PRD's 52.** Stated in the brief; the seed is built
   to it and every derived figure (utilization, revenue, margin) follows.
2. **Workforce members are not application users.** They have disabled
   `auth.users` rows purely to satisfy the FK. If NorthWinds later wants staff
   self-service (view my own payslip, file my own leave), that needs new
   policies keyed on `user_id = auth.uid()` — deliberately not added, because
   granting it today would open `payroll_records` to sessions that currently
   cannot exist.
3. **Staff serve exactly one client**, per `lib/types.ts`. No shared seats.
4. **`ops_manager` can see `profiles.hourly_rate_php`** — seat cost is an input
   to the utilization and margin panels. Payslips, deductions and tax withheld
   remain out of reach.
5. **Payroll figures are modelled, not statutory-grade.** SSS 4.5% capped,
   PhilHealth 2.5% capped, Pag-IBIG ₱100/period, withholding at 15% of the
   excess over the ₱10,417 semi-monthly exemption. Correct in structure and
   plausible in magnitude; not a compliant payroll engine.
6. **Semi-monthly pay periods** (15th and month-end), which is standard
   Philippine practice, at ~87 hours per period — half the 174-hour month in
   `lib/types.ts`.
7. **No `qbo_invoice_id` collisions with a real QuickBooks tenant.** Seeded IDs
   follow `INV-<CODE>-<YYYYMM>`. If a live QBO sync is wired up, namespace them
   or clear the demo invoices first.
8. **HR has no billable seats**, so no HR bill rate exists in
   `client_bill_rates`. Any query joining seats to rates must tolerate that —
   or, better, only join on `seat_type = 'billable'`, which never produces an
   HR row.
