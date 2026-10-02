/**
 * ============================================================================
 * NORTHWINDS INTERNATIONAL — QUICKBOOKS ONLINE TRANSFORMER  (PRD §4.1, expanded)
 * ============================================================================
 * PRD §4.1 returned four invoices for a single month. That is enough to render
 * a table and nothing else: the 90-day cash-flow projection needs payment
 * history to model collection lag, and the AR ageing table needs receivables
 * old enough to reach the 61-90 and 90+ buckets. It also omitted `paid_date`
 * and `terms_days` entirely, which left the forecast unanchored.
 *
 * This module generates a believable six-month ledger across the four seeded
 * client UUIDs, with payment lag, early payers, and a handful of genuinely
 * delinquent invoices.
 *
 * DETERMINISM IS A HARD REQUIREMENT
 * `Math.random()` is banned here. The dashboard renders on the server and
 * hydrates on the client; if the two disagree by a single peso React throws a
 * hydration error. Every number below comes from a seeded PRNG (mulberry32),
 * so the demo shows identical figures on every reload and in every process.
 * The PRNG is exported for reuse — see `lib/integrations/controlio.ts`.
 * ========================================================================= */

import {
  type FinancialInvoice,
  type InvoiceStatus,
  type IsoDate,
  type UUID,
} from "@/lib/types";
import { fetchWithFallback } from "@/lib/utils/api-handler";

/* ---------------------------------------------------------------------------
 * SEEDED PRNG — shared across every mock module
 * ------------------------------------------------------------------------ */

/**
 * xmur3 string hash. Turns a human-readable seed ("northwinds-qbo-v1") into a
 * 32-bit integer, so seeds can be named rather than magic numbers.
 */
export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** A deterministic random source. Same seed ⇒ same sequence, always. */
export interface SeededRandom {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** Uniform integer in [min, max], inclusive both ends. */
  int(min: number, max: number): number;
  /** True with probability `p` (0–1). */
  bool(p: number): boolean;
  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Approximately normal, clamped to [min, max]. Sum-of-three-uniforms. */
  normal(mean: number, stdDev: number, min: number, max: number): number;
}

/**
 * mulberry32 — 32-bit, ~2^32 period, excellent distribution for mock data and
 * three lines long. Accepts a numeric seed or a named string seed.
 */
export function createSeededRandom(seed: number | string): SeededRandom {
  let state = (typeof seed === "string" ? hashSeed(seed) : seed >>> 0) || 0x9e3779b9;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const float = (min: number, max: number): number => min + next() * (max - min);
  const int = (min: number, max: number): number =>
    Math.floor(float(Math.ceil(min), Math.floor(max) + 1));

  return {
    next,
    float,
    int,
    bool: (p: number): boolean => next() < p,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error("pick() called with an empty array");
      return items[Math.floor(next() * items.length)];
    },
    normal(mean: number, stdDev: number, min: number, max: number): number {
      // Irwin–Hall(3), mean 1.5, sd ≈ 0.2887 → scale to the requested moments.
      const sum = next() + next() + next();
      const value = mean + ((sum - 1.5) / 0.2887) * stdDev;
      return Math.min(max, Math.max(min, value));
    },
  };
}

/* ---------------------------------------------------------------------------
 * DETERMINISTIC IDS
 * ------------------------------------------------------------------------ */

/**
 * A stable, UUID-v4-shaped identifier derived from a namespace + key. Not a
 * real RFC 4122 v5 UUID (no SHA-1 here), but it is deterministic, collision-
 * safe at this scale, and satisfies Postgres `uuid` on the real insert path.
 */
export function deterministicUuid(namespace: string, key: string): UUID {
  const rand = createSeededRandom(`${namespace}::${key}`);
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 32; i += 1) out += hex[Math.floor(rand.next() * 16)];
  const variant = hex[(parseInt(out[16], 16) & 0x3) | 0x8];
  return (
    `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(13, 16)}-` +
    `${variant}${out.slice(17, 20)}-${out.slice(20, 32)}`
  );
}

/* ---------------------------------------------------------------------------
 * DATE HELPERS — all UTC. Local-time arithmetic is the classic source of
 * server/client off-by-one-day hydration bugs.
 * ------------------------------------------------------------------------ */

