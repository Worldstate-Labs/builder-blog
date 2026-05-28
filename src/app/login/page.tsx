import { redirect } from "next/navigation";
import { Archive, KeyRound, Search, ShieldCheck } from "lucide-react";
import { AuthButtons } from "@/components/AuthButtons";
import { BrandMark } from "@/components/BrandMark";
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
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-between gap-10 lg:flex-row lg:items-center lg:justify-center lg:gap-12">
        <section>
          <div className="flex items-center gap-3">
            <BrandMark size="dark" />
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/50">
              FollowBrief
            </p>
          </div>
          <h1 className="serif mt-7 text-4xl font-semibold leading-[1.05] tracking-tight text-white md:text-5xl lg:text-6xl">
            Sign in to your<br />briefing desk.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-white/68 md:text-lg">
            Follow people and sources, collect new updates, and publish your
            agent-generated digests to a searchable archive.
          </p>
          <div className="mt-8 hidden max-w-lg gap-2.5 sm:grid sm:grid-cols-3 lg:grid">
            <LoginProof icon={Archive} label="Archive" />
            <LoginProof icon={Search} label="Search" />
            <LoginProof icon={KeyRound} label="Agent token" />
          </div>
        </section>

        <section className="fb-dark-panel lg:max-w-md">
          <div className="flex items-start justify-between gap-5">
            <div>
              <h2 className="serif text-[1.35rem] font-semibold leading-tight tracking-tight md:text-[1.65rem]">
                Continue securely
              </h2>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-white/62 md:text-[13px]">
                Use the same identity for your web archive and terminal agent bridge.
              </p>
            </div>
            <span className="rounded-lg bg-white/10 p-2 text-white/70">
              <ShieldCheck className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
          </div>
          {errorMessage ? (
            <div
              className="mt-5 rounded-lg border border-white/15 bg-white/5 px-3.5 py-3 text-[12.5px] leading-relaxed text-white/80"
              role="alert"
            >
              {errorMessage}
            </div>
          ) : null}
          <div className="mt-5">
            <AuthButtons callbackUrl={safeCallbackUrl(params.callbackUrl)} />
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-white/42">
            Tokens for terminal use are created after sign-in from Settings.
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
    OAuthCallback: "The provider rejected the sign-in callback. Try again.",
    OAuthCreateAccount: "Could not create your account. Try again.",
    Callback: "Sign-in callback failed. Try again.",
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
  icon: typeof Archive;
  label: string;
}) {
  return (
    <div className="fb-dark-proof">
      <Icon className="h-4 w-4 text-white/62" aria-hidden="true" />
      <div className="mt-2.5 text-[13px] font-bold text-white/82">{label}</div>
    </div>
  );
}
