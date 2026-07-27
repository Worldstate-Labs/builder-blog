import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BookOpenCheck, Rss, Search } from "lucide-react";
import { AuthButtons } from "@/components/AuthButtons";
import { I18nText } from "@/components/I18nProvider";
import { PublicHeader } from "@/components/PublicHeader";
import { getCurrentSession } from "@/lib/auth";
import type { I18nKey } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const params = await searchParams;
  const session = await getCurrentSession();
  if (session) redirect("/dashboard");
  const errorMessage = describeAuthError(params.error);

  return (
    <>
      <PublicHeader current="login" />
      <main className="fb-dark-frame">
      <div className="fb-login-shell">
        <section className="fb-login-intro">
          <h1 className="fb-login-title">
            <I18nText id="login.titlePrefix" />{" "}
            <span className="fb-login-title-break">FollowBrief.</span>
          </h1>
          <p className="fb-login-copy">
            <I18nText id="login.copy" />
          </p>
          <div className="fb-login-proof-rail" aria-label="Workspace capabilities">
            <LoginProof icon={Rss} label={<I18nText id="login.followSources" />} />
            <LoginProof icon={BookOpenCheck} label={<I18nText id="login.buildDigest" />} />
            <LoginProof icon={Search} label={<I18nText id="login.search" />} />
          </div>
        </section>

        <section className="fb-dark-panel">
          <div className="fb-login-panel-head">
            <div>
              <h2 className="fb-login-panel-title">
                <I18nText id="login.panelTitle" />
              </h2>
              <p className="fb-login-panel-copy">
                <I18nText id="login.panelCopy" />
              </p>
            </div>
          </div>
          {errorMessage ? (
            <div
              className="fb-login-error"
              role="alert"
            >
              <I18nText id={errorMessage} />
            </div>
          ) : null}
          <div className="fb-login-auth">
            <AuthButtons callbackUrl={safeCallbackUrl(params.callbackUrl)} />
          </div>
          <p className="fb-login-panel-copy">
            <I18nText id="login.agreementPrefix" />{" "}
            <Link href="/privacy"><I18nText id="common.privacy" /></Link>{" "}
            <I18nText id="login.agreementAnd" />{" "}
            <Link href="/terms"><I18nText id="common.terms" /></Link>.
          </p>
        </section>
      </div>
      </main>
    </>
  );
}

/**
 * Translate NextAuth's `?error=<code>` redirect param into something a
 * reader can act on. Without this, OAuth failures silently bounce the
 * user back to a blank login page and they assume the click did
 * nothing. Keys mirror the codes NextAuth documents in its OAuth
 * callback flow; unknown codes fall through to a generic message.
 */
function describeAuthError(code: string | undefined): I18nKey | null {
  if (!code) return null;
  const messages: Record<string, I18nKey> = {
    OAuthAccountNotLinked: "login.error.OAuthAccountNotLinked",
    OAuthSignin: "login.error.OAuthSignin",
    OAuthCallback: "login.error.OAuthCallback",
    OAuthCreateAccount: "login.error.OAuthCreateAccount",
    Callback: "login.error.Callback",
    AccessDenied: "login.error.AccessDenied",
    SessionRequired: "login.error.SessionRequired",
  };
  return messages[code] ?? "login.error.default";
}

/**
 * Validate `callbackUrl` so an attacker cannot phish via
 * `?callbackUrl=https://evil.example/`. Only same-origin, relative
 * paths (starting with `/` and NOT `//`) are accepted; anything else
 * falls back to the default landing.
 */
function safeCallbackUrl(value: string | undefined): string {
  if (typeof value !== "string") return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  if (value.includes("\\")) return "/dashboard";
  return value;
}

function LoginProof({
  icon: Icon,
  label,
}: {
  icon: typeof BookOpenCheck;
  label: ReactNode;
}) {
  return (
    <div className="fb-login-proof">
      <Icon className="fb-login-proof-icon" aria-hidden="true" />
      <div className="fb-login-proof-label">{label}</div>
    </div>
  );
}