function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(iso: IsoDate): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function addDays(iso: IsoDate, days: number): IsoDate {
  const date = parseIsoDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round(
    (parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000,
  );
}

/** Clamps a day-of-month to a month that may be shorter (e.g. day 31 in Feb). */
function isoFromParts(year: number, monthIndex: number, day: number): IsoDate {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return toIsoDate(new Date(Date.UTC(year, monthIndex, Math.min(day, lastDay))));
}

/* ---------------------------------------------------------------------------
 * CONFIGURATION
 * ------------------------------------------------------------------------ */

/**
 * The ledger is generated relative to a fixed anchor, not `new Date()`.
 * A moving "today" would change statuses and ageing buckets between the server
 * render and the client hydration, and would make the demo unreproducible.
 * Bump this when the demo date moves.
 */
export const QB_ANCHOR_DATE: IsoDate = "2026-07-28";

/** Months of history generated backwards from the anchor, inclusive. */
export const QB_HISTORY_MONTHS = 6;

export const QB_SEED = "northwinds-quickbooks-v1";

/** The four seeded tenants. Order matters — index drives per-client behaviour. */
export const QB_CLIENT_IDS: readonly UUID[] = [
  "11111111-1111-1111-1111-111111111111",
  "22222222-2222-2222-2222-222222222222",
  "33333333-3333-3333-3333-333333333333",
  "44444444-4444-4444-4444-444444444444",
] as const;

interface ClientBillingProfile {
  clientId: UUID;
  /** Base monthly retainer, matching the PRD's headline figures. */
  baseAmountUsd: number;
  /** Net terms from the QBO invoice, in days. */
  termsDays: number;
  /** Day of month the retainer is raised. */
  issueDay: number;
  /** Probability an already-due invoice was actually paid. */
  payReliability: number;
  /** Typical days past the due date this client settles. Negative = early. */
  meanPaymentLagDays: number;
  /** Probability of an extra ad-hoc / overage invoice in a given month. */
  adHocProbability: number;
}

/**
 * Payment behaviour differs sharply by account and is what makes the cash-flow
 * forecast interesting: client 2 is the chronic late payer the CEO chases,
 * client 3 pays early, client 4 is small but punctual.
 */
const CLIENT_PROFILES: readonly ClientBillingProfile[] = [
  {
    clientId: QB_CLIENT_IDS[0],
    baseAmountUsd: 28_500,
    termsDays: 15,
    issueDay: 1,
    payReliability: 0.93,
    meanPaymentLagDays: 1,
    adHocProbability: 0.4,
  },
  {
    clientId: QB_CLIENT_IDS[1],
    baseAmountUsd: 19_200,
    termsDays: 15,
    issueDay: 8,
    payReliability: 0.66,
    meanPaymentLagDays: 11,
    adHocProbability: 0.3,
  },
  {
    clientId: QB_CLIENT_IDS[2],
    baseAmountUsd: 34_000,
    termsDays: 30,
    issueDay: 15,
    payReliability: 0.96,
    meanPaymentLagDays: -3,
    adHocProbability: 0.5,
  },
  {
    clientId: QB_CLIENT_IDS[3],
    baseAmountUsd: 15_500,
    termsDays: 30,
    issueDay: 22,
    payReliability: 0.88,
    meanPaymentLagDays: 4,
    adHocProbability: 0.25,
  },
] as const;

/**
 * Forced delinquencies: `${clientIndex}:${monthsAgo}`. Without these the seeded
 * ledger can come out clean, and an AR ageing table with nothing in 61-90 or
 * 90+ teaches the viewer nothing about what the panel is for.
 */
const FORCED_OVERDUE = new Set<string>(["1:2", "1:3", "3:2"]);

/* ---------------------------------------------------------------------------
 * PRD §4.1 CONTRACT
 * ------------------------------------------------------------------------ */

/**
 * QuickBooks Online invoice, camelCase as the QBO REST API returns it.
 * `paidDate` and `termsDays` are additions to the PRD shape — QBO exposes both
 * (`LinkedTxn`/`Payment` and `SalesTermRef`) and the cash-flow model is
 * meaningless without them.
 */
export interface QBInvoice {
  invoiceId: string;
  clientId: string;
  amountUSD: number;
  status: InvoiceStatus;
  dueDate: string;
  issuedDate: string;
  /** ISO date the payment cleared, or null while unpaid. */
  paidDate: string | null;
  /** Net payment terms in days (QBO `SalesTermRef`). */
  termsDays: number;
}

/* ---------------------------------------------------------------------------
 * GENERATION
 * ------------------------------------------------------------------------ */

interface DraftInvoice extends Omit<QBInvoice, "invoiceId"> {
  isAdHoc: boolean;
}

function buildDraft(
  profile: ClientBillingProfile,
  clientIndex: number,
  monthsAgo: number,
  issuedDate: IsoDate,
  amountUsd: number,
  isAdHoc: boolean,
  rand: SeededRandom,
): DraftInvoice {
  const dueDate = addDays(issuedDate, profile.termsDays);
  const dueInDays = daysBetween(QB_ANCHOR_DATE, dueDate);

  // Not yet due → Pending, unless this client happens to have paid ahead.
  if (dueInDays > 0) {
    const paidEarly =
      !isAdHoc && rand.bool(profile.meanPaymentLagDays < 0 ? 0.45 : 0.12);
    if (paidEarly) {
      const paidOffset = rand.int(1, Math.max(1, profile.termsDays - 2));
      const paidDate = addDays(issuedDate, paidOffset);
      if (daysBetween(QB_ANCHOR_DATE, paidDate) <= 0) {
        return {
          clientId: profile.clientId,
          amountUSD: amountUsd,
          status: "Paid",
          issuedDate,
          dueDate,
          paidDate,
          termsDays: profile.termsDays,
          isAdHoc,
        };
      }
    }
    return {
      clientId: profile.clientId,
      amountUSD: amountUsd,
      status: "Pending",
      issuedDate,
      dueDate,
      paidDate: null,
      termsDays: profile.termsDays,
      isAdHoc,
    };
  }

  // Past due. Either it was collected (with lag) or it is genuinely overdue.
  const forced = FORCED_OVERDUE.has(`${clientIndex}:${monthsAgo}`) && !isAdHoc;
  const collected = !forced && rand.bool(profile.payReliability);

  if (!collected) {
    return {
      clientId: profile.clientId,
      amountUSD: amountUsd,
      status: "Overdue",
      issuedDate,
      dueDate,
      paidDate: null,
      termsDays: profile.termsDays,
      isAdHoc,
    };
  }

  const lag = Math.round(
    rand.normal(profile.meanPaymentLagDays, 5, profile.termsDays * -1 + 2, 45),
  );
  let paidDate = addDays(dueDate, lag);
  // Money cannot land in the future, and cannot land before the invoice exists.
  if (daysBetween(QB_ANCHOR_DATE, paidDate) > 0) paidDate = QB_ANCHOR_DATE;
  if (daysBetween(issuedDate, paidDate) < 1) paidDate = addDays(issuedDate, 1);

  return {
    clientId: profile.clientId,
    amountUSD: amountUsd,
    status: "Paid",
    issuedDate,
    dueDate,
    paidDate,
    termsDays: profile.termsDays,
    isAdHoc,
  };
}

/** Rounds to the nearest $50 — real retainers are not priced to the cent. */
function roundAmount(value: number): number {
  return Math.round(value / 50) * 50;
}

function generateInvoices(): QBInvoice[] {
  const rand = createSeededRandom(QB_SEED);
  const anchor = parseIsoDate(QB_ANCHOR_DATE);
  const drafts: DraftInvoice[] = [];

  // Oldest month first, so the PRNG stream is stable if history is extended.
  for (let monthsAgo = QB_HISTORY_MONTHS - 1; monthsAgo >= 0; monthsAgo -= 1) {
    const monthDate = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - monthsAgo, 1),
    );
    const year = monthDate.getUTCFullYear();
    const monthIndex = monthDate.getUTCMonth();

    for (let clientIndex = 0; clientIndex < CLIENT_PROFILES.length; clientIndex += 1) {
      const profile = CLIENT_PROFILES[clientIndex];
      const issuedDate = isoFromParts(year, monthIndex, profile.issueDay);

      // Don't raise an invoice dated after the anchor.
      if (daysBetween(QB_ANCHOR_DATE, issuedDate) > 0) continue;

      // Seat count drifts month to month; ±8% is a headcount change, not noise.
      const drift = rand.normal(1, 0.05, 0.88, 1.14);
      // Gentle growth over the six months so the revenue trend is not flat.
      const growth = 1 + (QB_HISTORY_MONTHS - 1 - monthsAgo) * 0.012;
      const amount = roundAmount(profile.baseAmountUsd * drift * growth);

      drafts.push(
        buildDraft(profile, clientIndex, monthsAgo, issuedDate, amount, false, rand),
      );

      if (rand.bool(profile.adHocProbability)) {
        // Overage / project work, billed mid-month at a fraction of retainer.
        const adHocDate = isoFromParts(
          year,
          monthIndex,
          Math.min(28, profile.issueDay + rand.int(6, 12)),
        );
        if (daysBetween(QB_ANCHOR_DATE, adHocDate) <= 0) {
          const adHocAmount = roundAmount(
            profile.baseAmountUsd * rand.float(0.08, 0.24),
          );
          drafts.push(
            buildDraft(
              profile,
              clientIndex,
              monthsAgo,
              adHocDate,
              adHocAmount,
              true,
              rand,
            ),
          );
        }
      }
    }
  }

  // QBO numbers invoices in creation order; sort so INV-#### reads sensibly.
  drafts.sort((a, b) => {
    if (a.issuedDate !== b.issuedDate) return a.issuedDate < b.issuedDate ? -1 : 1;
    if (a.clientId !== b.clientId) return a.clientId < b.clientId ? -1 : 1;
    return Number(a.isAdHoc) - Number(b.isAdHoc);
  });

  return drafts.map((draft, index) => ({
    invoiceId: `INV-${1001 + index}`,
    clientId: draft.clientId,
    amountUSD: draft.amountUSD,
    status: draft.status,
    dueDate: draft.dueDate,
    issuedDate: draft.issuedDate,
    paidDate: draft.paidDate,
    termsDays: draft.termsDays,
  }));
}

