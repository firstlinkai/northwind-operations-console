-- ============================================================================
-- NORTHWINDS INTERNATIONAL — OPERATIONAL DASHBOARD
-- seed.sql  ·  DATA ONLY
-- ============================================================================
--
-- APPLY AFTER schema.sql AND policies.sql.
--
-- ---------------------------------------------------------------------------
-- WHY THIS FILE IS SO MUCH BIGGER THAN PRD §8
-- ---------------------------------------------------------------------------
-- PRD §8 seeded 4 clients, 4 departments, 4 invoices and ONE day of calling
-- metrics. It seeded ZERO profiles, ZERO productivity logs and ZERO payroll
-- records — yet three of the four headline executive KPIs (headcount, average
-- productivity score, net payroll expense) read from exactly those three empty
-- tables, and every trend line in the product needs a time series, not a
-- single point. The demo could not have rendered.
--
-- This file seeds:
--   *  4 clients, 4 departments
--   *  76 profiles = 60 active workforce + 9 exited workforce + 7 logins
--   * ~90 days of daily productivity logs (weekday-shaped, hire/exit aware)
--   * ~90 days of daily calling metrics for all 4 clients
--   *  7 semi-monthly payroll periods for the whole workforce
--   *  6 months of invoices with a realistic Paid/Overdue/Pending mix and
--      genuine payment lag, plus itemised lines
--   *  versioned bill rates producing a ~39% blended gross margin
--   *  leave at ~3.9% of scheduled days (shrinkage lands in the 3–5% band)
--   *  live presence for every workforce member
--
-- ---------------------------------------------------------------------------
-- HEADCOUNT: 60, NOT 52
-- ---------------------------------------------------------------------------
-- PRD §5 labels the headcount KPI "(52)". The real figure is 60 active staff.
-- Canonical query:
--     SELECT count(*) FROM profiles WHERE role = 'staff' AND exited_at IS NULL;
-- Nine further workforce rows are retained with `exited_at` set so attrition,
-- exits_last_90d and the attrition trend have real history instead of zeroes.
--
-- ---------------------------------------------------------------------------
-- AUTH: HOW 69 NON-LOGIN PEOPLE EXIST IN A TABLE THAT REQUIRES auth.users
-- ---------------------------------------------------------------------------
-- `profiles.id` REFERENCES `auth.users(id)`, but only 7 of these 76 people are
-- meant to sign in. Rather than weaken the FK, every workforce member gets a
-- DISABLED auth.users row:
--     encrypted_password = NULL   -> no password grant is possible
--     email_confirmed_at = NULL   -> unconfirmed, so GoTrue refuses sign-in
--     no auth.identities row      -> no provider linkage of any kind
-- The FK stays intact, cascade delete still works, and the row is unusable as
-- a credential. Their `profiles.role` is 'staff', which appears in zero RLS
-- policies — so even if a session were somehow minted, it would read nothing.
-- See supabase/README.md for the hosted-Supabase alternative.
--
-- ---------------------------------------------------------------------------
-- DETERMINISM
-- ---------------------------------------------------------------------------
-- All "random" variation comes from get_byte(decode(md5(<stable key>),'hex'),n)
-- rather than random(). Two consequences that matter:
--   * `supabase db reset` produces byte-identical data every time, so a demo
--     screenshot taken today still matches the database tomorrow.
--   * Productivity and leave share one hash key per (person, day), so a person
--     is never simultaneously absent and logging eight active hours.
-- Date-anchored data is generated relative to CURRENT_DATE, so the demo never
-- goes stale; fixed history (hire dates, tenure) uses absolute dates.
-- ============================================================================

BEGIN;

-- `crypt()` and `gen_salt()` live in the `extensions` schema on Supabase.
SET LOCAL search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. CLIENTS  (PRD §8 UUIDs and names preserved; `code` added)
-- ---------------------------------------------------------------------------
INSERT INTO clients (id, name, industry, code) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Alder Bay Nursing Group',  'Nursing Placement',        'ALDR'),
    ('22222222-2222-2222-2222-222222222222', 'Kestrel Medical Group',  'Hospital & Medical Care',  'KSTL'),
    ('33333333-3333-3333-3333-333333333333', 'Northlake Telehealth',    'Medical Calling & Triage', 'NLAK'),
    ('44444444-4444-4444-4444-444444444444', 'Ironwood Health Logistics',  'Healthcare Operations',    'IRON')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. DEPARTMENTS  (PRD §8 UUIDs preserved)
-- ---------------------------------------------------------------------------
INSERT INTO departments (id, name) VALUES
    ('d1111111-1111-1111-1111-111111111111', 'HR'),
    ('d2222222-2222-2222-2222-222222222222', 'Operations'),
    ('d3333333-3333-3333-3333-333333333333', 'Onboarding'),
    ('d4444444-4444-4444-4444-444444444444', 'Calling')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. STAGING TABLE FOR PEOPLE
-- ---------------------------------------------------------------------------
-- Staged rather than inserted directly because the same 76 rows have to be
-- written twice — once into auth.users and once into profiles — and holding
-- them in one place keeps the two in lockstep. Client/department are given as
-- code and name; the UUIDs are resolved by join, which keeps the roster
-- readable and makes a mis-typed UUID impossible.
CREATE TEMP TABLE _seed_people (
    id                uuid PRIMARY KEY,
    email             text NOT NULL,
    full_name         text NOT NULL,
    role              user_role NOT NULL,
    client_code       text,
    dept_name         text,
    hourly_rate_php   numeric(10,2) NOT NULL,
    shift             shift_type NOT NULL,
    job_title         text NOT NULL,
    employment_status employment_status NOT NULL,
    seat_type         seat_type NOT NULL,
    hire_date         date NOT NULL,
    regularized_at    date,
    exited_at         date,
    login_password    text            -- non-NULL only for the 7 real logins
) ON COMMIT DROP;

-- 3a. THE SEVEN LOGINS -------------------------------------------------------
-- All seven carry department_id NULL (dept_name NULL below) so that both
-- headcount discriminators — `role = 'staff'` and `department_id IS NOT NULL`
-- — return the same 60 people. Dashboard operators are never counted as seats.
INSERT INTO _seed_people VALUES
('a0000000-0000-4000-8000-000000000001','ceo_admin@northwinds.example',                     'Ramon Villanueva Cruz','ceo_admin',   NULL,  NULL,0.00,'day','Chief Executive Officer',            'regular','non_billable',DATE '2019-01-07',DATE '2019-07-06',NULL,'***REMOVED***'),
('a0000000-0000-4000-8000-000000000002','hr_admin@northwinds.example',                      'Liezl Dominguez',      'hr_admin',    NULL,  NULL,0.00,'day','Human Resources Manager',            'regular','non_billable',DATE '2022-05-09',DATE '2022-11-05',NULL,'***REMOVED***'),
('a0000000-0000-4000-8000-000000000003','ops_manager@northwinds.example',                   'Grace Anne Sarmiento', 'ops_manager', NULL,  NULL,0.00,'mid','Operations Manager',                 'regular','non_billable',DATE '2021-06-14',DATE '2021-12-11',NULL,'***REMOVED***'),
('c0000000-0000-4000-8000-000000000001','client_alderbay@alderbay.example',              'Dana Whitfield',       'client_user','ALDR', NULL,0.00,'day','Director of Nursing Operations',     'regular','non_billable',DATE '2023-02-01',DATE '2023-02-01',NULL,'***REMOVED***'),
('c0000000-0000-4000-8000-000000000002','client_kestrel@kestrelmed.example',         'Gregory Alvarez',      'client_user','KSTL', NULL,0.00,'day','VP, Revenue Cycle',                  'regular','non_billable',DATE '2022-11-15',DATE '2022-11-15',NULL,'***REMOVED***'),
('c0000000-0000-4000-8000-000000000003','client_northlake@northlaketele.example','Priya Raman',          'client_user','NLAK', NULL,0.00,'day','Head of Telehealth Operations',      'regular','non_billable',DATE '2024-03-04',DATE '2024-03-04',NULL,'***REMOVED***'),
('c0000000-0000-4000-8000-000000000004','client_ironwood@ironwoodhealth.example',   'Thomas Beckett',       'client_user','IRON', NULL,0.00,'day','Director of Operations',             'regular','non_billable',DATE '2024-09-16',DATE '2024-09-16',NULL,'***REMOVED***');

