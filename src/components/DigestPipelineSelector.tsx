"use client";

import Link from "next/link";
import {
  DigestPipelineSelectorView,
  type DigestPipelineLinkProps,
  type DigestPipelineSelectorViewProps,
} from "@/components/DigestPipelineSelectorView";

export type { DigestPipelineSelectorOption } from "@/components/DigestPipelineSelectorView";

// Container: injects Next's Link so the selector keeps client-side navigation.
// All presentation lives in DigestPipelineSelectorView (dependency-free).
function NextLink({ href, children, ...rest }: DigestPipelineLinkProps) {
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}

export function DigestPipelineSelector(
  props: Omit<DigestPipelineSelectorViewProps, "linkComponent">,
) {
  return <DigestPipelineSelectorView {...props} linkComponent={NextLink} />;
}
