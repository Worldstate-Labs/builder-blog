"use client";

import Link from "next/link";
import type { Session } from "next-auth";
import { BrandMark } from "@/components/BrandMark";
import { HeaderAccountControls } from "@/components/HeaderAccountControls";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useI18n } from "@/components/I18nProvider";

type PublicHeaderPage = "home" | "login" | "privacy" | "terms";

export function PublicHeader({
  current,
  session,
}: {
  current: PublicHeaderPage;
  session?: Session | null;
}) {
  return (
    <>
      <header className="fb-top fb-public-top">
        <div className="fb-top-inner fb-public-top-inner">
          <Link href="/" className="fb-brand">
            <BrandMark />
            <span className="fb-brand-name">FollowBrief</span>
          </Link>
          <div className="fb-public-top-actions">
            <PublicHeaderActions current={current} session={session} />
          </div>
        </div>
      </header>

      <header className="fb-m-top fb-public-m-top">
        <Link href="/" className="fb-brand">
          <BrandMark />
          <span className="fb-brand-name">FollowBrief</span>
        </Link>
        <span className="fb-m-spacer" />
        <div className="fb-public-mobile-actions">
          <PublicHeaderActions current={current} session={session} />
        </div>
      </header>
    </>
  );
}

function PublicHeaderActions({
  current,
  session,
}: {
  current: PublicHeaderPage;
  session?: Session | null;
}) {
  const { t } = useI18n();
  const isLegalPage = current === "privacy" || current === "terms";
  const showSignIn = current !== "login" && !session;
  const showLegalLinks = isLegalPage && !session;

  if (isLegalPage) {
    return session ? (
      <HeaderAccountControls session={session} />
    ) : (
      <>
        {showLegalLinks ? (
          <>
            <LanguageSwitcher compact />
            <ThemeToggle />
            <Link className="fb-login-nav-link" href="/privacy">
              {t("common.privacy")}
            </Link>
            <Link className="fb-login-nav-link" href="/terms">
              {t("common.terms")}
            </Link>
          </>
        ) : null}
        <Link className="fb-btn dark fb-public-header-primary" href="/login">
          {t("common.signIn")}
        </Link>
      </>
    );
  }

  return (
    <>
      <LanguageSwitcher compact />
      <ThemeToggle />
      <Link className="fb-login-nav-link" href="/privacy">
        {t("common.privacy")}
      </Link>
      <Link className="fb-login-nav-link" href="/terms">
        {t("common.terms")}
      </Link>
      {showSignIn ? (
        <Link className="fb-btn dark fb-public-header-primary" href="/login">
          {t("common.signIn")}
        </Link>
      ) : null}
    </>
  );
}
