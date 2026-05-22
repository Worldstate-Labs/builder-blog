import { getServerSession } from "next-auth";
import { approveDeviceLoginAction } from "@/app/actions";
import { AuthButtons } from "@/components/AuthButtons";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; approved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const code = params.code?.toUpperCase() ?? "";
  const session = await getServerSession(authOptions);
  const device = code ? await prisma.deviceLogin.findUnique({ where: { code } }) : null;

  return (
    <main className="min-h-screen bg-[var(--charcoal)] px-6 py-10 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center">
        <section className="w-full rounded-[2rem] border border-white/12 bg-white/[0.06] p-8 shadow-2xl shadow-black/30">
          <p className="text-sm uppercase tracking-[0.32em] text-white/50">
            Terminal login
          </p>
          <h1 className="mt-4 font-serif text-5xl tracking-[-0.05em]">
            Authorize device
          </h1>
          <p className="mt-5 text-white/68">
            Code: <span className="font-mono text-white">{code || "missing"}</span>
          </p>

          {params.approved ? (
            <p className="mt-8 rounded-3xl bg-emerald-400/15 p-5 text-emerald-100">
              Approved. Return to your terminal.
            </p>
          ) : null}

          {!session ? (
            <div className="mt-8">
              <AuthButtons
                callbackUrl={code ? `/device?code=${code}` : "/device"}
                labelPrefix="Sign in with"
              />
            </div>
          ) : null}

          {session && device && !params.approved ? (
            <form action={approveDeviceLoginAction} className="mt-8">
              <input type="hidden" name="code" value={code} />
              <button className="auth-button" type="submit">
                Approve terminal access
              </button>
            </form>
          ) : null}

          {session && !device ? (
            <p className="mt-8 rounded-3xl bg-red-400/15 p-5 text-red-100">
              Device code not found or expired.
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
