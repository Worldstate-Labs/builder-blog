"use client";

import Link from "next/link";
import {
  DigestContentView,
  type DigestContentViewProps,
} from "@/components/DigestContentView";
import type { PostCardLinkProps } from "@/components/PostCardView";

export type { DigestFavoriteStateByFeedItemId } from "@/components/DigestContentView";

// Container: injects Next's Link so digest source links and the post cards keep
// client-side navigation. All presentation lives in DigestContentView, which is
// dependency-free and renders PostCardView. Call sites use DigestContent
// unchanged.
function NextLink({ href, children, ...rest }: PostCardLinkProps) {
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}

export function DigestContent(props: Omit<DigestContentViewProps, "linkComponent">) {
  return <DigestContentView {...props} linkComponent={NextLink} />;
}
