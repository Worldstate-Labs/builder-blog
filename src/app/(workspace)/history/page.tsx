import { permanentRedirect } from "next/navigation";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await searchParams;
  permanentRedirect("/dashboard?tab=ai-digest");
}