-- 3b. ACTIVE WORKFORCE — 60 people, role 'staff', no credentials -------------
--
-- Distribution (deliberate, and each number is load-bearing for a panel):
--   HR 5 | Operations 15 | Onboarding 12 | Calling 28
--   Seats: 52 billable / 8 non-billable  -> 86.7% utilization
--   Client split: ALDR 15 | KSTL 12 | NLAK 18 | IRON 7
--   Shifts: day 15 | mid 15 | night 30
--     The night cohort is half the workforce because these teams cover US
--     healthcare business hours from Manila. It is also what makes the
--     statutory 10% night differential a material payroll line rather than a
--     rounding error, which is the point of the margin simulator's
--     night_shift_ratio slider.
--   Status: 51 regular / 9 probationary. Probationary hires are anchored to
--     CURRENT_DATE so "hires last 90 days" is never zero on a stale database.
--   Rates: PHP 170–420/hr. Entry patient-access work sits near the Ironwood
--     Manila BPO floor; licensed RNs on US telehealth triage command the top
--     of the band.

-- HR (5) — internal overhead, no client, day shift
INSERT INTO _seed_people VALUES
('e0000000-0000-4000-8000-000000000001','maria.alcantara@northwinds.example',    'Maria Corazon Alcantara','staff',NULL,'HR',260.00,'day','HR Generalist',                  'regular',     'non_billable',DATE '2023-03-06',DATE '2023-09-02',NULL,NULL),
('e0000000-0000-4000-8000-000000000002','jomarie.bautista@northwinds.example',   'Jomarie Bautista',       'staff',NULL,'HR',235.00,'day','Recruitment Specialist',         'regular',     'non_billable',DATE '2024-01-15',DATE '2024-07-13',NULL,NULL),
('e0000000-0000-4000-8000-000000000003','kristine.marasigan@northwinds.example', 'Kristine Joy Marasigan', 'staff',NULL,'HR',285.00,'day','Compensation & Benefits Analyst','regular',     'non_billable',DATE '2023-08-21',DATE '2024-02-17',NULL,NULL),
('e0000000-0000-4000-8000-000000000004','aldrin.paguio@northwinds.example',      'Aldrin Paguio',          'staff',NULL,'HR',190.00,'day','HR Assistant',                   'probationary','non_billable',CURRENT_DATE - 113,NULL,NULL,NULL),
('e0000000-0000-4000-8000-000000000005','michelle.yabut@northwinds.example',     'Michelle Anne Yabut',    'staff',NULL,'HR',270.00,'day','Employee Relations Officer',     'regular',     'non_billable',DATE '2022-11-14',DATE '2023-05-13',NULL,NULL);

-- Operations (15) — 3 non-billable internal, 12 billable across all 4 clients
INSERT INTO _seed_people VALUES
('e0000000-0000-4000-8000-000000000006','rafael.ocampo@northwinds.example',      'Rafael Ocampo',           'staff',NULL,  'Operations',300.00,'day',  'Workforce Analyst',           'regular',     'non_billable',DATE '2023-10-02',DATE '2024-03-30',NULL,NULL),
('e0000000-0000-4000-8000-000000000007','bernadette.yu@northwinds.example',      'Bernadette Yu',           'staff',NULL,  'Operations',265.00,'night','IT Support Specialist',       'regular',     'non_billable',DATE '2024-05-06',DATE '2024-11-02',NULL,NULL),
('e0000000-0000-4000-8000-000000000008','noel.villaruz@northwinds.example',      'Noel Villaruz',           'staff',NULL,  'Operations',210.00,'day',  'Facilities & Admin Officer',  'regular',     'non_billable',DATE '2023-02-13',DATE '2023-08-12',NULL,NULL),
('e0000000-0000-4000-8000-000000000009','carlo.mendoza@northwinds.example',      'Carlo Mendoza',           'staff','ALDR','Operations',355.00,'day',  'Operations Team Lead',        'regular',     'billable',    DATE '2022-09-05',DATE '2023-03-04',NULL,NULL),
('e0000000-0000-4000-8000-000000000010','jennifer.rosales@northwinds.example',   'Jennifer Rosales',        'staff','ALDR','Operations',275.00,'night','Credentialing Specialist',    'regular',     'billable',    DATE '2024-02-19',DATE '2024-08-17',NULL,NULL),
('e0000000-0000-4000-8000-000000000011','mark.dizon@northwinds.example',         'Mark Anthony Dizon',      'staff','ALDR','Operations',245.00,'night','Scheduling Coordinator',      'regular',     'billable',    DATE '2024-09-02',DATE '2025-03-01',NULL,NULL),
('e0000000-0000-4000-8000-000000000012','aileen.salvador@northwinds.example',    'Aileen Salvador',         'staff','KSTL','Operations',350.00,'day',  'Operations Team Lead',        'regular',     'billable',    DATE '2023-01-09',DATE '2023-07-08',NULL,NULL),
('e0000000-0000-4000-8000-000000000013','patrick.ilagan@northwinds.example',     'Patrick Ilagan',          'staff','KSTL','Operations',290.00,'mid',  'Medical Billing Analyst',     'regular',     'billable',    DATE '2024-06-03',DATE '2024-11-30',NULL,NULL),
('e0000000-0000-4000-8000-000000000014','rowena.castillo@northwinds.example',    'Rowena Castillo',         'staff','KSTL','Operations',240.00,'night','Claims Processor',            'regular',     'billable',    DATE '2025-02-10',DATE '2025-08-09',NULL,NULL),
('e0000000-0000-4000-8000-000000000015','denise.fajardo@northwinds.example',     'Denise Fajardo',          'staff','NLAK','Operations',360.00,'mid',  'Operations Team Lead',        'regular',     'billable',    DATE '2022-11-07',DATE '2023-05-06',NULL,NULL),
('e0000000-0000-4000-8000-000000000016','joseph.tan@northwinds.example',         'Joseph Emmanuel Tan',     'staff','NLAK','Operations',320.00,'night','Utilization Review Analyst',  'regular',     'billable',    DATE '2024-08-05',DATE '2025-02-01',NULL,NULL),
('e0000000-0000-4000-8000-000000000017','charmaine.lopez@northwinds.example',    'Charmaine Lopez',         'staff','NLAK','Operations',235.00,'mid',  'Workforce Scheduler',         'probationary','billable',    CURRENT_DATE - 148,NULL,NULL,NULL),
('e0000000-0000-4000-8000-000000000018','vincent.lagman@northwinds.example',     'Vincent Lagman',          'staff','NLAK','Operations',305.00,'mid',  'Clinical Data Analyst',       'regular',     'billable',    DATE '2025-03-17',DATE '2025-09-13',NULL,NULL),
('e0000000-0000-4000-8000-000000000019','ferdinand.aquino@northwinds.example',   'Ferdinand Aquino',        'staff','IRON','Operations',285.00,'day',  'Logistics Operations Analyst','regular',     'billable',    DATE '2023-05-15',DATE '2023-11-11',NULL,NULL),
('e0000000-0000-4000-8000-000000000020','rhea.buenaventura@northwinds.example',  'Rhea Mae Buenaventura',   'staff','IRON','Operations',225.00,'mid',  'Supply Coordinator',          'regular',     'billable',    DATE '2025-04-07',DATE '2025-10-04',NULL,NULL);

