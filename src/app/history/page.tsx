import { redirect } from "next/navigation";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await searchParams;
  redirect("/dashboard?tab=ai-digest");
}
