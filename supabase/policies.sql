-- ============================================================================
-- NORTHWINDS INTERNATIONAL — OPERATIONAL DASHBOARD
-- policies.sql  ·  Row Level Security ONLY
-- ============================================================================
--
-- APPLY AFTER schema.sql. (schema.sql drops its tables with CASCADE, which
-- takes these policies with them, so this file must be re-run after it.)
--
-- ---------------------------------------------------------------------------
-- THE SECURITY MODEL IN ONE PARAGRAPH
-- ---------------------------------------------------------------------------
-- Five roles. `ceo_admin` sees and writes everything. `hr_admin` sees the
-- workforce — profiles, payroll, leave, productivity — but no client billing.
-- `ops_manager` sees delivery — profiles, productivity, presence, calling SLAs
-- and the seat/bill-rate data behind utilization — but never compensation.
-- `client_user` is a single-tenant reader: their own client row, their own
-- team's presence and productivity, their own SLA metrics and their own
-- invoices, and nothing else ever. `staff` is the inert default and appears in
-- ZERO policies below — a workforce row is a subject of this dashboard, never
-- a reader of it.
--
-- ---------------------------------------------------------------------------
-- FIVE DEFECTS IN PRD §3 THAT THIS FILE FIXES
-- ---------------------------------------------------------------------------
--  1. INFINITE RECURSION (42P17). Every PRD policy inlined
--       (SELECT role FROM profiles WHERE id = auth.uid())
--     On `profiles` that is a policy reading the table it guards. Postgres
--     raises 42P17 and the dashboard breaks entirely. Fixed by routing every
--     identity lookup through the SECURITY DEFINER helpers in schema.sql
--     (auth_role(), auth_client_id(), user_client_id(), invoice_client_id()),
--     which execute as the table owner and are therefore exempt from RLS.
--
--  2. CLIENT USERS COULD NOT READ THEIR OWN PROFILE. Every portal query starts
--     with "who am I / which tenant am I". The PRD granted no SELECT on
--     `profiles` to client_user, so that lookup returned zero rows and the
--     entire portal rendered empty. Fixed by `profiles_self_read`.
--
--  3. hr_admin AND ops_manager HAD NO POLICIES AT ALL. Both existed in the
--     enum and could see literally nothing. Both now have scoped access.
--
--  4. `clients` AND `departments` HAD NO RLS. With RLS off, any authenticated
--     session could read the full client roster — a cross-tenant leak of the
--     customer list itself. RLS is now enabled on every table in the schema.
--
--  5. `FOR ALL USING (...)` WITH NO `WITH CHECK`. In Postgres, USING filters
--     rows you may READ or TOUCH; WITH CHECK validates rows you WRITE. Without
--     it, a permitted user could INSERT or UPDATE a row into a state they are
--     not allowed to see — e.g. re-assign an invoice to another tenant. Every
--     write-capable policy below carries an explicit WITH CHECK.
--
-- ---------------------------------------------------------------------------
-- AND ONE DEFECT INHERITED FROM THE ROLE MODEL
-- ---------------------------------------------------------------------------
--  6. TENANT CHECK WITHOUT ROLE CHECK. `client_id = auth_client_id()` alone is
--     NOT tenant isolation. A workforce row carries the client_id of the
--     account that person serves, so a bare tenant check would have matched
--     every NorthWinds employee against their own client's invoices. Every
--     client-portal policy below therefore asserts BOTH
--         auth_role() = 'client_user'  AND  <tenant match>.
--
-- ---------------------------------------------------------------------------
-- CONVENTIONS
-- ---------------------------------------------------------------------------
--  * Policies are PERMISSIVE and OR-ed together. Read them as a whitelist:
--    if no policy grants a row, it does not exist for that session.
--  * `TO authenticated` on every policy — `anon` is granted nothing anywhere,
--    so an unauthenticated request can never reach a row.
--  * auth_role() returns NULL for a session with no profile row, and
--    NULL = 'ceo_admin' is NULL, which is not TRUE. Such a session sees
--    nothing. That is the intended fail-closed behaviour.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. BASELINE GRANTS
-- ---------------------------------------------------------------------------
-- RLS only filters rows a role already has table privileges on. Supabase's
-- default privileges hand `anon` and `authenticated` full DML on new tables in
-- `public`, so we withdraw that first and re-grant deliberately.
--
-- `anon` gets NOTHING: this dashboard has no public surface at all.

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Reference data: read-only for everyone signed in, writable only via the
-- ceo_admin policies below.
GRANT SELECT                         ON clients            TO authenticated;
GRANT SELECT                         ON departments        TO authenticated;
GRANT INSERT, UPDATE, DELETE         ON clients            TO authenticated;
GRANT INSERT, UPDATE, DELETE         ON departments        TO authenticated;