-- Onboarding (12) — all billable
INSERT INTO _seed_people VALUES
('e0000000-0000-4000-8000-000000000021','michelle.ramos@northwinds.example',     'Michelle Ann Ramos',    'staff','ALDR','Onboarding',250.00,'day',  'Onboarding Specialist',            'regular',     'billable',DATE '2023-07-03',DATE '2023-12-30',NULL,NULL),
('e0000000-0000-4000-8000-000000000022','kevin.estrada@northwinds.example',      'Kevin Estrada',         'staff','ALDR','Onboarding',265.00,'night','Credentialing Onboarding Analyst', 'regular',     'billable',DATE '2024-10-07',DATE '2025-04-05',NULL,NULL),
('e0000000-0000-4000-8000-000000000023','trisha.villamor@northwinds.example',    'Trisha Mae Villamor',   'staff','ALDR','Onboarding',195.00,'night','Onboarding Associate',             'probationary','billable',CURRENT_DATE - 85,NULL,NULL,NULL),
('e0000000-0000-4000-8000-000000000024','ronaldo.gutierrez@northwinds.example',  'Ronaldo Gutierrez',     'staff','KSTL','Onboarding',330.00,'day',  'Onboarding Team Lead',             'regular',     'billable',DATE '2022-08-01',DATE '2023-01-28',NULL,NULL),
('e0000000-0000-4000-8000-000000000025','annaliza.pineda@northwinds.example',    'Anna Liza Pineda',      'staff','KSTL','Onboarding',270.00,'mid',  'Provider Enrollment Specialist',   'regular',     'billable',DATE '2024-03-11',DATE '2024-09-07',NULL,NULL),
('e0000000-0000-4000-8000-000000000026','dexter.manalo@northwinds.example',      'Dexter Manalo',         'staff','KSTL','Onboarding',205.00,'mid',  'Onboarding Associate',             'regular',     'billable',DATE '2025-06-02',DATE '2025-11-29',NULL,NULL),
('e0000000-0000-4000-8000-000000000027','katrina.bernardo@northwinds.example',   'Katrina Bernardo',      'staff','NLAK','Onboarding',255.00,'mid',  'Onboarding Specialist',            'regular',     'billable',DATE '2023-11-06',DATE '2024-05-04',NULL,NULL),
('e0000000-0000-4000-8000-000000000028','gerald.espiritu@northwinds.example',    'Gerald Espiritu',       'staff','NLAK','Onboarding',300.00,'night','Training & Onboarding Coach',      'regular',     'billable',DATE '2024-04-15',DATE '2024-10-12',NULL,NULL),
('e0000000-0000-4000-8000-000000000029','precious.navarro@northwinds.example',   'Precious Joy Navarro',  'staff','NLAK','Onboarding',200.00,'night','Onboarding Associate',             'probationary','billable',CURRENT_DATE - 162,NULL,NULL,NULL),
('e0000000-0000-4000-8000-000000000030','jomar.sandoval@northwinds.example',     'Jomar Sandoval',        'staff','NLAK','Onboarding',215.00,'night','Provider Enrollment Associate',    'regular',     'billable',DATE '2025-05-05',DATE '2025-11-01',NULL,NULL),
('e0000000-0000-4000-8000-000000000031','arnel.sison@northwinds.example',        'Arnel Sison',           'staff','IRON','Onboarding',245.00,'day',  'Onboarding Analyst',               'regular',     'billable',DATE '2024-12-02',DATE '2025-05-31',NULL,NULL),
('e0000000-0000-4000-8000-000000000032','camille.reyes@northwinds.example',      'Camille Reyes',         'staff','IRON','Onboarding',190.00,'mid',  'Onboarding Associate',             'regular',     'billable',DATE '2025-08-04',DATE '2026-01-31',NULL,NULL);

