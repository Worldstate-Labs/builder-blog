import type { ZodError } from "zod";

/**
 * Render a ZodError into a short, human-readable string suitable for
 * surfacing to API callers (CLI agent, browser fetch consumers). One
 * issue per line; each line includes the field path, the Zod message,
 * and — when known — the actual size we received so the user can act
 * on the failure without having to consult Zod internals.
 *
 *   builders.0.items.3.body: String must contain at most 100000
 *     character(s) (got 152044)
 *   builders: Array must contain at most 50 element(s) (got 87)
 */
export function formatZodError(error: ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length === 0 ? "<body>" : issue.path.join(".");
    let extra = "";
    const ic = issue as unknown as {
      input?: unknown;
      received?: unknown;
      maximum?: number | bigint;
      minimum?: number | bigint;
    };
    // Zod 4 exposes the offending value as `input` (present only when the
    // schema was parsed with `reportInput`); earlier shapes used
    // `received`. Support both so the size annotation renders whenever the
    // value is available.
    const received = ic.input ?? ic.received;
    if (issue.code === "too_big" && typeof ic.maximum === "number") {
      if (typeof received === "string" || Array.isArray(received)) {
        extra = ` (got ${received.length})`;
      } else if (typeof received === "number") {
        extra = ` (got ${received})`;
      }
    }
    return `${path}: ${issue.message}${extra}`;
  });
  return lines.join("; ");
}
