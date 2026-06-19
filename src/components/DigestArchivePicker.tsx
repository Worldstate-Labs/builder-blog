"use client";

import Link from "next/link";
import {
  DigestArchivePickerView,
  type DigestArchivePickerViewProps,
  type DigestPickerLinkProps,
} from "@/components/DigestArchivePickerView";

export type { DigestArchivePickerOption } from "@/components/DigestArchivePickerView";

// Container: injects Next's Link so the picker keeps client-side navigation. All
// presentation lives in DigestArchivePickerView (dependency-free, design-ready).
function NextLink({ href, children, ...rest }: DigestPickerLinkProps) {
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}

export function DigestArchivePicker(
  props: Omit<DigestArchivePickerViewProps, "linkComponent">,
) {
  return <DigestArchivePickerView {...props} linkComponent={NextLink} />;
}
