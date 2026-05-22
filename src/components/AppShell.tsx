import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const nav = [
  { href: "/dashboard", label: "Today" },
  { href: "/history", label: "History" },
  { href: "/builders", label: "Builders" },
  { href: "/admin", label: "Admin" },
  { href: "/settings", label: "Agent Login" },
];

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl">
        <aside className="hidden w-64 shrink-0 border-r border-black/10 px-6 py-8 lg:block">
          <Link href="/dashboard" className="group block">
            <div className="text-sm uppercase tracking-[0.32em] text-[var(--muted)]">
              Builder Blog
            </div>
            <div className="mt-3 font-serif text-3xl leading-none">
              Signal over noise
            </div>
          </Link>
          <nav className="mt-12 grid gap-2">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="nav-link">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto pt-12 text-sm text-[var(--muted)]">
            <p>{session?.user?.email}</p>
            <Link className="mt-4 inline-block underline" href="/api/auth/signout">
              Sign out
            </Link>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-black/10 bg-[rgba(247,243,234,0.86)] px-5 py-4 backdrop-blur lg:hidden">
            <div className="flex items-center justify-between gap-4">
              <Link href="/dashboard" className="font-serif text-xl">
                Builder Blog
              </Link>
              <nav className="flex gap-3 overflow-x-auto text-sm">
                {nav.map((item) => (
                  <Link key={item.href} href={item.href} className="underline">
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}
