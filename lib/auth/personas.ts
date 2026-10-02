/**
 * ============================================================================
 * DEMO PERSONAS
 * ============================================================================
 * Supabase Auth is deferred, so the demo authenticates against this fixed set
 * of personas. The emails match the verification matrix in PRD §12.2 exactly
 * (`ceo_admin@northwinds.example`, `client_alderbay@alderbay.example`) so the test cases can
 * be walked through verbatim in front of the CEO.
 *
 * IMPORTANT — this is a demo shim, not a security boundary. Real isolation is
 * enforced by Postgres RLS (`supabase/policies.sql`). The scoping rules in
 * `lib/data/queries.ts` deliberately mirror those policies one-to-one, so that
 * when Supabase is connected the access decisions do not change — they simply
 * move from the application into the database, where they belong.
 */

// Imported from the leaf constants module, NOT from `lib/data/dataset.ts` —
// this file is reachable from the client-side persona switcher, and pulling in
// the dataset would ship all 60 staff records and their pay to the browser.
import { CLIENT_IDS, DEPARTMENT_IDS } from "@/lib/constants";
import type { SessionUser, UserRole } from "@/lib/types";

export interface Persona extends SessionUser {
  /** Label shown in the persona switcher. */
  label: string;
  /** One-line description of what this persona should be able to see. */
  scope: string;
}

export const PERSONAS: readonly Persona[] = [
  {
    id: "aaaaaaaa-0000-4000-a000-000000000001",
    email: "ceo_admin@northwinds.example",
    full_name: "Elena Castillo",
    role: "ceo_admin",
    client_id: null,
    client_name: null,
    department_id: null,
    label: "Elena Castillo — CEO",
    scope: "Full cross-departmental access: finance, payroll, workforce, all four clients.",
  },
  {
    id: "aaaaaaaa-0000-4000-a000-000000000002",
    email: "hr_admin@northwinds.example",
    full_name: "Marisol Aquino",
    role: "hr_admin",
    client_id: null,
    client_name: null,
    department_id: DEPARTMENT_IDS.hr,
    label: "Marisol Aquino — HR Director",
    scope: "Workforce, payroll and attrition. No client billing or commercial data.",
  },
  {
    id: "aaaaaaaa-0000-4000-a000-000000000003",
    email: "ops_manager@northwinds.example",
    full_name: "Dante Rivera",
    role: "ops_manager",
    client_id: null,
    client_name: null,
    department_id: DEPARTMENT_IDS.operations,
    label: "Dante Rivera — Operations Manager",
    scope: "Productivity, SLAs and utilization. No individual compensation data.",
  },
  {
    id: "bbbbbbbb-0000-4000-b000-000000000001",
    email: "client_alderbay@alderbay.example",
    full_name: "Karen Whitfield",
    role: "client_user",
    client_id: CLIENT_IDS.alderBay,
    client_name: "Alder Bay Nursing Group",
    department_id: null,
    label: "Karen Whitfield — Alder Bay",
    scope: "Alder Bay only. Their pod, their SLAs, their invoices.",
  },
  {
    id: "bbbbbbbb-0000-4000-b000-000000000002",
    email: "client_kestrel@kestrelmed.example",
    full_name: "Dr. Alan Reyes",
    role: "client_user",
    client_id: CLIENT_IDS.kestrel,
    client_name: "Kestrel Medical Group",
    department_id: null,
    label: "Dr. Alan Reyes — Kestrel",
    scope: "Kestrel Medical Group only. Currently the at-risk SLA account.",
  },
  {
    id: "bbbbbbbb-0000-4000-b000-000000000003",
    email: "client_northlake@northlaketele.example",
    full_name: "Priya Nandakumar",
    role: "client_user",
    client_id: CLIENT_IDS.northlake,
    client_name: "Northlake Telehealth",
    department_id: null,
    label: "Priya Nandakumar — Northlake",
    scope: "Northlake Telehealth only. Highest-volume calling account.",
  },
  {
    id: "bbbbbbbb-0000-4000-b000-000000000004",
    email: "client_ironwood@ironwoodhealth.example",
    full_name: "Tom Brennan",
    role: "client_user",
    client_id: CLIENT_IDS.ironwood,
    client_name: "Ironwood Health Logistics",
    department_id: null,
    label: "Tom Brennan — Ironwood Health",
    scope: "Ironwood Health Logistics only. Newest account.",
  },
] as const;

export const personaById = (id: string): Persona | undefined =>
  PERSONAS.find((p) => p.id === id);

export const personaByEmail = (email: string): Persona | undefined =>
  PERSONAS.find((p) => p.email.toLowerCase() === email.trim().toLowerCase());

export const internalPersonas = PERSONAS.filter((p) => p.role !== "client_user");
export const clientPersonas = PERSONAS.filter((p) => p.role === "client_user");

/** Default persona used by the "skip login" demo shortcut. */
export const DEFAULT_PERSONA_ID = PERSONAS[0]!.id;

export const toSessionUser = (p: Persona): SessionUser => ({
  id: p.id,
  email: p.email,
  full_name: p.full_name,
  role: p.role,
  client_id: p.client_id,
  client_name: p.client_name,
  department_id: p.department_id,
});

/** Roles that may reach `/dashboard/admin`. */
export const canAccessInternal = (role: UserRole): boolean =>
  role === "ceo_admin" || role === "hr_admin" || role === "ops_manager";

/** Roles that may reach `/dashboard/client`. CEO may preview it for demos. */
export const canAccessClientPortal = (role: UserRole): boolean =>
  role === "client_user" || role === "ceo_admin";