-- Calling (28) — all billable; the night-heavy US-facing floor
INSERT INTO _seed_people VALUES
('e0000000-0000-4000-8000-000000000033','cristina.delossantos@northwinds.example','Ma. Cristina Delos Santos','staff','ALDR','Calling',420.00,'night','Registered Nurse (RN)',        'regular',     'billable',DATE '2022-04-04',DATE '2022-10-01',NULL,NULL),
('e0000000-0000-4000-8000-000000000034','jerome.pascual@northwinds.example',      'Jerome Pascual',           'staff','ALDR','Calling',405.00,'night','Registered Nurse (RN)',        'regular',     'billable',DATE '2023-02-06',DATE '2023-08-05',NULL,NULL),
('e0000000-0000-4000-8000-000000000035','angelica.bathan@northwinds.example',     'Angelica Bathan',          'staff','ALDR','Calling',185.00,'night','Patient Access Representative','regular',     'billable',DATE '2024-07-01',DATE '2024-12-28',NULL,NULL),
('e0000000-0000-4000-8000-000000000036','ryan.uy@northwinds.example',             'Ryan Christopher Uy',      'staff','ALDR','Calling',180.00,'night','Patient Access Representative','regular',     'billable',DATE '2025-01-06',DATE '2025-07-05',NULL,NULL),
('e0000000-0000-4000-8000-000000000037','shiela.cabrera@northwinds.example',      'Shiela Marie Cabrera',     'staff','ALDR','Calling',265.00,'night','Triage Coordinator',           'regular',     'billable',DATE '2024-11-04',DATE '2025-05-03',NULL,NULL),
('e0000000-0000-4000-8000-000000000038','emmanuel.robles@northwinds.example',     'Emmanuel Robles',          'staff','ALDR','Calling',230.00,'mid',  'Care Coordinator',             'regular',     'billable',DATE '2025-03-03',DATE '2025-08-30',NULL,NULL),
('e0000000-0000-4000-8000-000000000039','jasmine.delrosario@northwinds.example',  'Jasmine Del Rosario',      'staff','ALDR','Calling',175.00,'night','Patient Access Representative','probationary','billable',CURRENT_DATE - 106,NULL,NULL,NULL),
('e0000000-0000-4000-8000-000000000040','nikko.abundo@northwinds.example',        'Nikko Abundo',             'staff','ALDR','Calling',295.00,'mid',  'Quality Assurance Analyst',    'regular',     'billable',DATE '2024-01-08',DATE '2024-07-06',NULL,NULL),
('e0000000-0000-4000-8000-000000000041','lorraine.panganiban@northwinds.example', 'Lorraine Panganiban',      'staff','ALDR','Calling',340.00,'night','Team Lead, Calling',           'regular',     'billable',DATE '2023-06-05',DATE '2023-12-02',NULL,NULL),
('e0000000-0000-4000-8000-000000000042','renato.lacsamana@northwinds.example',    'Renato Lacsamana',         'staff','KSTL','Calling',400.00,'night','Registered Nurse (RN)',        'regular',     'billable',DATE '2023-04-03',DATE '2023-09-30',NULL,NULL),
('e0000000-0000-4000-8000-000000000043','marygrace.tolentino@northwinds.example', 'Mary Grace Tolentino',     'staff','KSTL','Calling',180.00,'night','Patient Access Representative','regular',     'billable',DATE '2024-08-12',DATE '2025-02-08',NULL,NULL),
('e0000000-0000-4000-8000-000000000044','christian.delapena@northwinds.example',  'Christian Dela Pena',      'staff','KSTL','Calling',170.00,'mid',  'Medical Records Clerk',        'regular',     'billable',DATE '2025-05-05',DATE '2025-11-01',NULL,NULL),
('e0000000-0000-4000-8000-000000000045','abigail.santiago@northwinds.example',    'Abigail Santiago',         'staff','KSTL','Calling',260.00,'night','Triage Coordinator',           'regular',     'billable',DATE '2024-05-13',DATE '2024-11-09',NULL,NULL),
('e0000000-0000-4000-8000-000000000046','paolo.rivera@northwinds.example',        'Paolo Miguel Rivera',      'staff','KSTL','Calling',178.00,'night','Patient Access Representative','probationary','billable',CURRENT_DATE - 134,NULL,NULL,NULL),
('e0000000-0000-4000-8000-000000000047','divina.aguilar@northwinds.example',      'Divina Grace Aguilar',     'staff','KSTL','Calling',335.00,'mid',  'Team Lead, Calling',           'regular',     'billable',DATE '2022-10-03',DATE '2023-04-01',NULL,NULL),
('e0000000-0000-4000-8000-000000000048','theresa.villafuerte@northwinds.example', 'Ma. Theresa Villafuerte',  'staff','NLAK','Calling',415.00,'night','Registered Nurse (RN)',        'regular',     'billable',DATE '2022-06-06',DATE '2022-12-03',NULL,NULL),
('e0000000-0000-4000-8000-000000000049','jomar.enriquez@northwinds.example',      'Jomar Enriquez',           'staff','NLAK','Calling',395.00,'night','Registered Nurse (RN)',        'regular',     'billable',DATE '2023-09-04',DATE '2024-03-02',NULL,NULL),
('e0000000-0000-4000-8000-000000000050','kimberly.andrada@northwinds.example',    'Kimberly Andrada',         'staff','NLAK','Calling',380.00,'night','Telehealth Triage Nurse',      'regular',     'billable',DATE '2024-02-05',DATE '2024-08-03',NULL,NULL),
('e0000000-0000-4000-8000-000000000051','arjay.mercado@northwinds.example',       'Arjay Mercado',            'staff','NLAK','Calling',182.00,'night','Patient Access Representative','regular',     'billable',DATE '2024-10-14',DATE '2025-04-12',NULL,NULL),
('e0000000-0000-4000-8000-000000000052','hazel.bituin@northwinds.example',        'Hazel Ann Bituin',         'staff','NLAK','Calling',178.00,'night','Patient Access Representative','regular',     'billable',DATE '2025-02-03',DATE '2025-08-02',NULL,NULL),
('e0000000-0000-4000-8000-000000000053','francis.padilla@northwinds.example',     'Francis Lorenzo Padilla',  'staff','NLAK','Calling',235.00,'mid',  'Care Coordinator',             'regular',     'billable',DATE '2025-07-07',DATE '2026-01-03',NULL,NULL),
('e0000000-0000-4000-8000-000000000054','melanie.cabatingan@northwinds.example',  'Melanie Cabatingan',       'staff','NLAK','Calling',290.00,'day',  'Quality Assurance Analyst',    'regular',     'billable',DATE '2023-12-04',DATE '2024-06-01',NULL,NULL),
('e0000000-0000-4000-8000-000000000055','dennis.almonte@northwinds.example',      'Dennis Almonte',           'staff','NLAK','Calling',176.00,'night','Patient Access Representative','probationary','billable',CURRENT_DATE - 71,NULL,NULL,NULL),
('e0000000-0000-4000-8000-000000000056','rowell.cortez@northwinds.example',       'Rowell Cortez',            'staff','NLAK','Calling',174.00,'night','Patient Access Representative','probationary','billable',CURRENT_DATE - 57,NULL,NULL,NULL),
('e0000000-0000-4000-8000-000000000057','sarahjane.montemayor@northwinds.example','Sarah Jane Montemayor',    'staff','NLAK','Calling',345.00,'night','Team Lead, Calling',           'regular',     'billable',DATE '2023-03-13',DATE '2023-09-09',NULL,NULL),
('e0000000-0000-4000-8000-000000000058','leonora.bagsic@northwinds.example',      'Leonora Bagsic',           'staff','IRON','Calling',225.00,'mid',  'Dispatch Coordinator',         'regular',     'billable',DATE '2024-06-17',DATE '2024-12-14',NULL,NULL),
('e0000000-0000-4000-8000-000000000059','jayson.trinidad@northwinds.example',     'Jayson Trinidad',          'staff','IRON','Calling',195.00,'night','Patient Transport Scheduler',  'regular',     'billable',DATE '2025-10-06',DATE '2026-04-04',NULL,NULL),
('e0000000-0000-4000-8000-000000000060','ruby.mangahas@northwinds.example',       'Ruby Anne Mangahas',       'staff','IRON','Calling',185.00,'day',  'Customer Support Associate',   'probationary','billable',CURRENT_DATE - 43,NULL,NULL,NULL);

