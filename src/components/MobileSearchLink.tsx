"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { postReturnToFromPath } from "@/lib/navigation";

export function MobileSearchLink() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const returnTo = postReturnToFromPath(pathname, searchParams.get("returnTo"));
  const active = pathname === "/search" || returnTo.startsWith("/search");

  return (
    <Link
      aria-current={active ? "page" : undefined}
      aria-label={t("common.search")}
      className={`fb-m-icon${active ? " active" : ""}`}
      data-active={active ? "true" : undefined}
      href="/search"
    >
      <Search aria-hidden="true" />
    </Link>
  );
}
