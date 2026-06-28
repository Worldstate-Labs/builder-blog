import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { getUserFromBearer } from "@/lib/tokens";

export async function requireCloudFetchAdmin(request: Request) {
  const session = await getCurrentSession();
  if (session?.user?.id) {
    return isAdminEmail(session.user.email)
      ? { ok: true as const, user: session.user }
      : { ok: false as const, status: 403, error: "Forbidden" };
  }

  const bearerUser = await getUserFromBearer(request);
  if (!bearerUser) return { ok: false as const, status: 401, error: "Unauthorized" };
  return isAdminEmail(bearerUser.email)
    ? { ok: true as const, user: bearerUser }
    : { ok: false as const, status: 403, error: "Forbidden" };
}
