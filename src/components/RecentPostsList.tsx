"use client";

import { PostCard, type PostCardPost } from "@/components/PostCard";
import { markPostRead } from "@/lib/mark-read";

type RecentPostsItem = {
  id: string;
  readKey: string;
  viaLabel: string | null;
  post: PostCardPost;
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
    <ul className="recent-post-list">
      {items.map((item) => (
        <li key={item.id}>
          <PostCard
            dataRead={readKeySet.has(item.readKey)}
            extraMeta={item.viaLabel ? <span>{item.viaLabel}</span> : null}
            onInteract={() => markPostRead(item.id)}
            post={item.post}
          />
        </li>
      ))}
    </ul>
  );
}
