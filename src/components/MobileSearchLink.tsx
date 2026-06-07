"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

export function MobileSearchLink() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnTo = pathname.startsWith("/posts/")
    ? searchParams.get("returnTo") ?? ""
    : "";
  const active = pathname === "/search" || returnTo.startsWith("/search");

  return (
    <Link
      aria-current={active ? "page" : undefined}
      aria-label="Search"
      className={`fb-m-icon${active ? " active" : ""}`}
      data-active={active ? "true" : undefined}
      href="/search"
    >
      <Search aria-hidden="true" />
    </Link>
  );
}
