import type { PrismaClient } from "@prisma/client";

export type UserResetTarget =
  | { kind: "userId"; value: string }
  | { kind: "email"; value: string };

type UserLookupClient = Pick<PrismaClient, "user">;

export function parseUserResetTarget(args: string[]): UserResetTarget {
  if (args.length !== 2) throw targetUsageError();
  const [flag, rawValue] = args;
  const value = rawValue?.trim();
  if (!value) throw targetUsageError();
  if (flag === "--user-id") return { kind: "userId", value };
  if (flag === "--email") return { kind: "email", value };
  throw targetUsageError();
}

export async function resolveUserResetTarget(
  target: UserResetTarget,
  client: UserLookupClient,
) {
  const users = await client.user.findMany({
    where: target.kind === "userId"
      ? { id: target.value }
      : { email: { equals: target.value, mode: "insensitive" } },
    select: { id: true },
    take: 2,
  });
  if (users.length === 0) {
    throw new Error("The reset target matched no account.");
  }
  if (users.length > 1) {
    throw new Error("The reset target matched multiple accounts.");
  }
  return users[0].id;
}

function targetUsageError() {
  return new Error("Provide exactly one --user-id or --email target.");
}
