"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import type { Session } from "next-auth";
import { usePathname } from "next/navigation";
import { FileText, LogOut, Scale, Settings, ShieldCheck, UserRound } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { UserName } from "@/components/UserName";

function AccountAvatar({ image }: { image?: string | null }) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  if (image && !avatarFailed) {
    return (
      <Image
        alt=""
        aria-hidden="true"
        className="user-avatar fb-avatar"
        height={32}
        onError={() => setAvatarFailed(true)}
        src={image}
        unoptimized
        width={32}
      />
    );
  }
  return (
    <span className="user-avatar fb-avatar" aria-hidden="true">
      <UserRound size={18} strokeWidth={2} />
    </span>
  );
}

export function UserMenu({
  compact = false,
  isAdmin = false,
  session,
}: {
  compact?: boolean;
  isAdmin?: boolean;
  session?: Session | null;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const popoverId = useId();
  const pathname = usePathname();
  const { t } = useI18n();
  const user = session?.user;
  const name = user?.name || user?.email?.split("@")[0] || "User";
  const email = user?.email || "";
  const settingsActive = pathname === "/settings";

  const closeMenu = useCallback((options?: { restoreFocus?: boolean }) => {
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
    if (options?.restoreFocus) {
      summaryRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    closeMenu();
  }, [closeMenu, pathname]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!detailsRef.current?.open) return;
      if (detailsRef.current.contains(event.target as Node)) return;
      closeMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !detailsRef.current?.open) return;
      event.preventDefault();
      closeMenu({ restoreFocus: true });
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMenu]);

  return (
    <details
      ref={detailsRef}
      className={`user-menu ${compact ? "user-menu-compact" : ""}`}
      onToggle={() => setMenuOpen(detailsRef.current?.open ?? false)}
    >
      <summary
        aria-controls={popoverId}
        aria-expanded={menuOpen ? "true" : "false"}
        aria-label={
          email
            ? t("nav.accountMenuForEmail", { email })
            : t("nav.accountMenuForName", { name })
        }
        className="user-menu-trigger"
        ref={summaryRef}
      >
        <AccountAvatar image={user?.image} key={user?.image ?? "account-avatar-fallback"} />
        {!compact ? (
          <span className="user-menu-copy">
            <UserName className="user-menu-name">{name}</UserName>
            <span className="user-menu-email" title={email}>
              {email}
            </span>
          </span>
        ) : null}
      </summary>
      <div className="user-menu-popover" id={popoverId}>
        {email ? (
          <p className="user-menu-popover-email" title={email}>
            {email}
          </p>
        ) : null}
        {isAdmin ? (
          <span className="user-menu-item user-menu-item-static">
            <ShieldCheck className="user-menu-icon" />
            {t("nav.admin")}
          </span>
        ) : null}
        <Link
          aria-current={settingsActive ? "page" : undefined}
          className="user-menu-item"
          data-active={settingsActive ? "true" : undefined}
          href="/settings"
          onClick={() => closeMenu()}
        >
          <Settings className="user-menu-icon" />
          {t("nav.settings")}
        </Link>
        <Link
          className="user-menu-item"
          href="/privacy"
          onClick={() => closeMenu()}
        >
          <FileText className="user-menu-icon" />
          {t("common.privacy")}
        </Link>
        <Link
          className="user-menu-item"
          href="/terms"
          onClick={() => closeMenu()}
        >
          <Scale className="user-menu-icon" />
          {t("common.terms")}
        </Link>
        <div className="user-menu-separator" />
        <button
          className="user-menu-item"
          onClick={() => {
            closeMenu();
            // POST directly via next-auth so we skip NextAuth's GET
            // confirmation page ("Sign out?") and log out in one click.
            void signOut({ callbackUrl: "/login" });
          }}
          type="button"
        >
          <LogOut className="user-menu-icon" />
          {t("nav.signOut")}
        </button>
      </div>
    </details>
  );
}
