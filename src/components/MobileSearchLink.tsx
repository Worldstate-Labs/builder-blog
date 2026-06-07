"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

export function MobileSearchLink() {
  const pathname = usePathname();
  const active = pathname === "/search";

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
