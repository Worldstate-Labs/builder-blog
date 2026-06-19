"use client";

import Link from "next/link";
import {
  PostCardView,
  type PostCardLinkProps,
  type PostCardViewProps,
} from "@/components/PostCardView";

export type { PostCardPost } from "@/components/PostCardView";

// Container: injects Next's Link so the app keeps client-side (soft)
// navigation. All presentation lives in PostCardView, which is dependency-free
// and is what Storybook / design-sync render. Call sites use PostCard
// unchanged — the link injection is invisible to them.
function NextLink({ href, children, ...rest }: PostCardLinkProps) {
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}

export function PostCard(props: Omit<PostCardViewProps, "linkComponent">) {
  return <PostCardView {...props} linkComponent={NextLink} />;
}
