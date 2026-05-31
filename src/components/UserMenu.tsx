"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import { signOut } from "next-auth/react";
import type { Session } from "next-auth";
import { LogOut, Moon, Settings, ShieldCheck, Sun } from "lucide-react";
import { setTheme, useHydrated, useTheme } from "@/components/ThemeToggle";

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
  const theme = useTheme();
  const themeHydrated = useHydrated();
  const user = session?.user;
  const name = user?.name || user?.email?.split("@")[0] || "User";
  const email = user?.email || "";
  const initial = name.trim().charAt(0).toUpperCase() || "U";

  function closeMenu() {
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
  }

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  return (
    <details ref={detailsRef} className={`user-menu ${compact ? "user-menu-compact" : ""}`}>
      <summary
        aria-label={email ? `Account menu for ${email}` : `Account menu for ${name}`}
        className="user-menu-trigger"
      >
        {user?.image ? (
          <Image
            alt=""
            aria-hidden="true"
            className="user-avatar fb-avatar"
            src={user.image}
            width={32}
            height={32}
            unoptimized
          />
        ) : (
          <span className="fb-avatar" aria-hidden="true">
            {initial}
          </span>
        )}
        {!compact ? (
          <span className="user-menu-copy">
            <span className="user-menu-name">{name}</span>
            <span className="user-menu-email" title={email}>
              {email}
            </span>
          </span>
        ) : null}
      </summary>
      <div className="user-menu-popover">
        {email ? (
          <p className="user-menu-popover-email" title={email}>
            {email}
          </p>
        ) : null}
        {isAdmin ? (
          <span className="user-menu-item user-menu-item-static">
            <ShieldCheck className="h-4 w-4" />
            Admin
          </span>
        ) : null}
        <Link className="user-menu-item" href="/settings" onClick={closeMenu}>
          <Settings className="h-4 w-4" />
          Settings
        </Link>
        <button
          className="user-menu-item w-full text-left"
          onClick={toggleTheme}
          type="button"
        >
          {themeHydrated && theme === "dark" ? (
            <Sun className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Moon className="h-4 w-4" aria-hidden="true" />
          )}
          {themeHydrated && theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <div className="user-menu-separator" />
        <button
          className="user-menu-item w-full text-left"
          onClick={() => {
            closeMenu();
            // POST directly via next-auth so we skip NextAuth's GET
            // confirmation page ("Sign out?") and log out in one click.
            void signOut({ callbackUrl: "/login" });
          }}
          type="button"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </details>
  );
}