-- 3c. EXITED WORKFORCE — 9 people ------------------------------------------
-- Retained (not deleted) so the HR tab has real attrition history: 5 of these
-- exits fall inside the trailing 90 days, and two were terminated while still
-- probationary (regularized_at NULL) — the shape that makes
-- "avg days to regularization" honest, because it must exclude them.
INSERT INTO _seed_people VALUES
('e0000000-0000-4000-8000-000000000061','rodel.ignacio@northwinds.example',    'Rodel Ignacio',           'staff','NLAK','Calling',   178.00,'night','Patient Access Representative','resigned',  'billable',    DATE '2024-09-02',DATE '2025-03-01',CURRENT_DATE - 42, NULL),
('e0000000-0000-4000-8000-000000000062','cherrylyn.obregon@northwinds.example','Cherry Lyn Obregon',      'staff','KSTL','Onboarding',195.00,'mid',  'Onboarding Associate',        'resigned',  'billable',    DATE '2025-01-13',DATE '2025-07-12',CURRENT_DATE - 71, NULL),
('e0000000-0000-4000-8000-000000000063','michael.sarmiento@northwinds.example','Michael Angelo Sarmiento','staff','ALDR','Calling',   180.00,'night','Patient Access Representative','terminated','billable',    DATE '2025-04-14',DATE '2025-10-11',CURRENT_DATE - 25, NULL),
('e0000000-0000-4000-8000-000000000064','jocelyn.ferrer@northwinds.example',   'Jocelyn Ferrer',          'staff','IRON','Operations',235.00,'day',  'Claims Processor',            'resigned',  'billable',    DATE '2023-11-06',DATE '2024-05-04',CURRENT_DATE - 88, NULL),
-- Terminated during probation, so regularized_at stays NULL. Hire dates for
-- these two are CURRENT_DATE-relative to guarantee hire < exit < 180 days
-- whenever the seed is run.
('e0000000-0000-4000-8000-000000000065','allan.bacani@northwinds.example',     'Allan Rey Bacani',        'staff','NLAK','Calling',   228.00,'night','Care Coordinator',            'terminated','billable',    CURRENT_DATE - 204,NULL,             CURRENT_DATE - 110,NULL),
('e0000000-0000-4000-8000-000000000066','marilou.espinosa@northwinds.example', 'Marilou Espinosa',        'staff',NULL,  'HR',        240.00,'day',  'Recruitment Specialist',      'resigned',  'non_billable',DATE '2022-07-04',DATE '2023-01-02',CURRENT_DATE - 130,NULL),
('e0000000-0000-4000-8000-000000000067','edgardo.ramirez@northwinds.example',  'Edgardo Ramirez',         'staff','ALDR','Calling',   255.00,'night','Triage Coordinator',          'resigned',  'billable',    DATE '2023-08-07',DATE '2024-02-03',CURRENT_DATE - 58, NULL),
('e0000000-0000-4000-8000-000000000068','kathleen.verzosa@northwinds.example', 'Kathleen Joy Verzosa',    'staff','NLAK','Onboarding',200.00,'night','Onboarding Associate',        'resigned',  'billable',    DATE '2025-02-17',DATE '2025-08-16',CURRENT_DATE - 96, NULL),
('e0000000-0000-4000-8000-000000000069','bryan.odulio@northwinds.example',     'Bryan Christopher Odulio','staff','KSTL','Calling',   176.00,'mid',  'Patient Access Representative','terminated','billable',    CURRENT_DATE - 240,NULL,             CURRENT_DATE - 77, NULL);

-- ---------------------------------------------------------------------------
-- 4. AUTH USERS
-- ---------------------------------------------------------------------------
-- Seven real logins (bcrypt password, email confirmed) and 69 disabled rows
-- (NULL password, NULL confirmation) so the profiles FK is satisfiable without
-- creating 69 sign-in-capable accounts. GoTrue rejects both a NULL-password
-- grant and an unconfirmed email, so a workforce row has no path to a session.
INSERT INTO auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
)
SELECT
    '00000000-0000-0000-0000-000000000000',
    p.id,
    'authenticated',
    'authenticated',
    p.email,
    CASE WHEN p.login_password IS NOT NULL
         THEN crypt(p.login_password, gen_salt('bf'))
         END,
    CASE WHEN p.login_password IS NOT NULL THEN now() END,
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', p.full_name, 'northwinds_role', p.role::text),
    now(), now(),
    '', '', '', ''
FROM _seed_people p
ON CONFLICT (id) DO NOTHING;

-- Identity rows for the seven logins only. Column layout differs across GoTrue
-- versions (`provider_id` was added in 2023), so branch on what is present.
DO $do$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'auth' AND table_name = 'identities'
          AND column_name = 'provider_id'
    ) THEN
        EXECUTE $q$
            INSERT INTO auth.identities (
                id, user_id, provider_id, identity_data, provider,
                last_sign_in_at, created_at, updated_at)
            SELECT gen_random_uuid(), p.id, p.id::text,
                   jsonb_build_object('sub', p.id::text, 'email', p.email,
                                      'email_verified', true, 'phone_verified', false),
                   'email', now(), now(), now()
            FROM _seed_people p
            WHERE p.login_password IS NOT NULL
            ON CONFLICT DO NOTHING;
        $q$;
    ELSE
        EXECUTE $q$
            INSERT INTO auth.identities (
                id, user_id, identity_data, provider,
                last_sign_in_at, created_at, updated_at)
            SELECT p.id::text, p.id,
                   jsonb_build_object('sub', p.id::text, 'email', p.email),
                   'email', now(), now(), now()
            FROM _seed_people p
            WHERE p.login_password IS NOT NULL
            ON CONFLICT DO NOTHING;
        $q$;
    END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 5. PROFILES
-- ---------------------------------------------------------------------------
-- `is_night_shift` is deliberately omitted — the sync_night_shift() trigger
-- derives it from `shift`, so the two can never disagree.
INSERT INTO profiles (
    id, email, full_name, role, client_id, department_id,
    hourly_rate_php, shift, job_title, employment_status, seat_type,
    hire_date, regularized_at, exited_at, created_at)
SELECT
    p.id, p.email, p.full_name, p.role, c.id, d.id,
    p.hourly_rate_php, p.shift, p.job_title, p.employment_status, p.seat_type,
    p.hire_date, p.regularized_at, p.exited_at,
    p.hire_date::timestamptz + INTERVAL '9 hours'
