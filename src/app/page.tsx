import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/dashboard");

  return (
    <main className="landing-grid min-h-screen px-6 py-8">
      <nav className="mx-auto flex max-w-7xl items-center justify-between">
        <Link href="/" className="font-serif text-2xl tracking-[-0.04em]">
          Builder Blog
        </Link>
        <Link className="button-dark" href="/login">
          Sign in
        </Link>
      </nav>
      <section className="mx-auto grid max-w-7xl gap-12 py-20 lg:grid-cols-[1fr_0.82fr] lg:py-28">
        <div>
          <h1 className="max-w-4xl font-serif text-7xl leading-[0.92] tracking-[-0.065em] text-[var(--ink)] md:text-8xl">
            A web-native digest for people building with AI.
          </h1>
          <p className="mt-8 max-w-2xl text-xl leading-9 text-[var(--muted-strong)]">
            Centralized public crawling, personal agent-synced builders,
            generated digests, and a permanent searchable archive.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link className="button-dark" href="/login">
              Start with OAuth
            </Link>
            <a className="button-light" href="#how-it-works">
              See workflow
            </a>
          </div>
        </div>
        <div className="hero-panel">
          <div className="text-xs uppercase tracking-[0.28em] text-[var(--accent)]">
            Today&apos;s signal
          </div>
          <div className="mt-8 space-y-5">
            {["Launches", "Architecture notes", "Hard opinions"].map((item) => (
              <div key={item} className="rounded-3xl border border-black/10 bg-white/72 p-5">
                <div className="font-serif text-2xl">{item}</div>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  Filtered through the shared library and your personal agent
                  syncs, then archived in one place.
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section id="how-it-works" className="mx-auto max-w-7xl border-t border-black/10 py-12">
        <div className="grid gap-5 md:grid-cols-3">
          {[
            "Admins manage the central builder pool.",
            "User agents sync personal builders with user-owned credentials.",
            "The skill summarizes both libraries and syncs each digest.",
          ].map((copy, index) => (
            <div key={copy} className="rounded-[2rem] bg-[var(--ink)] p-6 text-white">
              <div className="font-serif text-5xl">0{index + 1}</div>
              <p className="mt-6 text-lg leading-8 text-white/72">{copy}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
