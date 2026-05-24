import { redirect } from "next/navigation";
import { Archive, KeyRound, Search, ShieldCheck } from "lucide-react";
import { AuthButtons } from "@/components/AuthButtons";
import { BrandMark } from "@/components/BrandMark";
import { getCurrentSession } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const params = await searchParams;
  const session = await getCurrentSession();
  if (session) redirect("/dashboard");

  return (
    <main className="min-h-screen bg-[var(--charcoal)] px-6 py-8 text-white">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-10 lg:grid-cols-[1.08fr_0.92fr]">
        <section>
          <div className="flex items-center gap-3">
            <BrandMark />
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/50">
              FollowBrief
            </p>
          </div>
          <h1 className="mt-7 max-w-3xl font-serif text-5xl font-semibold leading-[1.02] md:text-7xl">
            Sign in to your briefing desk.
          </h1>
          <p className="mt-7 max-w-2xl text-xl leading-9 text-white/68">
            Follow people and sources, collect new updates, and publish your
            agent-generated digests to a searchable archive.
          </p>
          <div className="mt-10 grid max-w-2xl gap-3 sm:grid-cols-3">
            <LoginProof icon={Archive} label="Archive" />
            <LoginProof icon={Search} label="Search" />
            <LoginProof icon={KeyRound} label="Agent token" />
          </div>
        </section>
        <section className="rounded-lg border border-white/12 bg-white/[0.07] p-6 shadow-2xl shadow-black/30 backdrop-blur md:p-7">
          <div className="flex items-start justify-between gap-5">
            <div>
              <h2 className="font-serif text-3xl">Continue securely</h2>
              <p className="mt-3 text-sm leading-6 text-white/62">
                Use the same identity for your web archive and terminal agent bridge.
              </p>
            </div>
            <span className="rounded-lg bg-white/10 p-2 text-white/70">
              <ShieldCheck className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-white/62">
            OAuth credentials are read from env. Configure Google and GitHub in
            `.env`, then use either provider.
          </p>
          <div className="mt-8">
            <AuthButtons callbackUrl={params.callbackUrl ?? "/dashboard"} />
          </div>
          <p className="mt-6 text-xs leading-5 text-white/42">
            Tokens for terminal use are created after sign-in from Settings.
          </p>
        </section>
      </div>
    </main>
  );
}

function LoginProof({
  icon: Icon,
  label,
}: {
  icon: typeof Archive;
  label: string;
}) {
  return (
    <div className="rounded-lg border border-white/12 bg-white/[0.06] p-3">
      <Icon className="h-4 w-4 text-white/62" />
      <div className="mt-3 text-sm font-semibold text-white/82">{label}</div>
    </div>
  );
}
