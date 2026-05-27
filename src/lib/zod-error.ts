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
      received?: unknown;
      maximum?: number | bigint;
      minimum?: number | bigint;
    };
    if (
      issue.code === "too_big" &&
      typeof ic.received === "string" &&
      typeof ic.maximum === "number"
    ) {
      extra = ` (got ${ic.received.length})`;
    } else if (
      issue.code === "too_big" &&
      Array.isArray(ic.received) &&
      typeof ic.maximum === "number"
    ) {
      extra = ` (got ${ic.received.length})`;
    } else if (issue.code === "too_big" && typeof ic.received === "number") {
      extra = ` (got ${ic.received})`;
    }
    return `${path}: ${issue.message}${extra}`;
  });
  return lines.join("; ");
}
