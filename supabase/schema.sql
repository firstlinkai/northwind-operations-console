-- ============================================================================
-- NORTHWINDS INTERNATIONAL — OPERATIONAL DASHBOARD
-- schema.sql  ·  DDL + enums + helper functions + triggers + indexes
-- ============================================================================
--
-- WHAT THIS FILE IS
--   The complete physical schema for the NorthWinds dashboard. It is the SQL
--   mirror of `lib/types.ts` — every column here has a counterpart field
--   there, with matching name, nullability and numeric precision.
--
-- WHAT THIS FILE IS NOT
--   No RLS policies live here (see `policies.sql`). No data lives here
--   (see `seed.sql`).
--
-- CORRECTIONS AGAINST PRD §3
--   The PRD's DDL could not power several required panels and shipped a
--   critical RLS defect. Fixed here:
--     1. Helper functions `auth_role()` / `auth_client_id()` are SECURITY
--        DEFINER so a policy on `profiles` never re-enters `profiles`
--        (PRD §3 policies raise 42P17 "infinite recursion" as written).
--     2. `clients` and `departments` gained RLS (they had none — the whole
--        client roster leaked across tenants).
--     3. Added the columns and tables the dashboard actually reads:
--        shift / employment lifecycle / seat type on `profiles`, invoice
--        payment dates and line items, leave records, bill rates (revenue
--        per head — the PRD modelled cost but never revenue, so gross
--        margin was uncomputable), and live workstation presence.
--     4. Idempotency keys on the two import targets (`productivity_logs`,
--        `calling_metrics`) so a re-import cannot double-count.
--     5. `updated_at` + a shared trigger on every mutable table.
--
-- MONEY
--   `_usd` = client billing. `_php` = local payroll cost. The two never
--   share a column; conversion is an application concern.
--
-- APPLY ORDER
--   schema.sql  ->  policies.sql  ->  seed.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. EXTENSIONS
-- ---------------------------------------------------------------------------
-- `pgcrypto` gives us gen_random_uuid(), and crypt()/gen_salt() which seed.sql
-- needs to write bcrypt password hashes into auth.users. On hosted Supabase
-- both extensions already exist in the `extensions` schema; these are no-ops.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. TEARDOWN (idempotent re-apply)
-- ---------------------------------------------------------------------------
-- Reverse dependency order. CASCADE also removes the policies in policies.sql,
-- which is why policies.sql must be re-applied after this file.
DROP VIEW  IF EXISTS client_team_pod       CASCADE;

DROP TABLE IF EXISTS invoice_line_items    CASCADE;
DROP TABLE IF EXISTS financial_invoices    CASCADE;
DROP TABLE IF EXISTS calling_metrics       CASCADE;
DROP TABLE IF EXISTS leave_records         CASCADE;
DROP TABLE IF EXISTS payroll_records       CASCADE;
DROP TABLE IF EXISTS staff_presence        CASCADE;
DROP TABLE IF EXISTS productivity_logs     CASCADE;
DROP TABLE IF EXISTS client_bill_rates     CASCADE;
DROP TABLE IF EXISTS profiles              CASCADE;
DROP TABLE IF EXISTS departments           CASCADE;
DROP TABLE IF EXISTS clients               CASCADE;

DROP FUNCTION IF EXISTS auth_role()             CASCADE;
DROP FUNCTION IF EXISTS auth_client_id()        CASCADE;
DROP FUNCTION IF EXISTS auth_is_internal()      CASCADE;
DROP FUNCTION IF EXISTS user_client_id(uuid)    CASCADE;
DROP FUNCTION IF EXISTS invoice_client_id(uuid) CASCADE;
DROP FUNCTION IF EXISTS set_updated_at()        CASCADE;
DROP FUNCTION IF EXISTS sync_night_shift()      CASCADE;