-- Operational tables. RLS decides which rows; these grants only decide which
-- verbs are reachable at all.
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_bill_rates  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON financial_invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_line_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON productivity_logs  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_presence     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_records    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON leave_records      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON calling_metrics    TO authenticated;

-- The column-safe portal roster. Prefer this over `profiles` in the client
-- portal: RLS cannot filter columns, so a `select('*')` on `profiles` would
-- hand a client every team member's hourly rate even with correct row policies.
GRANT SELECT ON client_team_pod TO authenticated;

-- Identity helpers. SECURITY DEFINER functions are executable by PUBLIC by
-- default; withdraw that and hand them only to signed-in sessions.
REVOKE EXECUTE ON FUNCTION auth_role()             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_client_id()        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_is_internal()      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION user_client_id(uuid)    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION invoice_client_id(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_role()             TO authenticated;
GRANT EXECUTE ON FUNCTION auth_client_id()        TO authenticated;
GRANT EXECUTE ON FUNCTION auth_is_internal()      TO authenticated;
GRANT EXECUTE ON FUNCTION user_client_id(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION invoice_client_id(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. ENABLE RLS ON EVERY TABLE
-- ---------------------------------------------------------------------------
-- PRD §3 enabled RLS on five of nine tables. `clients` and `departments` were
-- left wide open, which leaked the entire customer roster to every tenant.
-- With RLS enabled and no matching policy, a table is closed by default —
-- which is the correct posture for anything added later.
--
-- NOTE: deliberately NOT using FORCE ROW LEVEL SECURITY. FORCE subjects the
-- table owner to RLS too, which would defeat the SECURITY DEFINER helpers and
-- reintroduce the 42P17 recursion this file exists to fix.

ALTER TABLE clients            ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_bill_rates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE productivity_logs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_presence     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE calling_metrics    ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. CLIENTS  — the tenant roster
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS clients_ceo_all        ON clients;
DROP POLICY IF EXISTS clients_internal_read  ON clients;
DROP POLICY IF EXISTS clients_own_tenant     ON clients;

-- WHAT: full control of the client roster.
-- WHY:  onboarding/offboarding an account is an executive act, not an
--       operational one.
CREATE POLICY clients_ceo_all ON clients
    FOR ALL TO authenticated
    USING      (auth_role() = 'ceo_admin')
    WITH CHECK (auth_role() = 'ceo_admin');

-- WHAT: read-only roster for hr_admin and ops_manager.
-- WHY:  both need to resolve a client_id to a human-readable name/code when
--       rendering staff assignments and SLA tables. Neither may create,
--       rename or delete an account.
CREATE POLICY clients_internal_read ON clients
    FOR SELECT TO authenticated
    USING (auth_role() IN ('hr_admin', 'ops_manager'));

-- WHAT: a client contact reads exactly one row — their own.
-- WHY:  PRD §3 left this table without RLS, so the full customer list was
--       readable by every tenant. Competitors sharing a BPO would have been
--       able to enumerate each other. Role is checked as well as tenant so a
--       'staff' row (which also carries a client_id) matches nothing.
CREATE POLICY clients_own_tenant ON clients
    FOR SELECT TO authenticated
    USING (auth_role() = 'client_user' AND id = auth_client_id());

-- ---------------------------------------------------------------------------
-- 3. DEPARTMENTS  — reference data
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS departments_ceo_all       ON departments;
DROP POLICY IF EXISTS departments_read_all_auth ON departments;

-- WHAT: only the CEO may add or rename a department.
-- WHY:  department identity is the join key for every roll-up in the
--       dashboard; renaming one silently re-partitions every chart.
CREATE POLICY departments_ceo_all ON departments
    FOR ALL TO authenticated
    USING      (auth_role() = 'ceo_admin')
    WITH CHECK (auth_role() = 'ceo_admin');

-- WHAT: any signed-in session may read the four department names.
-- WHY:  the client portal labels each team member with their department, so
--       the lookup must resolve for client_user too. The four names carry no
--       tenant information, so this is not a leak — but RLS is still ON, so a
--       column added here later stays governed.
--       ('staff' sessions match nothing anywhere else, so a name lookup they
--       can never join to is inert.)
CREATE POLICY departments_read_all_auth ON departments
    FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 4. PROFILES  — people
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS profiles_self_read       ON profiles;
DROP POLICY IF EXISTS profiles_ceo_all         ON profiles;
DROP POLICY IF EXISTS profiles_hr_read         ON profiles;
DROP POLICY IF EXISTS profiles_hr_write        ON profiles;
DROP POLICY IF EXISTS profiles_hr_update       ON profiles;
DROP POLICY IF EXISTS profiles_ops_read        ON profiles;
DROP POLICY IF EXISTS profiles_client_team     ON profiles;

-- WHAT: every signed-in user can read their own profile row.
-- WHY:  THE CRITICAL FIX. Session bootstrap, the persona badge, the role
--       guard on /dashboard/admin and every client-portal query all begin
--       with "SELECT ... FROM profiles WHERE id = auth.uid()". PRD §3 granted
--       no such policy, so that query returned zero rows for client_user and
--       the whole portal rendered empty with no error to explain it.
--       No WITH CHECK / no write verb: a user may READ their own row but must
--       never be able to edit it — self-service `UPDATE profiles SET role =
--       'ceo_admin' WHERE id = auth.uid()` is the classic escalation.
CREATE POLICY profiles_self_read ON profiles
    FOR SELECT TO authenticated
    USING (id = auth.uid());

-- WHAT: full control of all people records.
-- WHY:  the CEO dashboard reads compensation, seat type and lifecycle across
--       the whole company, and is the only role permitted to mint or demote
--       another administrator.
CREATE POLICY profiles_ceo_all ON profiles
    FOR ALL TO authenticated
    USING      (auth_role() = 'ceo_admin')
    WITH CHECK (auth_role() = 'ceo_admin');

-- WHAT: hr_admin reads every profile.
-- WHY:  attrition, time-to-regularization and shrinkage are computed over the
--       full workforce including leavers, so the read cannot be scoped.
CREATE POLICY profiles_hr_read ON profiles
    FOR SELECT TO authenticated
    USING (auth_role() = 'hr_admin');

-- WHAT: hr_admin may create workforce rows, but only inert ones.
-- WHY:  HR onboards people. The WITH CHECK pins the new row to role 'staff',
--       so HR cannot mint a ceo_admin, an ops_manager or a client-portal
--       login for themselves or anyone else. This is the privilege-escalation
--       boundary between "manages employees" and "manages access".
CREATE POLICY profiles_hr_write ON profiles
    FOR INSERT TO authenticated
    WITH CHECK (auth_role() = 'hr_admin' AND role = 'staff');

-- WHAT: hr_admin may edit workforce rows and only workforce rows.
-- WHY:  regularizing, exiting or re-banding an employee is HR's job. USING
--       stops them from touching an admin or portal login at all; WITH CHECK
--       stops them from promoting a workforce row into one on the way out.
CREATE POLICY profiles_hr_update ON profiles
    FOR UPDATE TO authenticated
    USING      (auth_role() = 'hr_admin' AND role = 'staff')
    WITH CHECK (auth_role() = 'hr_admin' AND role = 'staff');

-- WHAT: ops_manager reads every profile, read-only.
-- WHY:  staffing, shift coverage and the billable/non-billable seat split all
--       come from this table. Ops needs to see who sits where; ops does not
--       hire, fire or re-band anyone, so there is no write policy.
--       (Ops sessions can see `hourly_rate_php` — that is intended: seat cost
--       is an input to the utilization panel. Compensation *records* remain
--       out of reach; see payroll_records below.)
CREATE POLICY profiles_ops_read ON profiles
    FOR SELECT TO authenticated
    USING (auth_role() = 'ops_manager');

-- WHAT: a client contact reads the workforce rows assigned to their account.
-- WHY:  PRD §6 "Assigned Team Pod" — the client sees who works for them.
--       Three separate guards, all necessary:
--         auth_role() = 'client_user'  — a 'staff' row also carries a
--             client_id, so a tenant-only check would have let every NorthWinds
--             employee read their colleagues' records.
--         client_id = auth_client_id() — tenant isolation.
--         role = 'staff'               — the client sees the delivery team,
--             not NorthWinds's executives or the other tenants' contacts.
--
--       ⚠ RLS FILTERS ROWS, NOT COLUMNS. These rows still contain
--       `hourly_rate_php`. The portal MUST read the `client_team_pod` view,
--       which exposes only the fields in lib/types.ts :: ClientTeamMember and
--       physically cannot return a pay figure. This row policy exists so that
--       view resolves correctly under security_invoker.
CREATE POLICY profiles_client_team ON profiles
    FOR SELECT TO authenticated
    USING (
        auth_role() = 'client_user'
        AND client_id = auth_client_id()
        AND role = 'staff'
    );

-- ---------------------------------------------------------------------------
-- 5. CLIENT_BILL_RATES  — the commercial rate card
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS bill_rates_ceo_all  ON client_bill_rates;
DROP POLICY IF EXISTS bill_rates_ops_read ON client_bill_rates;

-- WHAT: full control of pricing.
-- WHY:  bill rates are the revenue side of gross margin and the input to the
--       "what-if" simulator. Repricing an account is an executive decision.
CREATE POLICY bill_rates_ceo_all ON client_bill_rates
    FOR ALL TO authenticated
    USING      (auth_role() = 'ceo_admin')
    WITH CHECK (auth_role() = 'ceo_admin');

-- WHAT: ops_manager reads rates, cannot change them.
-- WHY:  utilization is meaningless without revenue per seat — Operations must
--       be able to see which seats earn what. Letting Ops *edit* the rate card
--       would let them move reported margin, so writes stay with the CEO.
CREATE POLICY bill_rates_ops_read ON client_bill_rates
    FOR SELECT TO authenticated
    USING (auth_role() = 'ops_manager');

-- ⛔ NO client_user POLICY, DELIBERATELY.
--    This table is the cross-tenant rate card: one readable row tells a client
--    what NorthWinds charges another client for the same work, and what margin
--    NorthWinds takes on them. Clients see priced invoice line items instead —
--    their own numbers, never the comparison.
-- ⛔ NO hr_admin POLICY: pricing is not an HR concern.
-- ⛔ NO 'staff' POLICY: workforce rows read nothing, anywhere.

-- ---------------------------------------------------------------------------
-- 6. FINANCIAL_INVOICES  — QuickBooks receivables
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS invoices_ceo_all     ON financial_invoices;
DROP POLICY IF EXISTS invoices_client_read ON financial_invoices;

-- WHAT: full control of the receivables ledger.
-- WHY:  cash-flow forecasting and AR ageing are executive functions. WITH
--       CHECK matters here specifically: without it a permitted writer could
--       re-point an invoice at a different client_id and move revenue between
--       tenants.
CREATE POLICY invoices_ceo_all ON financial_invoices
    FOR ALL TO authenticated
    USING      (auth_role() = 'ceo_admin')
    WITH CHECK (auth_role() = 'ceo_admin');

-- WHAT: a client contact reads their own invoices, read-only.
-- WHY:  PRD §6 "Billing & Invoicing Ledger". The role check is not decorative
--       — a bare `client_id = auth_client_id()` would expose every account's
--       invoices to the NorthWinds employees staffed on that account, which is
--       commercial data those employees have no business seeing.
--       No write verb at all: a customer must never be able to mark their own
--       invoice Paid.
CREATE POLICY invoices_client_read ON financial_invoices
    FOR SELECT TO authenticated
    USING (auth_role() = 'client_user' AND client_id = auth_client_id());

-- ⛔ NO hr_admin / ops_manager POLICY: client billing is outside both remits.

-- ---------------------------------------------------------------------------
-- 7. INVOICE_LINE_ITEMS  — what the invoice is made of
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS line_items_ceo_all     ON invoice_line_items;
DROP POLICY IF EXISTS line_items_client_read ON invoice_line_items;

-- WHAT: full control of invoice detail.
-- WHY:  lines must stay consistent with their parent invoice total.
CREATE POLICY line_items_ceo_all ON invoice_line_items
    FOR ALL TO authenticated
    USING      (auth_role() = 'ceo_admin')
    WITH CHECK (auth_role() = 'ceo_admin');

-- WHAT: a client contact reads the lines of their own invoices.
-- WHY:  so the portal can answer "what am I paying for?" instead of showing a
--       single opaque total. Tenancy is resolved through the SECURITY DEFINER
--       helper invoice_client_id() rather than an EXISTS against
--       financial_invoices, so this policy stays correct on its own terms and
--       does not silently inherit whatever the invoice policy happens to say.
CREATE POLICY line_items_client_read ON invoice_line_items
    FOR SELECT TO authenticated
    USING (
        auth_role() = 'client_user'
        AND invoice_client_id(invoice_id) = auth_client_id()
    );

-- ---------------------------------------------------------------------------
-- 8. PRODUCTIVITY_LOGS  — Controlio
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS prod_logs_ceo_all      ON productivity_logs;
DROP POLICY IF EXISTS prod_logs_hr_read      ON productivity_logs;
DROP POLICY IF EXISTS prod_logs_ops_all      ON productivity_logs;
DROP POLICY IF EXISTS prod_logs_client_read  ON productivity_logs;

-- WHAT: full control.
-- WHY:  the staff heatmap and the overtime-vs-productivity burnout flag are
--       CEO-panel features.
CREATE POLICY prod_logs_ceo_all ON productivity_logs
    FOR ALL TO authenticated
    USING      (auth_role() = 'ceo_admin')
    WITH CHECK (auth_role() = 'ceo_admin');

-- WHAT: hr_admin reads all productivity, read-only.
-- WHY:  overtime hours feed the burnout/attrition-risk view HR owns. HR does
--       not operate the Controlio import, so no write.
CREATE POLICY prod_logs_hr_read ON productivity_logs
    FOR SELECT TO authenticated
    USING (auth_role() = 'hr_admin');

-- WHAT: ops_manager reads and writes productivity logs.
-- WHY:  Operations runs the Controlio sync; the idempotency key
--       (user_id, log_date) makes a re-run safe. WITH CHECK is present so a
--       write cannot land in a shape Ops could not have read.
CREATE POLICY prod_logs_ops_all ON productivity_logs
    FOR ALL TO authenticated
    USING      (auth_role() = 'ops_manager')
    WITH CHECK (auth_role() = 'ops_manager');

-- WHAT: a client contact reads productivity for their own team only.
-- WHY:  PRD §6 promises the client "working logs". user_client_id() resolves
--       the staff member's tenant without depending on the caller also being
--       able to read that profile row, so tightening the profiles policy later
--       cannot silently widen or break this one.
CREATE POLICY prod_logs_client_read ON productivity_logs
    FOR SELECT TO authenticated
    USING (
        auth_role() = 'client_user'
        AND user_client_id(user_id) = auth_client_id()
    );

-- ---------------------------------------------------------------------------
-- 9. STAFF_PRESENCE  — live workstation state
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS presence_ceo_all     ON staff_presence;
DROP POLICY IF EXISTS presence_hr_read     ON staff_presence;
DROP POLICY IF EXISTS presence_ops_all     ON staff_presence;
DROP POLICY IF EXISTS presence_client_read ON staff_presence;

-- WHAT: full control of the presence table.
CREATE POLICY presence_ceo_all ON staff_presence
    FOR ALL TO authenticated
    USING      (auth_role() = 'ceo_admin')
    WITH CHECK (auth_role() = 'ceo_admin');

-- WHAT: hr_admin reads presence.
-- WHY:  corroborates absence/shrinkage against filed leave.
CREATE POLICY presence_hr_read ON staff_presence
    FOR SELECT TO authenticated
    USING (auth_role() = 'hr_admin');

-- WHAT: ops_manager reads and writes presence.
-- WHY:  Operations owns real-time floor management and the heartbeat feed.
CREATE POLICY presence_ops_all ON staff_presence
    FOR ALL TO authenticated
    USING      (auth_role() = 'ops_manager')
    WITH CHECK (auth_role() = 'ops_manager');

-- WHAT: a client contact reads presence for their own team.
-- WHY:  PRD §6 — "real-time operational active status (without invasive
--       keystroke monitoring)". The table stores only status/heartbeat/idle
--       minutes precisely so that this grant cannot become surveillance.
CREATE POLICY presence_client_read ON staff_presence
    FOR SELECT TO authenticated
    USING (
        auth_role() = 'client_user'
        AND user_client_id(user_id) = auth_client_id()
    );

-- ---------------------------------------------------------------------------
-- 10. PAYROLL_RECORDS  — JeonSoft compensation
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS payroll_ceo_all ON payroll_records;
DROP POLICY IF EXISTS payroll_hr_all  ON payroll_records;

-- WHAT: full control of payroll.
-- WHY:  net payroll expense is one of the four headline executive KPIs.
CREATE POLICY payroll_ceo_all ON payroll_records
    FOR ALL TO authenticated
    USING      (auth_role() = 'ceo_admin')
    WITH CHECK (auth_role() = 'ceo_admin');

-- WHAT: hr_admin has full control of payroll.
-- WHY:  HR runs the JeonSoft CSV import and owns corrections to it. This is
--       the one place hr_admin outranks ops_manager, and it is intentional:
--       payroll administration is an HR function.
CREATE POLICY payroll_hr_all ON payroll_records
    FOR ALL TO authenticated
    USING      (auth_role() = 'hr_admin')
    WITH CHECK (auth_role() = 'hr_admin');

-- ============================================================================
-- ⛔⛔ CLIENT USERS MUST NEVER READ payroll_records. ⛔⛔
--
-- There is no client_user policy on this table and none may ever be added.
-- With RLS enabled and no matching policy the table is invisible to a portal
-- session — that is the enforcement, not a convention.
--
-- WHY IT MATTERS: a client knowing what NorthWinds pays the staff on their account
-- learns NorthWinds's margin on their own contract, hands them the number in the
-- next renewal negotiation, and exposes named individuals' salaries to a third
-- party. It is a commercial breach and a personal-data breach at once.
--
-- lib/types.ts enforces the same boundary in the type system:
-- `ClientTeamMember` deliberately has no compensation field. If a future panel
-- appears to need pay data in the portal, the answer is a pre-aggregated,
-- non-attributable figure computed server-side — never a policy here.
--
-- ⛔ NO ops_manager POLICY EITHER. Operations manages seats and delivery, not
--    compensation. Ops can already see `profiles.hourly_rate_php` for seat
--    costing; actual payslips, deductions and tax withheld are out of scope.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 11. LEAVE_RECORDS  — absence
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS leave_ceo_all ON leave_records;
DROP POLICY IF EXISTS leave_hr_all  ON leave_records;

-- WHAT: full control of leave.
-- WHY:  absence shrinkage is an input to the executive capacity view.
CREATE POLICY leave_ceo_all ON leave_records
    FOR ALL TO authenticated
    USING      (auth_role() = 'ceo_admin')
    WITH CHECK (auth_role() = 'ceo_admin');

-- WHAT: hr_admin has full control of leave.
-- WHY:  filing, approving and correcting leave is the HR tab's core workflow;
--       the shrinkage metric is computed straight off these rows.
CREATE POLICY leave_hr_all ON leave_records
    FOR ALL TO authenticated
    USING      (auth_role() = 'hr_admin')
    WITH CHECK (auth_role() = 'hr_admin');

-- ⛔ NO client_user POLICY: a named individual's sick days are personal
--    health-adjacent data and are not the client's business. The client sees
--    aggregate coverage through presence and SLA numbers instead.
-- ⛔ NO ops_manager POLICY: leave reasons (sick / emergency) are sensitive
--    personal data. Operations gets the capacity signal it needs from
--    staff_presence and productivity_logs without the reason attached.

-- ---------------------------------------------------------------------------
-- 12. CALLING_METRICS  — SLA and QA
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS calling_ceo_all     ON calling_metrics;
DROP POLICY IF EXISTS calling_ops_all     ON calling_metrics;
DROP POLICY IF EXISTS calling_client_read ON calling_metrics;

-- WHAT: full control of SLA data.
CREATE POLICY calling_ceo_all ON calling_metrics
    FOR ALL TO authenticated
    USING      (auth_role() = 'ceo_admin')
    WITH CHECK (auth_role() = 'ceo_admin');

-- WHAT: ops_manager reads and writes SLA data across all clients.
-- WHY:  Operations owns the Onboarding & Calling tab and the daily metric
--       import; the (client_id, metric_date) key makes re-import idempotent.
CREATE POLICY calling_ops_all ON calling_metrics
    FOR ALL TO authenticated
    USING      (auth_role() = 'ops_manager')
    WITH CHECK (auth_role() = 'ops_manager');

-- WHAT: a client contact reads their own SLA history, read-only.
-- WHY:  PRD §6 — answer rate vs the 95% target, FCR gauge, QA audit score.
--       These numbers are contractual, so the client must never be able to
--       write them, and the role check keeps the staff serving the account
--       from reading the account's scorecard.
CREATE POLICY calling_client_read ON calling_metrics
    FOR SELECT TO authenticated
    USING (auth_role() = 'client_user' AND client_id = auth_client_id());

-- ⛔ NO hr_admin POLICY: client SLA performance is not an HR concern.

-- ============================================================================
-- 13. ROLE 'staff' — INTENTIONALLY ABSENT FROM EVERY POLICY ABOVE
-- ============================================================================
-- Search this file for 'staff' as a *permitted* role and you will find it
-- exactly zero times. That is the design, not an oversight.
--
-- A workforce profile carries the `client_id` of the account that person
-- serves. If workforce rows were left at the PRD's default role of
-- 'client_user', every single NorthWinds employee would have satisfied
-- `client_id = auth_client_id()` and gained the client portal for their own
-- account — invoices, amounts due, SLA scorecards, teammates' records. Sixty
-- accidental tenants.
--
-- Two independent controls prevent that:
--   1. `profiles.role` DEFAULTS to 'staff', so a carelessly inserted row is
--      inert rather than privileged.
--   2. Every portal policy asserts `auth_role() = 'client_user'` in addition
--      to the tenant match, so even a mis-set client_id grants nothing.
--
-- Workforce members also have no usable credential (see seed.sql / README:
-- their auth.users rows carry a NULL password and NULL email_confirmed_at),
-- so in practice they cannot obtain a session at all. The RLS above is the
-- second line of defence, not the only one.
--
-- END policies.sql — apply seed.sql next.
-- ============================================================================