FROM _seed_people p
LEFT JOIN clients     c ON c.code = p.client_code
LEFT JOIN departments d ON d.name::text = p.dept_name
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. CLIENT BILL RATES  (revenue per billable seat, per month, in USD)
-- ---------------------------------------------------------------------------
-- Two versions per (client, department): a 2025 rate and the current 2026 rate
-- after a ~7.5% uplift, so the simulator's "vs. current pricing" multiplier has
-- a real baseline and the rate card demonstrably versions over time.
--
-- CALIBRATION — these numbers were chosen to land the blended gross margin in
-- the 35–45% band a healthcare BPO would actually report:
--   Revenue  : 52 billable seats at these rates  ~= USD 91.6k / month
--   Cost     : PHP 2.94M gross payroll (incl. night differential + overtime)
--              plus ~10% employer statutory share, at PHP 58.5/USD
--                                                  ~= USD 55.4k / month
--   Gross margin                                   ~= 39%
-- Calling seats are the cheapest per head and the most numerous; Operations
-- seats carry analyst-grade work and price highest. Northlake gets the keenest
-- Calling rate because it buys the most volume.
INSERT INTO client_bill_rates (client_id, department_id, monthly_rate_usd, effective_from)
SELECT c.id, d.id, r.rate, r.eff
FROM (VALUES
    -- current rate card
    ('ALDR','Operations',2000.00, DATE '2026-01-01'),
    ('ALDR','Onboarding',1850.00, DATE '2026-01-01'),
    ('ALDR','Calling',   1700.00, DATE '2026-01-01'),
    ('KSTL','Operations',1950.00, DATE '2026-01-01'),
    ('KSTL','Onboarding',1800.00, DATE '2026-01-01'),
    ('KSTL','Calling',   1740.00, DATE '2026-01-01'),
    ('NLAK','Operations',2050.00, DATE '2026-01-01'),
    ('NLAK','Onboarding',1900.00, DATE '2026-01-01'),
    ('NLAK','Calling',   1500.00, DATE '2026-01-01'),
    ('IRON','Operations',1920.00, DATE '2026-01-01'),
    ('IRON','Onboarding',1760.00, DATE '2026-01-01'),
    ('IRON','Calling',   1620.00, DATE '2026-01-01'),
    -- prior-year rate card (superseded)
    ('ALDR','Operations',1860.00, DATE '2025-01-01'),
    ('ALDR','Onboarding',1720.00, DATE '2025-01-01'),
    ('ALDR','Calling',   1580.00, DATE '2025-01-01'),
    ('KSTL','Operations',1815.00, DATE '2025-01-01'),
    ('KSTL','Onboarding',1675.00, DATE '2025-01-01'),
    ('KSTL','Calling',   1620.00, DATE '2025-01-01'),
    ('NLAK','Operations',1905.00, DATE '2025-01-01'),
    ('NLAK','Onboarding',1770.00, DATE '2025-01-01'),
    ('NLAK','Calling',   1395.00, DATE '2025-01-01'),
    ('IRON','Operations',1785.00, DATE '2025-01-01'),
    ('IRON','Onboarding',1635.00, DATE '2025-01-01'),
    ('IRON','Calling',   1505.00, DATE '2025-01-01')
) AS r(code, dept, rate, eff)
JOIN clients     c ON c.code = r.code
JOIN departments d ON d.name::text = r.dept
ON CONFLICT (client_id, department_id, effective_from) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. STAFF PRESENCE  (live workstation state for the heatmap + team pod)
-- ---------------------------------------------------------------------------
-- ~70% active / ~20% idle / ~10% offline for current staff; leavers are always
-- offline. Coarse by design — PRD §6 forbids keystroke-level detail.
INSERT INTO staff_presence (user_id, status, last_heartbeat, idle_minutes)
SELECT
    p.id,
    CASE WHEN p.exited_at IS NOT NULL THEN 'offline'::presence_status
         WHEN get_byte(x.h, 0) < 180  THEN 'active'::presence_status
         WHEN get_byte(x.h, 0) < 231  THEN 'idle'::presence_status
         ELSE                              'offline'::presence_status
    END,
    CASE WHEN p.exited_at IS NOT NULL
         THEN p.exited_at::timestamptz + INTERVAL '18 hours'
         WHEN get_byte(x.h, 0) < 180
         THEN now() - make_interval(mins => (get_byte(x.h, 1) % 4))
         WHEN get_byte(x.h, 0) < 231
         THEN now() - make_interval(mins => 15 + (get_byte(x.h, 1) % 40))
         ELSE now() - make_interval(hours => 6 + (get_byte(x.h, 1) % 12))
    END,
    CASE WHEN p.exited_at IS NOT NULL THEN 0
         WHEN get_byte(x.h, 0) < 180  THEN (get_byte(x.h, 2) % 6)
         WHEN get_byte(x.h, 0) < 231  THEN 15 + (get_byte(x.h, 2) % 40)
         ELSE 0
    END
FROM profiles p
CROSS JOIN LATERAL (SELECT decode(md5(p.id::text || 'presence'), 'hex') AS h) x
WHERE p.role = 'staff'
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. PRODUCTIVITY LOGS  (Controlio — ~90 days)
-- ---------------------------------------------------------------------------
-- PRD §8 seeded none of these at all, so the "Average Operational Productivity
-- Score" KPI and every trend line had nothing to read.
--
-- generate_series over the last 90 days, gated so the data is defensible:
--   * Sundays excluded — the floor runs Mon–Sat.
--   * A log only exists on or after a person's hire_date and on or before
--     their exit, so a new hire's chart starts where they actually started.
--   * Days on which the shared (person, day) hash fires a leave record are
--     skipped, so nobody is on sick leave and logging eight active hours.
INSERT INTO productivity_logs (
    user_id, log_date, active_hours, idle_hours, productivity_score, overtime_hours)
SELECT
    p.id,
    g.ts::date,
    ROUND(6.20 + (get_byte(x.h, 0) % 181) / 100.0, 2),
    ROUND(0.30 + (get_byte(x.h, 1) % 121) / 100.0, 2),
    ROUND((68 + (get_byte(x.h, 2) % 30)
              + CASE WHEN p.employment_status = 'probationary' THEN -4 ELSE 0 END
              + CASE WHEN p.shift = 'night' THEN 1 ELSE 0 END)::numeric, 2),
    CASE WHEN get_byte(x.h, 3) < 64
         THEN ROUND((get_byte(x.h, 4) % 26) / 10.0, 2)
         ELSE 0 END
FROM profiles p
-- Explicit ::timestamp casts: a bare `date` argument is implicitly castable to
-- both timestamp and timestamptz, so the pinned cast removes any dependence on
-- overload resolution (and on the session timezone) when ts is cast back.
CROSS JOIN LATERAL generate_series(
        (CURRENT_DATE - 90)::timestamp,
        (CURRENT_DATE - 1)::timestamp,
        INTERVAL '1 day') AS g(ts)
CROSS JOIN LATERAL (
        SELECT decode(md5(p.id::text || g.ts::date::text || 'northwinds'), 'hex') AS h) x
WHERE p.role = 'staff'
  AND EXTRACT(DOW FROM g.ts) <> 0                       -- no Sundays
  AND g.ts::date >= p.hire_date
  AND g.ts::date <= COALESCE(p.exited_at, CURRENT_DATE)
  AND get_byte(x.h, 5) >= 10                            -- not a leave day
ON CONFLICT (user_id, log_date) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 9. LEAVE RECORDS  (HR shrinkage)
-- ---------------------------------------------------------------------------
-- Same (person, day) hash as section 8, inverted: a day is a leave day when
-- byte 5 < 10, i.e. 10/256 = 3.9% of scheduled days. Weighted toward 8-hour
-- absences, so shrinkage lands around 3.6% — inside the 3–5% band a BPO would
-- plan capacity against.
-- `absent_no_notice` is the only type left unapproved; it is also the rarest,
-- which is what makes it worth flagging in the HR tab.
INSERT INTO leave_records (user_id, leave_date, leave_type, hours, is_approved)
SELECT
    p.id,
    g.ts::date,
    (CASE WHEN get_byte(x.h, 6) <  92 THEN 'sick'
          WHEN get_byte(x.h, 6) < 172 THEN 'vacation'
          WHEN get_byte(x.h, 6) < 212 THEN 'emergency'
          WHEN get_byte(x.h, 6) < 238 THEN 'unpaid'
          ELSE 'absent_no_notice' END)::leave_type,
    CASE WHEN get_byte(x.h, 7) < 205 THEN 8.00 ELSE 4.00 END,
    (get_byte(x.h, 6) < 238)
FROM profiles p
-- Explicit ::timestamp casts: a bare `date` argument is implicitly castable to
-- both timestamp and timestamptz, so the pinned cast removes any dependence on
-- overload resolution (and on the session timezone) when ts is cast back.
CROSS JOIN LATERAL generate_series(
        (CURRENT_DATE - 90)::timestamp,
        (CURRENT_DATE - 1)::timestamp,
        INTERVAL '1 day') AS g(ts)
