import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { AuthButtons } from "@/components/AuthButtons";
import { authOptions } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const params = await searchParams;
  const session = await getServerSession(authOptions);
  if (session) redirect("/dashboard");

  return (
    <main className="min-h-screen bg-[var(--charcoal)] px-6 py-10 text-white">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-12 lg:grid-cols-[1.15fr_0.85fr]">
        <section>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/50">
            Builder Blog
          </p>
          <h1 className="mt-6 max-w-3xl font-serif text-4xl font-semibold leading-tight md:text-6xl">
            Personal AI builder intelligence.
          </h1>
          <p className="mt-8 max-w-2xl text-xl leading-9 text-white/68">
            Subscribe to builders, collect the central crawl, and publish your
            agent-generated digests to a searchable web archive.
          </p>
        </section>
        <section className="rounded-lg border border-white/12 bg-white/[0.06] p-6 shadow-2xl shadow-black/30">
          <h2 className="font-serif text-3xl">Sign in</h2>
          <p className="mt-3 text-sm leading-6 text-white/62">
            OAuth credentials are read from env. Configure Google and GitHub in
            `.env`, then use either provider.
          </p>
          <div className="mt-8">
            <AuthButtons callbackUrl={params.callbackUrl ?? "/dashboard"} />
          </div>
        </section>
      </div>
    </main>
  );
}