DROP TYPE IF EXISTS seat_type          CASCADE;
DROP TYPE IF EXISTS leave_type         CASCADE;
DROP TYPE IF EXISTS shift_type         CASCADE;
DROP TYPE IF EXISTS presence_status    CASCADE;
DROP TYPE IF EXISTS employment_status  CASCADE;
DROP TYPE IF EXISTS department_name    CASCADE;
DROP TYPE IF EXISTS invoice_status     CASCADE;
DROP TYPE IF EXISTS user_role          CASCADE;

-- ---------------------------------------------------------------------------
-- 2. ENUMS  (mirror of the string-union types in lib/types.ts)
-- ---------------------------------------------------------------------------

-- lib/types.ts :: UserRole
--
-- 'staff' is the INERT default and exists to close a privilege-escalation hole
-- in PRD §3. A staff member's profile carries the `client_id` of the account
-- they work on. The PRD defaulted `profiles.role` to 'client_user', and the
-- portal policy was `client_id = auth_client_id()` — so every NorthWinds employee
-- would have satisfied the client-portal policy for their own account and been
-- able to read that client's invoices, billing and commercial data.
--
-- 'staff' appears in ZERO policies. A workforce row is a subject of the
-- dashboard, never a reader of it. See policies.sql.
CREATE TYPE user_role AS ENUM ('ceo_admin', 'hr_admin', 'ops_manager', 'client_user', 'staff');

-- lib/types.ts :: InvoiceStatus. Capitalised deliberately — these strings are
-- rendered directly by the AR ageing table and come back from QuickBooks
-- capitalised, so casing is part of the contract.
CREATE TYPE invoice_status AS ENUM ('Paid', 'Overdue', 'Pending');

-- lib/types.ts :: DepartmentName. The PRD used a free-text VARCHAR here, which
-- allowed 'Ops'/'Operations'/'operations' to coexist and silently split every
-- department roll-up. An enum makes that impossible.
CREATE TYPE department_name AS ENUM ('HR', 'Operations', 'Onboarding', 'Calling');

-- lib/types.ts :: EmploymentStatus. Philippine practice: hire probationary,
-- regularise at ~6 months. Drives HR "time to regularization" + attrition.
CREATE TYPE employment_status AS ENUM ('probationary', 'regular', 'resigned', 'terminated');

-- lib/types.ts :: PresenceStatus (Controlio heartbeat, coarse by design).
CREATE TYPE presence_status AS ENUM ('active', 'idle', 'offline');

-- lib/types.ts :: ShiftType. `night` drives the statutory 10% night differential.
CREATE TYPE shift_type AS ENUM ('day', 'mid', 'night');

-- lib/types.ts :: LeaveType.
CREATE TYPE leave_type AS ENUM ('sick', 'vacation', 'emergency', 'unpaid', 'absent_no_notice');

-- lib/types.ts :: SeatType. Billable seats earn client revenue; non-billable
-- seats are internal overhead. Drives the Operations utilization panel.
CREATE TYPE seat_type AS ENUM ('billable', 'non_billable');

-- ---------------------------------------------------------------------------
-- 3. SHARED TRIGGER FUNCTIONS
-- ---------------------------------------------------------------------------

-- Stamps `updated_at` on every UPDATE. Attached to all mutable tables so the
-- dashboard can do incremental sync without per-table boilerplate.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- `profiles` carries both `shift` (3-way band) and `is_night_shift` (boolean)
-- because lib/types.ts exposes both. Two columns describing one fact will
-- drift; this trigger makes `is_night_shift` a pure derivation of `shift` so
-- the night-differential payroll calculation can never disagree with the
-- shift-coverage KPI. Deliberately a trigger rather than a CHECK or a
-- GENERATED column: inserts that omit `is_night_shift` still succeed.
CREATE OR REPLACE FUNCTION sync_night_shift()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.is_night_shift := (NEW.shift = 'night');
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. TABLES  (created in FK dependency order)
-- ---------------------------------------------------------------------------

