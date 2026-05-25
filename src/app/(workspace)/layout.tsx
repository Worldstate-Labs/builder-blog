import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getCurrentSession } from "@/lib/auth";

export default async function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");

  return <AppShell session={session}>{children}</AppShell>;
}
