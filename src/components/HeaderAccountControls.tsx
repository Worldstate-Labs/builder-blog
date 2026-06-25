"use client";

import type { Session } from "next-auth";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";

export function HeaderAccountControls({
  isAdmin = false,
  session,
}: {
  isAdmin?: boolean;
  session?: Session | null;
}) {
  return (
    <div className="fb-account-controls">
      <LanguageSwitcher compact />
      <ThemeToggle />
      <UserMenu compact isAdmin={isAdmin} session={session} />
    </div>
  );
}
