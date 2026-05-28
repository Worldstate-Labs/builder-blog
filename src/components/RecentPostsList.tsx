"use client";

import { FetchedPostCard, type FetchedPostCardPost } from "@/components/FetchedPostCard";
import { markPostRead } from "@/lib/mark-read";

type RecentPostsItem = {
  id: string;
  readKey: string;
  viaLabel: string | null;
  post: FetchedPostCardPost;
};

export function RecentPostsList({
  items,
  readKeys,
}: {
  items: RecentPostsItem[];
  readKeys: string[];
}) {
  const readKeySet = new Set(readKeys);

  return (
    <ul className="grid gap-4">
      {items.map((item) => (
        <li key={item.id}>
          <FetchedPostCard
            dataRead={readKeySet.has(item.readKey)}
            extraMeta={item.viaLabel ? <span>{item.viaLabel}</span> : null}
            onInteract={() => markPostRead(item.id)}
            post={item.post}
            showBuilderRow={false}
          />
        </li>
      ))}
    </ul>
  );
}
