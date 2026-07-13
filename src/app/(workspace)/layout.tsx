import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { WorkspaceAutoRefresh } from "@/components/WorkspaceAutoRefresh";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { contentSyncState } from "@/lib/content-sync-state";

export default async function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const isAdmin = isAdminEmail(session.user.email);
  const syncState = await contentSyncState(session.user.id, { isAdmin });

  return (
    <AppShell session={session}>
      <WorkspaceAutoRefresh initialVersion={syncState.version} />
      {children}
    </AppShell>
  );
}