/**
 * Generated once per process. The ledger is a pure function of `QB_SEED`, so
 * memoising it is purely a cost saving — repeat calls were already identical.
 */
let invoiceCache: QBInvoice[] | null = null;

function invoiceLedger(): QBInvoice[] {
  if (invoiceCache === null) invoiceCache = generateInvoices();
  return invoiceCache;
}

/* ---------------------------------------------------------------------------
 * PUBLIC API
 * ------------------------------------------------------------------------ */

export const QUICKBOOKS_SERVICE_NAME = "quickbooks";

/**
 * PRD §4.1. Six months of invoices across the four seeded clients.
 *
 * PRODUCTION HOOK
 *   The live implementation replaces the body of the primary call below with:
 *
 *     GET https://quickbooks.api.intuit.com/v3/company/{realmId}/query
 *         ?query=SELECT * FROM Invoice WHERE TxnDate >= '{since}' MAXRESULTS 1000
 *         Authorization: Bearer {oauth2_access_token}
 *         Accept: application/json
 *
 *   Map `Id`→invoiceId, `CustomerRef.value`→clientId (via a QBO-customer→
 *   NorthWinds-client lookup), `TotalAmt`→amountUSD, `Balance`+`DueDate`→status,
 *   `SalesTermRef`→termsDays, and the most recent linked `Payment.TxnDate`
 *   →paidDate. Everything downstream already speaks `QBInvoice`, so nothing
 *   else changes.
 *
 * Wrapped in `fetchWithFallback` so the health registry has a row for
 * QuickBooks from day one and the swap to a live call is a one-line change.
 */
