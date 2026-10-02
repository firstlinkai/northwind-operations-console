/**
 * ============================================================================
 * LEAF CONSTANTS — safe to import from anywhere, including client components
 * ============================================================================
 * This module has NO imports beyond types. That is the entire point.
 *
 * `lib/data/dataset.ts` generates the full operational dataset — 60 staff
 * records, 12 pay periods of salary data, 5,400 productivity logs. It is
 * marked `server-only`. If a client component needed just `REFERENCE_DATE` or
 * a client's display name and reached into `dataset.ts` for it, the bundler
 * would drag that whole graph into the browser: a large bundle, and every
 * employee's compensation shipped to anyone who opens devtools.
 *
 * So the small, genuinely-shared values live here instead, and `dataset.ts`
 * re-exports them for server-side convenience.
 */

import type { Client, Department, UUID } from "@/lib/types";

/* ---------------------------------------------------------------------------
 * FIXED CLOCK
 * The demo runs against a frozen "today" so every chart, ageing bucket and pay
 * period is stable regardless of when the app is opened — and so the server
 * and client can never disagree, which would be a React hydration error.
 * Change this one constant to move the entire dataset in time.
 * ------------------------------------------------------------------------ */
export const REFERENCE_DATE = "2026-07-28";

/** Days of daily history generated for productivity and calling metrics. */
export const HISTORY_DAYS = 90;

/* ---------------------------------------------------------------------------
 * TENANTS — UUIDs preserved from PRD §8 so the mock layer and `seed.sql`
 * refer to the same four clients.
 * ------------------------------------------------------------------------ */
export const CLIENT_IDS = {
  alderBay: "11111111-1111-1111-1111-111111111111",
  kestrel: "22222222-2222-2222-2222-222222222222",
  northlake: "33333333-3333-3333-3333-333333333333",
  ironwood: "44444444-4444-4444-4444-444444444444",
} as const;

export const CLIENTS: readonly Client[] = [
  {
    id: CLIENT_IDS.alderBay,
    name: "Alder Bay Nursing Group",
    industry: "Nursing Placement",
    code: "ALDR",
    created_at: "2024-02-12T00:00:00.000Z",
  },
  {
    id: CLIENT_IDS.kestrel,
    name: "Kestrel Medical Group",
    industry: "Hospital & Medical Care",
    code: "KSTL",
    created_at: "2024-06-03T00:00:00.000Z",
  },
  {
    id: CLIENT_IDS.northlake,
    name: "Northlake Telehealth",
    industry: "Medical Calling & Triage",
    code: "NLAK",
    created_at: "2023-11-20T00:00:00.000Z",
  },
  {
    id: CLIENT_IDS.ironwood,
    name: "Ironwood Health Logistics",
    industry: "Healthcare Operations",
    code: "IRON",
    created_at: "2025-01-15T00:00:00.000Z",
  },
] as const;

/* ---------------------------------------------------------------------------
 * DEPARTMENTS — UUIDs preserved from PRD §8.
 * ------------------------------------------------------------------------ */
export const DEPARTMENT_IDS = {
  hr: "d1111111-1111-1111-1111-111111111111",
  operations: "d2222222-2222-2222-2222-222222222222",
  onboarding: "d3333333-3333-3333-3333-333333333333",
  calling: "d4444444-4444-4444-4444-444444444444",
} as const;

export const DEPARTMENTS: readonly Department[] = [
  { id: DEPARTMENT_IDS.hr, name: "HR" },
  { id: DEPARTMENT_IDS.operations, name: "Operations" },
  { id: DEPARTMENT_IDS.onboarding, name: "Onboarding" },
  { id: DEPARTMENT_IDS.calling, name: "Calling" },
] as const;

/** Client display lookup — safe for client components. */
export const clientNameById = (id: UUID | null): string | null =>
  id ? (CLIENTS.find((c) => c.id === id)?.name ?? null) : null;

export const clientCodeById = (id: UUID | null): string | null =>
  id ? (CLIENTS.find((c) => c.id === id)?.code ?? null) : null;
