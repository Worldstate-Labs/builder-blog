import { Terminal } from "lucide-react";
import { AuthButtons } from "@/components/AuthButtons";
import { DeviceApproveButton } from "@/components/DeviceApproveButton";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; approved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const code = params.code?.toUpperCase() ?? "";
  const session = await getCurrentSession();
  const device = code ? await prisma.deviceLogin.findUnique({ where: { code } }) : null;

  return (
    <main className="fb-dark-frame">
      <div className="flex flex-1 items-center justify-center">
        <section className="fb-dark-panel w-full max-w-xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/50">
            Terminal login
          </p>
          <h1 className="serif mt-3 text-4xl font-semibold leading-tight tracking-tight">
            Authorize device
          </h1>
          <p className="mt-5 text-[15px] text-white/68">
            Code:{" "}
            <span className="mono ml-1 tracking-[0.04em] text-white">
              {code || "missing"}
            </span>
          </p>

          <div className="mt-6 flex items-center gap-3 rounded-[10px] border border-white/10 bg-white/[0.04] px-4 py-3 text-[13px] text-white/70">
            <Terminal className="h-4 w-4 text-white/60" aria-hidden="true" />
            <span>
              Requested from <span className="mono">~/.builder-blog/builder-digest.mjs</span>
            </span>
          </div>

          <p className="mt-5 text-[13px] leading-relaxed text-white/62">
            Approving this device will let your terminal agent push digests and personal
            sources to FollowBrief on your behalf. You can revoke it any time from Settings.
          </p>

          {params.approved ? (
            <p className="mt-6 rounded-lg border border-emerald-300/30 bg-emerald-400/15 p-4 text-sm text-emerald-100">
              Approved. Return to your terminal.
            </p>
          ) : null}

          {!session ? (
            <div className="mt-6">
              <AuthButtons
                callbackUrl={code ? `/device?code=${code}` : "/device"}
                labelPrefix="Sign in with"
              />
            </div>
          ) : null}

          {session && device && !params.approved ? (
            <DeviceApproveButton code={code} />
          ) : null}

          {session && !device ? (
            <p className="mt-6 rounded-lg border border-red-300/30 bg-red-400/15 p-4 text-sm text-red-100">
              Device code not found or expired.
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