CROSS JOIN LATERAL (
        SELECT decode(md5(p.id::text || g.ts::date::text || 'northwinds'), 'hex') AS h) x
WHERE p.role = 'staff'
  AND EXTRACT(DOW FROM g.ts) <> 0
  AND g.ts::date >= p.hire_date
  AND g.ts::date <= COALESCE(p.exited_at, CURRENT_DATE)
  AND get_byte(x.h, 5) < 10
ON CONFLICT (user_id, leave_date, leave_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 10. PAYROLL RECORDS  (JeonSoft — semi-monthly, ~7 closed periods)
-- ---------------------------------------------------------------------------
-- Philippine practice: paid on the 15th and the last day of the month, so each
-- period is ~87 billable hours (half of the 174-hour month in lib/types.ts).
--
-- Deductions follow the real statutory structure so the numbers survive a
-- CFO glancing at them, without pretending to be a compliant payroll engine:
--   SSS        4.5% of gross, capped
--   PhilHealth 2.5% of gross, capped
--   Pag-IBIG   flat PHP 100 per period
--   Withholding 15% of the excess over the PHP 10,417 semi-monthly exemption
--   Night differential 10% of gross for night-shift staff (NIGHT_DIFF_PREMIUM)
-- Only periods that have actually closed (pay_period_end <= today) are seeded,
-- and only for people employed during that period.
INSERT INTO payroll_records (
    user_id, pay_period_start, pay_period_end,
    gross_pay_php, night_diff_php, overtime_pay_php,
    sss_deduction_php, philhealth_deduction_php, pagibig_deduction_php,
    tax_withheld_php, net_pay_php)
SELECT
    p.id, pr.ps, pr.pe,
    b.gross, b.night_diff, b.ot_pay,
    b.sss, b.phic, b.hdmf,
    c.tax,
    ROUND(b.gross + b.night_diff + b.ot_pay - b.sss - b.phic - b.hdmf - c.tax, 2)
FROM (
    SELECT v.ps,
           CASE WHEN EXTRACT(DAY FROM v.ps) = 1
                THEN v.ps + 14
                ELSE (date_trunc('month', v.ps) + INTERVAL '1 month')::date - 1
           END AS pe
    FROM generate_series(
            date_trunc('month', CURRENT_DATE::timestamp) - INTERVAL '3 months',
            date_trunc('month', CURRENT_DATE::timestamp),
            INTERVAL '1 month') AS m(mo)
    CROSS JOIN LATERAL (VALUES (m.mo::date), ((m.mo + INTERVAL '15 days')::date)) AS v(ps)
) pr
JOIN profiles p
  ON p.role = 'staff'
 AND p.hire_date <= pr.pe
 AND (p.exited_at IS NULL OR p.exited_at >= pr.ps)
CROSS JOIN LATERAL (
    SELECT decode(md5(p.id::text || pr.ps::text || 'payroll'), 'hex') AS h) x
CROSS JOIN LATERAL (
    SELECT ROUND(p.hourly_rate_php * 87, 2) AS gross,
           CASE WHEN get_byte(x.h, 0) < 96
                THEN (get_byte(x.h, 1) % 13)::numeric
                ELSE 0 END AS ot_h) a
CROSS JOIN LATERAL (
    SELECT a.gross,
           CASE WHEN p.shift = 'night' THEN ROUND(a.gross * 0.10, 2) ELSE 0 END AS night_diff,
           ROUND(p.hourly_rate_php * 1.25 * a.ot_h, 2)                          AS ot_pay,
           ROUND(LEAST(a.gross * 0.045, 1350.00), 2)                            AS sss,
           ROUND(LEAST(a.gross * 0.025, 2500.00), 2)                            AS phic,
           100.00                                                               AS hdmf) b
CROSS JOIN LATERAL (
    SELECT ROUND(GREATEST(
               0,
               (b.gross + b.night_diff + b.ot_pay - b.sss - b.phic - b.hdmf - 10417.00) * 0.15
           ), 2) AS tax) c
WHERE pr.pe <= CURRENT_DATE
ON CONFLICT (user_id, pay_period_start) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 11. CALLING METRICS  (SLA + QA — ~90 days, all 4 clients)
-- ---------------------------------------------------------------------------
-- PRD §8 seeded a single day, which cannot draw a trend line. The per-client
-- baselines below are exactly the PRD's 2026-07-27 figures, so the shape of
-- the demo is unchanged — it just now has 90 days of it.
--
-- Deliberate spread against the 95% answer-rate target: Northlake comfortably
-- clears it, Alder Bay hovers on it, Kestrel and Ironwood breach it often enough that
-- the SLA panel has something to flag. A dashboard where every client is green
-- demonstrates nothing.
INSERT INTO calling_metrics (
    client_id, metric_date, total_calls, answered_calls,
    avg_handle_time_sec, fcr_percentage, qa_audit_score)
SELECT
    c.id,
    g.ts::date,
    v.total,
    LEAST(v.total, FLOOR(v.total * v.ans_rate)::int),
    GREATEST(60, base.aht + (get_byte(x.h, 3) % 61) - 30),
    ROUND(LEAST(99.00, GREATEST(70.00, base.fcr + (get_byte(x.h, 4) % 13) - 6)), 2),
    ROUND(LEAST(99.50, GREATEST(75.00, base.qa  + (get_byte(x.h, 5) % 11) - 5)), 2)
FROM (VALUES
    ('ALDR', 1420, 240, 92.50, 96.80, 0.955),
    ('KSTL',  890, 310, 85.00, 89.20, 0.925),
    ('NLAK', 2100, 195, 95.80, 98.10, 0.975),
    ('IRON',  650, 280, 88.00, 91.50, 0.940)
) AS base(code, calls, aht, fcr, qa, ans_mid)
JOIN clients c ON c.code = base.code
-- Explicit ::timestamp casts: a bare `date` argument is implicitly castable to
-- both timestamp and timestamptz, so the pinned cast removes any dependence on
-- overload resolution (and on the session timezone) when ts is cast back.
CROSS JOIN LATERAL generate_series(
        (CURRENT_DATE - 90)::timestamp,
        (CURRENT_DATE - 1)::timestamp,
        INTERVAL '1 day') AS g(ts)
CROSS JOIN LATERAL (
        SELECT decode(md5(base.code || g.ts::date::text || 'calls'), 'hex') AS h) x
CROSS JOIN LATERAL (
    SELECT GREATEST(40, ROUND(
               base.calls
               * CASE WHEN EXTRACT(DOW FROM g.ts) IN (0, 6) THEN 0.45 ELSE 1.00 END
               * (0.85 + (get_byte(x.h, 0) % 31) / 100.0)
           )::int) AS total,
           LEAST(0.995, base.ans_mid - 0.045 + (get_byte(x.h, 1) % 91) / 1000.0) AS ans_rate
) v
ON CONFLICT (client_id, metric_date) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 12. BILLABLE SEAT SNAPSHOT  (staging for invoices)
-- ---------------------------------------------------------------------------
-- Current billable seats per (client, department) joined to the live bill rate.
-- Invoices and their line items are both derived from this, which is why the
-- ledger reconciles to the roster instead of being an unrelated set of numbers.
CREATE TEMP TABLE _seed_seat_rates ON COMMIT DROP AS
SELECT
    p.client_id,
    p.department_id,
    c.code               AS client_code,
    d.name::text         AS dept_name,
    COUNT(*)::numeric    AS seats,
    br.monthly_rate_usd  AS rate
FROM profiles p
JOIN clients     c ON c.id = p.client_id
JOIN departments d ON d.id = p.department_id
JOIN LATERAL (
    SELECT b.monthly_rate_usd
    FROM client_bill_rates b
    WHERE b.client_id = p.client_id
      AND b.department_id = p.department_id
      AND b.effective_from <= CURRENT_DATE
    ORDER BY b.effective_from DESC
    LIMIT 1
) br ON true
WHERE p.role = 'staff'
  AND p.exited_at IS NULL
  AND p.seat_type = 'billable'
GROUP BY p.client_id, p.department_id, c.code, d.name, br.monthly_rate_usd;

-- ---------------------------------------------------------------------------
-- 13. FINANCIAL INVOICES  (6 months of QuickBooks history)
-- ---------------------------------------------------------------------------
-- PRD §8 seeded four invoices on four different dates, which gives the 90-day
-- cash-flow projection nothing to regress against. This seeds 24 — six monthly
-- cycles per client — with genuine payment behaviour:
--   * Terms differ per client (Ironwood net-15 through Kestrel net-45), which is
--     what makes the projection curve non-trivial.
--   * Roughly 82% of matured invoices are Paid, with `paid_date` scattered
--     from five days early to eleven days late, so the model has real lag to
--     learn from rather than a constant.
--   * The rest sit Overdue and land across the 1-30 / 31-60 / 61-90 ageing
--     buckets, so the AR table is populated at every level.
--   * Invoices not yet matured are Pending with a NULL paid_date.
-- Amount starts as the seat-derived MRR and is corrected to the exact sum of
-- its line items in section 15.
INSERT INTO financial_invoices (
    qbo_invoice_id, client_id, amount_usd, status, issued_date, due_date, paid_date, terms_days)
SELECT
    'INV-' || m.client_code || '-' || to_char(im.mo, 'YYYYMM'),
    m.client_id,
    ROUND(m.mrr, 2),
    s.st,
    v.issued,
    v.due,
    pd.paid,
    t.terms_days
FROM (
    SELECT client_id, client_code, SUM(seats * rate) AS mrr
    FROM _seed_seat_rates GROUP BY client_id, client_code
) m
JOIN (VALUES ('ALDR', 30), ('KSTL', 45), ('NLAK', 30), ('IRON', 15))
      AS t(code, terms_days) ON t.code = m.client_code
CROSS JOIN LATERAL generate_series(
        date_trunc('month', CURRENT_DATE::timestamp) - INTERVAL '5 months',
        date_trunc('month', CURRENT_DATE::timestamp),
        INTERVAL '1 month') AS im(mo)
CROSS JOIN LATERAL (
        SELECT decode(md5(m.client_code || to_char(im.mo, 'YYYYMM') || 'invoice'), 'hex') AS h) x
CROSS JOIN LATERAL (
        SELECT im.mo::date                                  AS issued,
               im.mo::date + t.terms_days                   AS due) v
CROSS JOIN LATERAL (
        SELECT CASE WHEN v.due > CURRENT_DATE      THEN 'Pending'::invoice_status
                    WHEN get_byte(x.h, 1) < 210    THEN 'Paid'::invoice_status
                    ELSE                                'Overdue'::invoice_status
               END AS st) s
CROSS JOIN LATERAL (
        SELECT CASE WHEN s.st = 'Paid'
                    THEN LEAST(CURRENT_DATE,
                               GREATEST(v.issued + 3, v.due + (get_byte(x.h, 2) % 17) - 5))
               END AS paid) pd
ON CONFLICT (qbo_invoice_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 14. INVOICE LINE ITEMS
-- ---------------------------------------------------------------------------
-- One line per department staffed on the account. Quantity is the seat count
-- flexed +/-8% month to month to represent prorated joiners and leavers, which
-- is why a client's invoice total moves without the rate card changing.
INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_rate_usd, amount_usd)
SELECT
    fi.id,
    'Dedicated seats - ' || sr.dept_name,
    q.qty,
    sr.rate,
    ROUND(q.qty * sr.rate, 2)
FROM financial_invoices fi
JOIN _seed_seat_rates sr ON sr.client_id = fi.client_id
CROSS JOIN LATERAL (
    SELECT ROUND(
        sr.seats * (0.92 + (get_byte(
            decode(md5(fi.qbo_invoice_id || sr.dept_name), 'hex'), 0) % 17) / 100.0
        ), 2) AS qty) q
ON CONFLICT (invoice_id, description) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 15. RECONCILE INVOICE TOTALS TO THEIR LINES
-- ---------------------------------------------------------------------------
-- The header amount must equal the sum of its lines, or the client portal
-- shows one number and its own breakdown shows another.
UPDATE financial_invoices fi
SET amount_usd = li.total
FROM (
    SELECT invoice_id, ROUND(SUM(amount_usd), 2) AS total
    FROM invoice_line_items GROUP BY invoice_id
) li
WHERE li.invoice_id = fi.id
  AND fi.amount_usd IS DISTINCT FROM li.total;

COMMIT;

-- ============================================================================
-- POST-SEED SANITY CHECKS
-- ============================================================================
-- Run these after `supabase db reset` to confirm the demo will render. Every
-- one of them returned zero rows against the PRD's original seed.
--
--   -- 60 active workforce, 9 leavers, 7 logins, 76 profiles total
--   SELECT role, count(*) FILTER (WHERE exited_at IS NULL) AS active,
--          count(*) AS total FROM profiles GROUP BY role ORDER BY role;
--
--   -- headline KPIs have data
--   SELECT count(*) FROM productivity_logs;   -- ~4,400
--   SELECT count(*) FROM payroll_records;     -- ~480
--   SELECT count(*) FROM calling_metrics;     -- 360
--   SELECT count(*) FROM leave_records;       -- ~180
--
--   -- seat utilization should read ~86.7%
--   SELECT seat_type, count(*) FROM profiles
--   WHERE role = 'staff' AND exited_at IS NULL GROUP BY seat_type;
--
--   -- shift coverage: day 15 / mid 15 / night 30
--   SELECT shift, count(*) FROM profiles
--   WHERE role = 'staff' AND exited_at IS NULL GROUP BY shift;
--
--   -- invoices reconcile to their line items (expect zero rows)
--   SELECT fi.qbo_invoice_id FROM financial_invoices fi
--   JOIN (SELECT invoice_id, SUM(amount_usd) t FROM invoice_line_items
--         GROUP BY invoice_id) l ON l.invoice_id = fi.id
--   WHERE ROUND(l.t, 2) <> fi.amount_usd;
--
--   -- AR mix across all three statuses (expect Paid / Overdue / Pending)
--   SELECT status, count(*), SUM(amount_usd) FROM financial_invoices GROUP BY status;
-- ============================================================================