export async function fetchQuickBooksInvoices(): Promise<QBInvoice[]> {
  const ledger = invoiceLedger();
  return fetchWithFallback<QBInvoice[]>(
    async (): Promise<QBInvoice[]> => ledger,
    ledger,
    QUICKBOOKS_SERVICE_NAME,
    { silent: true, retries: 0 },
  );
}

/** Invoices for a single tenant. Used by the client portal ledger. */
export async function fetchQuickBooksInvoicesForClient(
  clientId: UUID,
): Promise<QBInvoice[]> {
  const all = await fetchQuickBooksInvoices();
  return all.filter((invoice) => invoice.clientId === clientId);
}

/* ---------------------------------------------------------------------------
 * TRANSFORMER
 * ------------------------------------------------------------------------ */

/**
 * QBO wire shape → the canonical `FinancialInvoice` row. The `id` is derived
 * deterministically from `qbo_invoice_id`, so re-running an import upserts the
 * same row instead of duplicating it.
 */
export function transformQbInvoice(qb: QBInvoice): FinancialInvoice {
  return {
    id: deterministicUuid("qbo-invoice", qb.invoiceId),
    qbo_invoice_id: qb.invoiceId,
    client_id: qb.clientId,
    amount_usd: qb.amountUSD,
    status: qb.status,
    issued_date: qb.issuedDate,
    due_date: qb.dueDate,
    // Contract invariant: a paid date only exists on a Paid invoice.
    paid_date: qb.status === "Paid" ? qb.paidDate : null,
    terms_days: qb.termsDays,
    created_at: `${qb.issuedDate}T09:00:00.000Z`,
  };
}

/** Convenience: fetch and transform in one step. */
export async function fetchFinancialInvoices(): Promise<FinancialInvoice[]> {
  const invoices = await fetchQuickBooksInvoices();
  return invoices.map(transformQbInvoice);
}

/**
 * Observed collection lag in days (paid_date − due_date) across paid invoices.
 * The cash-flow projection uses this to place open invoices on the timeline
 * instead of naively assuming everyone pays exactly on terms.
 */
export function averagePaymentLagDays(invoices: readonly QBInvoice[]): number {
  const lags = invoices
    .filter((invoice) => invoice.status === "Paid" && invoice.paidDate !== null)
    .map((invoice) => daysBetween(invoice.dueDate, invoice.paidDate as IsoDate));
  if (lags.length === 0) return 0;
  const total = lags.reduce((sum, lag) => sum + lag, 0);
  return Math.round((total / lags.length) * 10) / 10;
}
