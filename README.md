# NorthWinds International — Operations Console

Multi-tenant operational dashboard for a Philippine healthcare BPO. Fuses
financial accounting, workforce productivity and local payroll into one
surface, serving two hard-isolated audiences:

- **CEO / internal console** (`/dashboard/admin`) — full cross-departmental
  visibility: revenue, payroll, productivity, SLAs, margin modelling and an AI
  executive briefing.
- **Client portal** (`/dashboard/client`) — each healthcare client sees only
  their own team, SLAs and invoices.

---

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. **No environment variables are required** — every
integration degrades gracefully to mock or cached data. Copy `.env.example` to
`.env.local` only if you want the live Claude briefing.

### Roles

There is no password. The login screen is a role picker — pick one and you are
signed in as that role. This is a demonstration build on generated data, so
there is no account to protect, and printing a password next to its own login
form would be theatre. Real authentication is one of the things that gets
replaced when the system is connected to a live database.

**Authorisation is real, though.** Every boundary below is enforced on the
server, not by hiding things in the interface — that is the part worth testing.

| Role | Sees |
|---|---|
| CEO | Everything, all four accounts |
| HR Director | Workforce & payroll, no commercial data |
| Operations Manager | Productivity & SLAs, no individual compensation |
| Alder Bay Nursing Group | Its own team, SLAs and invoices — nothing else |
| Kestrel Medical Group | Its own only — the deliberately at-risk SLA account |
| Northlake Telehealth | Its own only |
| Ironwood Health Logistics | Its own only |

The four client accounts are invented, as is every figure in the system.

---

### Theme

A three-state control sits in the top bar (and on the login screen):

- **Auto** (default) — each area uses its designed register: dark console, light client portal.
- **Light** / **Dark** — an explicit choice that overrides both areas everywhere.

The preference is cookie-backed and read server-side, so there is no flash of
the wrong theme on load. See [docs/DESIGN.md](docs/DESIGN.md#the-theme-control).

---

## Stack

| Layer | Choice | Note |
|---|---|---|
| Framework | Next.js 16, App Router, TS strict | |
| UI | Tailwind v4 + shadcn/ui | |
| Charts | Recharts via shadcn `chart.tsx` | **Tremor was dropped** — unmaintained, not React 19 compatible |
| State | Zustand + persist | Widget layout |
| AI | Anthropic SDK (Claude) | **Replaces the PRD's OpenAI/gpt-4o** |
| Data | Deterministic in-memory mock | Supabase schema written, not yet connected |
| FX | ECB via `frankfurter.dev` | Genuinely live, no API key |

---

## Architecture

```
lib/data/dataset.ts     Deterministic dataset (seeded PRNG, frozen clock)
lib/data/queries.ts     <- THE SEAM. Every panel reads through here.
lib/data/mutations.ts   Writes (payroll import)
lib/auth/session.ts     Session + route guards; tenant derived from session
lib/types.ts            Canonical domain contract - mirrors supabase/schema.sql
supabase/               schema.sql, policies.sql, seed.sql (ready, not applied)
```

Panels never touch the dataset directly — they receive finished view models
from `lib/types.ts`. **Connecting Supabase means rewriting `queries.ts` and
nothing else.**

---

## Verification (PRD §12.2)

| Case | Steps | Expected |
|---|---|---|
| TC-01 | Sign in as `ceo_admin@northwinds.example` | All four clients' invoices and all staff visible |
| TC-02 | Sign in as `client_alderbay@alderbay.example` | Only Alder Bay data; other three tenants absent |
| TC-03 | As Alder Bay, navigate to `/dashboard/admin` | Redirected to `/unauthorized` |
| TC-04 | Payroll → upload `docs/samples/jeonsoft-sample.csv` | 12/12 rows accepted; import summary shows gross, deductions and net |

Also try `docs/samples/jeonsoft-malformed.csv` — it demonstrates per-row error
reporting with exact line numbers rather than failing the whole file.

> **TC-04 does not change the dashboard KPI**, and shouldn't be expected to.
> Imported records are held in memory (see Known gaps), so on serverless
> hosting the write and the next render may not share an instance. The import
> summary figures are computed by the parser and are always correct. See
> [docs/VERCEL-DEPLOYMENT.md](docs/VERCEL-DEPLOYMENT.md).

---

## Read before trusting the numbers

- **[docs/DATA-PROVENANCE.md](docs/DATA-PROVENANCE.md)** — which figures are
  real, which are modelled. The HR tab is modelled and says so in-product.
- **[docs/DESIGN.md](docs/DESIGN.md)** — design system rules.
- **[docs/jeonsoft-csv-contract.md](docs/jeonsoft-csv-contract.md)** — the CSV
  contract, authored **without** a real JeonSoft export. Validate it against a
  live one before relying on it.
- **supabase/README.md** — applying the schema and RLS policies.

## Known gaps

- Supabase is **not connected**; tenant isolation currently runs in application
  code that deliberately mirrors the written RLS policies.
- Payroll writes are in-memory and lost on restart.
- HR attrition figures are modelled — no HRIS feed exists.
- No automated test suite yet.
