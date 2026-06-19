import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpenCheck, Rss, Search } from "lucide-react";
import { AuthButtons } from "@/components/AuthButtons";
import { PublicHeader } from "@/components/PublicHeader";
import { getCurrentSession } from "@/lib/auth";

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
            Sign in to{" "}
            <span className="fb-login-title-break">FollowBrief.</span>
          </h1>
          <p className="fb-login-copy">
            Follow sources, build AI Digest, and search your workspace.
          </p>
          <div className="fb-login-proof-rail" aria-label="Workspace capabilities">
            <LoginProof icon={Rss} label="Follow sources" />
            <LoginProof icon={BookOpenCheck} label="Build AI Digest" />
            <LoginProof icon={Search} label="Search" />
          </div>
        </section>

        <section className="fb-dark-panel">
          <div className="fb-login-panel-head">
            <div>
              <h2 className="fb-login-panel-title">
                Sign in
              </h2>
              <p className="fb-login-panel-copy">
                Use one account for the app and Local Agent.
              </p>
            </div>
          </div>
          {errorMessage ? (
            <div
              className="fb-login-error"
              role="alert"
            >
              {errorMessage}
            </div>
          ) : null}
          <div className="fb-login-auth">
            <AuthButtons callbackUrl={safeCallbackUrl(params.callbackUrl)} />
          </div>
          <p className="fb-login-panel-copy">
            By signing in, you can review the{" "}
            <Link href="/privacy">Privacy Policy</Link> and{" "}
            <Link href="/terms">Terms</Link>.
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
function describeAuthError(code: string | undefined): string | null {
  if (!code) return null;
  const messages: Record<string, string> = {
    OAuthAccountNotLinked:
      "This email uses a different sign-in method. Use that method or contact support.",
    OAuthSignin: "Could not start sign in. Try again.",
    OAuthCallback: "Could not finish sign in. Try again.",
    OAuthCreateAccount: "Could not create your account. Try again.",
    Callback: "Could not finish sign in. Try again.",
    AccessDenied: "Sign in was denied.",
    SessionRequired: "Sign in to continue.",
  };
  return messages[code] ?? "Could not sign in. Try again.";
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
  label: string;
}) {
  return (
    <div className="fb-login-proof">
      <Icon className="fb-login-proof-icon" aria-hidden="true" />
      <div className="fb-login-proof-label">{label}</div>
    </div>
  );
}
