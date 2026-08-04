import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import {
  resetUserFetchDigestState,
  type UserFetchDigestResetSummary,
} from "@/lib/fetch-digest-reset";

type ResetSession = {
  user?: { id?: string | null } | null;
} | null;

type AccountGeneratedDataResetDependencies = {
  getSession: () => Promise<ResetSession>;
  reset: (userId: string) => Promise<UserFetchDigestResetSummary>;
  logError: (...values: unknown[]) => void;
};

const defaultDependencies: AccountGeneratedDataResetDependencies = {
  getSession: getCurrentSession,
  reset: resetUserFetchDigestState,
  logError: (...values) => console.error(...values),
};

export function createAccountGeneratedDataResetPost(
  dependencies: AccountGeneratedDataResetDependencies = defaultDependencies,
) {
  return async function postAccountGeneratedDataReset(request: Request) {
    const session = await dependencies.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const confirmation = typeof body?.confirmation === "string"
      ? body.confirmation.trim()
      : "";
    if (confirmation !== "RESET") {
      return NextResponse.json({ error: "Type RESET to confirm." }, { status: 400 });
    }

    try {
      const summary = await dependencies.reset(userId);
      return NextResponse.json({ status: "reset", summary });
    } catch (error) {
      dependencies.logError("Failed to reset account generated data", error);
      return NextResponse.json(
        { error: "Could not reset generated data." },
        { status: 500 },
      );
    }
  };
}
