import { redirect } from "next/navigation";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  redirect(`/dashboard?tab=subscription&archivePage=${page}#digest-archive`);
}
