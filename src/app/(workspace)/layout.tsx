import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getCurrentSession } from "@/lib/auth";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { builderLibraryState } from "@/lib/builder-library-state";

export default async function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");

  const builderIds = await activePoolBuilderIds(session.user.id);
  const dataState = await builderLibraryState(session.user.id, builderIds);

  return (
    <AppShell dataVersion={dataState.version} session={session}>
      {children}
    </AppShell>
  );
}
