import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpenCheck, Search, UsersRound } from "lucide-react";
import { AuthButtons } from "@/components/AuthButtons";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";
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
    <main className="fb-dark-frame">
      <nav className="fb-login-nav">
        <Link href="/" className="fb-login-nav-brand">
          <BrandMark />
          <span className="fb-login-nav-name">FollowBrief</span>
        </Link>
        <div className="fb-login-nav-actions">
          <ThemeToggle />
          <Link className="fb-login-nav-link" href="/">
            Home
          </Link>
        </div>
      </nav>

      <div className="fb-login-shell">
        <section className="fb-login-intro">
          <h1 className="fb-login-title">
            Sign in to your{" "}
            <span className="fb-login-title-break">FollowBrief workspace.</span>
          </h1>
          <p className="fb-login-copy">
            Follow source libraries, read AI Digests, and keep sources, posts,
            and AI Digest archives searchable.
          </p>
          <div className="fb-login-proof-rail" aria-label="Workspace capabilities">
            <LoginProof icon={UsersRound} label="Follow" />
            <LoginProof icon={BookOpenCheck} label="Build AI Digest" />
            <LoginProof icon={Search} label="Search workspace" />
          </div>
        </section>

        <section className="fb-dark-panel">
          <div className="fb-login-panel-head">
            <div>
              <h2 className="fb-login-panel-title">
                Sign in
              </h2>
              <p className="fb-login-panel-copy">
                Use one account for FollowBrief and your Local Agent.
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
          <p className="fb-login-note">
            Access keys are set up after sign-in from Settings.
          </p>
        </section>
      </div>
    </main>
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
      "This email is already linked to a different sign-in method. Use the original method, or contact support to merge accounts.",
    OAuthSignin: "Could not start the sign-in flow. Try again.",
    OAuthCallback: "The sign-in service could not finish. Try again.",
    OAuthCreateAccount: "Could not create your account. Try again.",
    Callback: "Sign-in could not finish. Try again.",
    AccessDenied: "Sign-in was denied.",
    SessionRequired: "Please sign in to continue.",
  };
  return messages[code] ?? "Sign-in failed. Try again.";
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
