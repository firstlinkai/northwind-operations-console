/**
 * ============================================================================
 * POST /api/payroll/upload — JeonSoft payroll CSV import
 * ============================================================================
 *
 * multipart/form-data, single field: `file`.
 *
 * SECURITY NOTE
 *   The PRD's original sketch of this route had *no* authentication,
 *   authorisation, size limit or content-type check — it simply read the body
 *   and wrote payroll rows. Payroll is the most sensitive dataset in the
 *   product (individual salaries, statutory contributions, tax), so every one
 *   of those controls is added here and none of them may be removed:
 *
 *     1. unauthenticated  → 401
 *     2. wrong role       → 403   (see the `client_user` note below)
 *     3. > 5 MB           → 413
 *     4. non-CSV          → 400
 *     5. unparseable CSV  → 400
 *
 *   Error responses never echo file contents. Row-level errors quote at most a
 *   single offending cell (truncated by the parser), which is required for the
 *   UI to tell the user what to fix.
 *
 * PARTIAL SUCCESS
 *   Good rows commit, bad rows are reported. A single bad row never fails the
 *   import: 200 when everything imported, 207 when some rows were rejected.
 * ========================================================================= */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth/session";
// `resolveEmployee` is the data layer's own profile lookup. Running it here as
// a pre-flight check matters: `applyPayrollImport` silently skips rows it
// cannot resolve, so without this the API would report success for rows that
// were never written.
import { applyPayrollImport, resolveEmployee } from "@/lib/data/mutations";
import { countFailedRows, parseJeonSoftCsv } from "@/lib/integrations/jeonsoft";
import type {
  PayrollImportResult,
  SessionUser,
  UserRole,
} from "@/lib/types";

/** Payroll always touches the request session, so it can never be prerendered. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------------------------------------------------------------------------
 * POLICY CONSTANTS
 * ------------------------------------------------------------------------ */

/**
 * Roles permitted to import payroll.
 *
 * Deliberately NOT `isInternalRole()`: `ops_manager` is an internal role but
 * has no business writing salary data, and `client_user` is an *external*
 * tenant login. A `client_user` request reaching this endpoint means either a
 * broken client-side guard or an attempt to read/modify another tenant's
 * payroll — it is a security incident, so it is logged explicitly below.
 */
const PAYROLL_IMPORT_ROLES: readonly UserRole[] = ["ceo_admin", "hr_admin"];

/** Hard ceiling on the upload. A real semi-monthly export is a few hundred KB. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Content types a browser or curl plausibly attaches to a `.csv`.
 * Windows/Excel hosts frequently send `application/vnd.ms-excel`, and some
 * clients send nothing useful at all — hence the extension check is the
 * authoritative one and this list is the secondary filter.
 */
const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "text/csv",
  "text/plain",
  "application/csv",
  "application/vnd.ms-excel",
  "application/octet-stream",
  "",
]);

/* ---------------------------------------------------------------------------
 * HELPERS
 * ------------------------------------------------------------------------ */

function errorResponse(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Strip any path component a client may have smuggled into the filename. */
function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "upload.csv";
  return base.replace(/[^\w.\- ]+/g, "_").slice(0, 128) || "upload.csv";
}

/* ---------------------------------------------------------------------------
 * ROUTE
 * ------------------------------------------------------------------------ */

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    /* -- 1. Authentication ------------------------------------------------ */
    const session: SessionUser | null = await getSessionUser();
    if (session === null) {
      return errorResponse(401, "You must be signed in to import payroll.");
    }

    /* -- 2. Authorisation ------------------------------------------------- */
    if (!PAYROLL_IMPORT_ROLES.includes(session.role)) {
      // An external tenant login must never get this far. Log loudly — this is
      // an incident signal, not a routine permission denial.
      if (session.role === "client_user") {
        console.error(
          "[SECURITY] client_user attempted a payroll import",
          JSON.stringify({
            user_id: session.id,
            client_id: session.client_id,
            route: "POST /api/payroll/upload",
          })
        );
      }
      return errorResponse(
        403,
        "Your role is not permitted to import payroll. Contact the CEO or HR admin."
      );
    }

    /* -- 3. Declared size ------------------------------------------------- */
    // Checked before touching the body so an oversized upload is rejected
    // without being buffered into memory.
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
      return errorResponse(
        413,
        `The file is larger than the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit.`
      );
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return errorResponse(
        400,
        "Expected a multipart/form-data upload with a `file` field."
      );
    }

    /* -- 4. The file itself ----------------------------------------------- */
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return errorResponse(400, "The upload could not be read as form data.");
    }

    const entry = formData.get("file");
    if (entry === null || typeof entry === "string") {
      return errorResponse(400, "No file was supplied in the `file` field.");
    }

    const fileName = safeFileName(entry.name);

    if (entry.size > MAX_UPLOAD_BYTES) {
      return errorResponse(
        413,
        `The file is larger than the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit.`
      );
    }
    if (entry.size === 0) {
      return errorResponse(400, "The uploaded file is empty.");
    }

    if (!/\.csv$/i.test(fileName)) {
      return errorResponse(400, "Only .csv exports are accepted.");
    }
    const declaredType = entry.type.split(";")[0].trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(declaredType)) {
      return errorResponse(
        400,
        "Only CSV files are accepted; this upload declared a different content type."
      );
    }

    /* -- 5. Parse + validate ---------------------------------------------- */
    const csvText = await entry.text();
    const outcome = parseJeonSoftCsv(csvText, { resolveEmployee });

    if (!outcome.ok) {
      // File-level failure: no rows could be read at all.
      return errorResponse(
        400,
        outcome.fatalError ?? "The file could not be parsed as a JeonSoft export."
      );
    }

    if (outcome.dateOrderAmbiguous) {
      console.warn(
        "[payroll/upload] file mixes DD/MM and MM/DD dates; assumed month-first",
        JSON.stringify({ fileName, user_id: session.id })
      );
    }

    /* -- 6. Persist the good rows ----------------------------------------- */
    let inserted = 0;
    let updated = 0;
    if (outcome.rows.length > 0) {
      const applied = await applyPayrollImport(outcome.rows);
      inserted = applied.inserted;
      updated = applied.updated;

      // Every row handed over already resolved to a profile, so a shortfall
      // means the data layer dropped rows for a reason the parser cannot see.
      if (inserted + updated !== outcome.rows.length) {
        console.warn(
          "[payroll/upload] persistence applied fewer rows than were validated",
          JSON.stringify({
            fileName,
            validated: outcome.rows.length,
            applied: inserted + updated,
          })
        );
      }
    }

    const result: PayrollImportResult = {
      fileName,
      totalRows: outcome.totalRows,
      recordsProcessed: inserted + updated,
      recordsFailed: countFailedRows(outcome.errors),
      errors: outcome.errors,
      totals: outcome.totals,
    };

    // 207 whenever anything was rejected: the caller must show the error list.
    return NextResponse.json(result, {
      status: outcome.errors.length === 0 ? 200 : 207,
    });
  } catch (error) {
    // Log server-side only. The client gets no detail and never any file data.
    console.error("[payroll/upload] unexpected failure", error);
    return errorResponse(
      500,
      "The payroll import failed unexpectedly. The file was not applied."
    );
  }
}