-- 4.1 CLIENTS ---------------------------------------------------------------
-- The tenants. One row per healthcare client NorthWinds serves.
CREATE TABLE clients (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    industry    VARCHAR(100) NOT NULL DEFAULT 'Medical/Nursing',
    -- Short uppercase code used in chart legends and dense table cells where
    -- the full client name will not fit. Added for lib/types.ts :: Client.code.
    code        VARCHAR(8)  NOT NULL UNIQUE
                CHECK (code = upper(code) AND code ~ '^[A-Z0-9]{2,8}$'),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE clients IS 'Tenants. RLS: a client_user may read only their own row.';

-- 4.2 DEPARTMENTS -----------------------------------------------------------
-- Reference data. Four fixed departments; the enum enforces the closed set.
CREATE TABLE departments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        department_name NOT NULL UNIQUE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE departments IS 'Reference data. Readable by any authenticated user; writable by ceo_admin only.';

-- 4.3 PROFILES --------------------------------------------------------------
-- People. Covers NorthWinds staff AND external client-portal logins; `role`
-- disambiguates.
--
-- WORKFORCE vs LOGIN
--   A row is WORKFORCE when `role = 'staff'`. Workforce rows are monitored
--   subjects: they have a department, a seat, a pay rate, and NO dashboard
--   access of any kind.
--   A row is a LOGIN when `role <> 'staff'`. All seven login rows carry
--   `department_id IS NULL` so that either discriminator — `role = 'staff'`
--   or `department_id IS NOT NULL` — returns the same 60 people and no
--   headcount query can accidentally count dashboard operators as seats.
--
--   CANONICAL ACTIVE HEADCOUNT:
--     SELECT count(*) FROM profiles WHERE role = 'staff' AND exited_at IS NULL;
--
--   `role` DEFAULTS to 'staff': a row created without an explicit role must be
--   inert, never privileged. The PRD defaulted it to 'client_user', which
--   handed portal access to anyone inserted carelessly.
CREATE TABLE profiles (
    id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email              VARCHAR(255) NOT NULL UNIQUE,
    full_name          VARCHAR(255) NOT NULL,
    role               user_role    NOT NULL DEFAULT 'staff',
    client_id          UUID REFERENCES clients(id)     ON DELETE SET NULL,
    department_id      UUID REFERENCES departments(id) ON DELETE SET NULL,

    -- Cost side of the margin model. PHP, never USD.
    hourly_rate_php    NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (hourly_rate_php >= 0),

    -- Derived from `shift` by trigger; see sync_night_shift() above.
    is_night_shift     BOOLEAN NOT NULL DEFAULT false,
    shift              shift_type NOT NULL DEFAULT 'day',

    -- Shown in the client's team pod, e.g. 'Registered Nurse (RN)'.
    job_title          VARCHAR(120) NOT NULL DEFAULT 'Associate',

    employment_status  employment_status NOT NULL DEFAULT 'probationary',
    seat_type          seat_type         NOT NULL DEFAULT 'billable',

    hire_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    -- Set when probation converts. NULL while probationary. HR's
    -- "avg days to regularization" is AVG(regularized_at - hire_date).
    regularized_at     DATE,
    -- Set on resignation/termination. Drives attrition + exits_last_90d.
    exited_at          DATE,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Lifecycle invariant: an exit date exists if and only if the person left.
    -- Without this, attrition could be computed two different ways and give
    -- two different answers.
    CONSTRAINT profiles_exit_matches_status CHECK (
        (employment_status IN ('resigned', 'terminated')) = (exited_at IS NOT NULL)
    ),
    CONSTRAINT profiles_regularized_after_hire CHECK (
        regularized_at IS NULL OR regularized_at >= hire_date
    ),
    CONSTRAINT profiles_exited_after_hire CHECK (
        exited_at IS NULL OR exited_at >= hire_date
    )
);
COMMENT ON COLUMN profiles.hourly_rate_php IS
  'COMPENSATION. Never expose to a client_user session. Use the client_team_pod view for portal queries.';

CREATE TRIGGER profiles_set_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER profiles_sync_night_shift
    BEFORE INSERT OR UPDATE OF shift ON profiles
    FOR EACH ROW EXECUTE FUNCTION sync_night_shift();

-- 4.4 CLIENT BILL RATES -----------------------------------------------------
-- What NorthWinds CHARGES per billable seat per month, by client and department.
--
-- PRD GAP: the original schema stored `hourly_rate_php` (what a seat COSTS)
-- but nothing about what a seat EARNS, so gross margin — the whole point of
-- the "what-if" simulator — could not be computed at all.
-- Rates are versioned by `effective_from`; the live rate is the newest row
-- with effective_from <= the reporting date.
CREATE TABLE client_bill_rates (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id         UUID NOT NULL REFERENCES clients(id)     ON DELETE CASCADE,
    department_id     UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    monthly_rate_usd  NUMERIC(12, 2) NOT NULL CHECK (monthly_rate_usd >= 0),
    effective_from    DATE NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT client_bill_rates_unique_version
        UNIQUE (client_id, department_id, effective_from)
);
COMMENT ON TABLE client_bill_rates IS
  'Revenue per billable seat. Commercial rate card - NOT visible to client_user (they see priced invoices instead).';

CREATE TRIGGER client_bill_rates_set_updated_at
    BEFORE UPDATE ON client_bill_rates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4.5 FINANCIAL INVOICES (QuickBooks Online) --------------------------------
CREATE TABLE financial_invoices (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qbo_invoice_id VARCHAR(100) NOT NULL UNIQUE,
    client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    amount_usd     NUMERIC(12, 2) NOT NULL CHECK (amount_usd >= 0),
    status         invoice_status NOT NULL DEFAULT 'Pending',
    issued_date    DATE NOT NULL,
    due_date       DATE NOT NULL,
    -- ADDED: when the cash actually landed. The 90-day cash-flow projection
    -- derives payment lag from (paid_date - due_date); without it the forecast
    -- had no historical anchor and degenerated to a straight line.
    paid_date      DATE,
    -- ADDED: net terms from the QBO invoice. Projection uses this to place
    -- open invoices on the forecast timeline.
    terms_days     INTEGER NOT NULL DEFAULT 30 CHECK (terms_days >= 0),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT financial_invoices_due_after_issue CHECK (due_date >= issued_date),
    -- A paid date only makes sense on a Paid invoice, and vice versa.
    CONSTRAINT financial_invoices_paid_consistency CHECK (
        (status = 'Paid') = (paid_date IS NOT NULL)
    ),
    CONSTRAINT financial_invoices_paid_after_issue CHECK (
        paid_date IS NULL OR paid_date >= issued_date
    )
);

CREATE TRIGGER financial_invoices_set_updated_at
    BEFORE UPDATE ON financial_invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4.6 INVOICE LINE ITEMS ----------------------------------------------------
-- Lets the client portal answer "what am I actually paying for?" instead of
-- showing a single opaque total.
CREATE TABLE invoice_line_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id     UUID NOT NULL REFERENCES financial_invoices(id) ON DELETE CASCADE,
    description    VARCHAR(255) NOT NULL,
    quantity       NUMERIC(10, 2) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    unit_rate_usd  NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_rate_usd >= 0),
    amount_usd     NUMERIC(12, 2) NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Idempotency key: re-running a QBO sync for the same invoice cannot
    -- duplicate its lines.
    CONSTRAINT invoice_line_items_unique_line UNIQUE (invoice_id, description)
);

