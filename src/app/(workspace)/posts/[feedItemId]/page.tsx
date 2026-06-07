import { PostDetailPage } from "@/components/PostDetailPage";

export default async function PostPage({
  params,
  searchParams,
}: {
  params: Promise<{ feedItemId: string }>;
  searchParams: Promise<{ returnLabel?: string | string[]; returnTo?: string | string[] }>;
}) {
  const { feedItemId } = await params;
  return <PostDetailPage feedItemId={feedItemId} searchParams={searchParams} />;
}