CREATE TRIGGER invoice_line_items_set_updated_at
    BEFORE UPDATE ON invoice_line_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4.7 PRODUCTIVITY LOGS (Controlio) -----------------------------------------
CREATE TABLE productivity_logs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    log_date           DATE NOT NULL,
    active_hours       NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (active_hours >= 0 AND active_hours <= 24),
    idle_hours         NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (idle_hours   >= 0 AND idle_hours   <= 24),
    productivity_score NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (productivity_score BETWEEN 0 AND 100),
    overtime_hours     NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- IDEMPOTENCY: one row per person per day. A re-run of the Controlio
    -- import updates rather than doubling every productivity average.
    CONSTRAINT productivity_logs_one_per_day UNIQUE (user_id, log_date),
    CONSTRAINT productivity_logs_day_fits CHECK (active_hours + idle_hours <= 24)
);

CREATE TRIGGER productivity_logs_set_updated_at
    BEFORE UPDATE ON productivity_logs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4.8 STAFF PRESENCE --------------------------------------------------------
-- Live workstation state for the CEO heatmap and the client team pod.
-- Deliberately coarse — PRD §6 requires presence "without invasive keystroke
-- monitoring", so nothing finer-grained than a status + heartbeat is stored.
CREATE TABLE staff_presence (
    user_id        UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    status         presence_status NOT NULL DEFAULT 'offline',
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
    idle_minutes   INTEGER NOT NULL DEFAULT 0 CHECK (idle_minutes >= 0),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER staff_presence_set_updated_at
    BEFORE UPDATE ON staff_presence
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4.9 PAYROLL RECORDS (JeonSoft) --------------------------------------------
-- The most sensitive table in the database. See policies.sql: no client_user
-- policy exists and none may ever be added.
CREATE TABLE payroll_records (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    pay_period_start         DATE NOT NULL,
    pay_period_end           DATE NOT NULL,
    gross_pay_php            NUMERIC(10, 2) NOT NULL CHECK (gross_pay_php >= 0),
    night_diff_php           NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (night_diff_php >= 0),
    -- ADDED: overtime pay was in the JeonSoft CSV contract but had no column,
    -- so imported overtime silently vanished from the payroll KPI.
    overtime_pay_php         NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (overtime_pay_php >= 0),
    sss_deduction_php        NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (sss_deduction_php >= 0),
    philhealth_deduction_php NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (philhealth_deduction_php >= 0),
    pagibig_deduction_php    NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (pagibig_deduction_php >= 0),
    tax_withheld_php         NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (tax_withheld_php >= 0),
    net_pay_php              NUMERIC(10, 2) NOT NULL,
    -- ADDED: required by lib/types.ts :: PayrollRecord.created_at.
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT payroll_records_period_order CHECK (pay_period_end >= pay_period_start),
    -- IDEMPOTENCY: re-uploading the same JeonSoft CSV must not double payroll.
    CONSTRAINT payroll_records_one_per_period UNIQUE (user_id, pay_period_start)
);

CREATE TRIGGER payroll_records_set_updated_at
    BEFORE UPDATE ON payroll_records
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4.10 LEAVE RECORDS --------------------------------------------------------
-- Absence, for the HR tab's shrinkage metric. Lost hours / scheduled hours.
CREATE TABLE leave_records (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    leave_date  DATE NOT NULL,
    leave_type  leave_type NOT NULL,
    hours       NUMERIC(5, 2) NOT NULL DEFAULT 8 CHECK (hours > 0 AND hours <= 24),
    is_approved BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A person may split a day (half sick / half vacation) but cannot file the
    -- same type twice for the same day.
    CONSTRAINT leave_records_one_per_type_per_day UNIQUE (user_id, leave_date, leave_type)
);

CREATE TRIGGER leave_records_set_updated_at
    BEFORE UPDATE ON leave_records
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4.11 CALLING METRICS ------------------------------------------------------
CREATE TABLE calling_metrics (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    metric_date         DATE NOT NULL,
    total_calls         INTEGER NOT NULL DEFAULT 0 CHECK (total_calls    >= 0),
    answered_calls      INTEGER NOT NULL DEFAULT 0 CHECK (answered_calls >= 0),
    avg_handle_time_sec INTEGER NOT NULL DEFAULT 0 CHECK (avg_handle_time_sec >= 0),
    fcr_percentage      NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (fcr_percentage BETWEEN 0 AND 100),
    qa_audit_score      NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (qa_audit_score BETWEEN 0 AND 100),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Answer rate is answered/total; > 100% would be nonsense on the SLA gauge.
    CONSTRAINT calling_metrics_answered_lte_total CHECK (answered_calls <= total_calls),
    -- IDEMPOTENCY: one row per client per day.
    CONSTRAINT calling_metrics_one_per_day UNIQUE (client_id, metric_date)
);

CREATE TRIGGER calling_metrics_set_updated_at
    BEFORE UPDATE ON calling_metrics
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. SECURITY-DEFINER HELPERS  (the fix for PRD §3's 42P17 recursion)
-- ---------------------------------------------------------------------------
--
-- WHY THESE EXIST
--   PRD §3 wrote every policy as
--       USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'ceo_admin')
--   On `profiles` itself that is a policy that reads the table it guards:
--   evaluating the policy requires evaluating the policy. Postgres aborts with
--   42P17 "infinite recursion detected in policy for relation profiles" and
--   the ENTIRE dashboard returns errors, not just the profiles query.
--
--   These functions are SECURITY DEFINER, so they execute as the function
--   owner (the migration role, which owns `profiles`). A table owner is exempt
--   from that table's RLS, so the lookup completes without re-entering the
--   policy — the recursion is broken by an ownership hop, not by luck.
--
--   `SET search_path = public, pg_temp` pins name resolution. Listing pg_temp
--   explicitly, and LAST, is the point: when it is omitted Postgres searches
--   the temp schema FIRST, so a caller could create a temp table named
--   `profiles`, have the definer read it instead of the real one, and hand
--   themselves any role they liked. Naming it forces it to the back.
--   `STABLE` lets the planner call them once per statement instead of per row.
--
-- NOTE: do NOT add FORCE ROW LEVEL SECURITY to `profiles` — that would make
-- even the owner subject to RLS and re-introduce the recursion.

-- Role of the caller. NULL for anon (all policies then evaluate false).
CREATE OR REPLACE FUNCTION auth_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT role FROM profiles WHERE id = auth.uid();
$$;
COMMENT ON FUNCTION auth_role() IS
  'Caller role, read without triggering RLS on profiles. Breaks the PRD section 3 42P17 recursion.';

-- Tenant of the caller. NULL for internal staff (they are not scoped to one
-- client) and for anon.
CREATE OR REPLACE FUNCTION auth_client_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT client_id FROM profiles WHERE id = auth.uid();
$$;

-- Convenience predicate for "is a NorthWinds employee, not an external contact".
CREATE OR REPLACE FUNCTION auth_is_internal()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(
        (SELECT role FROM profiles WHERE id = auth.uid())
            IN ('ceo_admin', 'hr_admin', 'ops_manager'),
        false);
$$;

-- Tenant that owns a given staff member. Used by policies on child tables
-- (productivity_logs, staff_presence) so they do not depend on the caller
-- also having a readable row in `profiles` — the check stays correct even if
-- the profiles policy is later tightened.
CREATE OR REPLACE FUNCTION user_client_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT client_id FROM profiles WHERE id = p_user_id;
$$;

-- Tenant that owns a given invoice. Used by the invoice_line_items policy.
CREATE OR REPLACE FUNCTION invoice_client_id(p_invoice_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT client_id FROM financial_invoices WHERE id = p_invoice_id;
$$;

-- ---------------------------------------------------------------------------
-- 6. CLIENT-SAFE VIEW
-- ---------------------------------------------------------------------------
-- RLS filters ROWS, never COLUMNS. The client_user policy on `profiles` scopes
-- a client to their own team's rows, but a careless `select('*')` from the
-- portal would still hand them `hourly_rate_php` for every one of those staff.
--
-- This view is the column-safe surface for the portal: it exposes exactly the
-- fields in lib/types.ts :: ClientTeamMember and physically cannot leak pay.
-- `security_invoker = true` means the caller's own RLS on `profiles` still
-- applies, so tenant isolation is enforced once, in one place.
CREATE VIEW client_team_pod
WITH (security_invoker = true) AS
SELECT
    p.id                                   AS user_id,
    p.full_name,
    p.job_title,
    d.name                                 AS department,
    p.client_id,
    c.code                                 AS client_code,
    p.shift,
    COALESCE(sp.status, 'offline'::presence_status) AS status,
    GREATEST(0, (EXTRACT(YEAR  FROM age(CURRENT_DATE, p.hire_date)) * 12
               + EXTRACT(MONTH FROM age(CURRENT_DATE, p.hire_date)))::int) AS tenure_months
FROM profiles p
JOIN departments d      ON d.id = p.department_id
LEFT JOIN clients c     ON c.id = p.client_id
LEFT JOIN staff_presence sp ON sp.user_id = p.id
WHERE p.role = 'staff'          -- workforce only; never surface login accounts
  AND p.exited_at IS NULL;

COMMENT ON VIEW client_team_pod IS
  'Column-safe team roster for the client portal. Contains no compensation fields - do not add any.';

-- ---------------------------------------------------------------------------
-- 7. INDEXES
-- ---------------------------------------------------------------------------
-- Every foreign key gets an index (Postgres does not create these for you, and
-- without them every dashboard join over 90 days of logs is a seq scan), plus
-- every date column the dashboard filters by range.

-- profiles
CREATE INDEX idx_profiles_client_id       ON profiles (client_id);
CREATE INDEX idx_profiles_department_id   ON profiles (department_id);
CREATE INDEX idx_profiles_role            ON profiles (role);
CREATE INDEX idx_profiles_hire_date       ON profiles (hire_date);
CREATE INDEX idx_profiles_exited_at       ON profiles (exited_at) WHERE exited_at IS NOT NULL;
CREATE INDEX idx_profiles_regularized_at  ON profiles (regularized_at) WHERE regularized_at IS NOT NULL;
-- Covering index for the headcount / utilization KPIs, which always filter
-- "active staff" first.
CREATE INDEX idx_profiles_active_staff    ON profiles (role, department_id, seat_type, shift)
    WHERE exited_at IS NULL;

-- client_bill_rates
CREATE INDEX idx_bill_rates_client_id     ON client_bill_rates (client_id);
CREATE INDEX idx_bill_rates_department_id ON client_bill_rates (department_id);
CREATE INDEX idx_bill_rates_effective     ON client_bill_rates (effective_from DESC);

-- financial_invoices
CREATE INDEX idx_invoices_client_id       ON financial_invoices (client_id);
CREATE INDEX idx_invoices_due_date        ON financial_invoices (due_date);
CREATE INDEX idx_invoices_issued_date     ON financial_invoices (issued_date);
CREATE INDEX idx_invoices_paid_date       ON financial_invoices (paid_date) WHERE paid_date IS NOT NULL;
CREATE INDEX idx_invoices_status          ON financial_invoices (status);
-- AR ageing always reads "open invoices, oldest first".
CREATE INDEX idx_invoices_open_by_due     ON financial_invoices (due_date)
    WHERE status <> 'Paid';

-- invoice_line_items
CREATE INDEX idx_line_items_invoice_id    ON invoice_line_items (invoice_id);

-- productivity_logs
CREATE INDEX idx_prod_logs_user_id        ON productivity_logs (user_id);
CREATE INDEX idx_prod_logs_log_date       ON productivity_logs (log_date);
CREATE INDEX idx_prod_logs_date_user      ON productivity_logs (log_date, user_id);

-- staff_presence  (PK already covers user_id)
CREATE INDEX idx_presence_status          ON staff_presence (status);
CREATE INDEX idx_presence_heartbeat       ON staff_presence (last_heartbeat DESC);

-- payroll_records
CREATE INDEX idx_payroll_user_id          ON payroll_records (user_id);
CREATE INDEX idx_payroll_period_start     ON payroll_records (pay_period_start);
CREATE INDEX idx_payroll_period_end       ON payroll_records (pay_period_end);

-- leave_records
CREATE INDEX idx_leave_user_id            ON leave_records (user_id);
CREATE INDEX idx_leave_leave_date         ON leave_records (leave_date);
CREATE INDEX idx_leave_type               ON leave_records (leave_type);

-- calling_metrics
CREATE INDEX idx_calling_client_id        ON calling_metrics (client_id);
CREATE INDEX idx_calling_metric_date      ON calling_metrics (metric_date);

-- ============================================================================
-- END schema.sql  —  apply policies.sql next.
-- ============================================================================
