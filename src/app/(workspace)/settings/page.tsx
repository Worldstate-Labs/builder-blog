import { redirect } from "next/navigation";
import { Suspense } from "react";
import { KeyRound } from "lucide-react";
import { AdminDigestConfigForm } from "@/components/AdminDigestConfigForm";
import { AdminSourceTypeManager } from "@/components/AdminSourceTypeManager";
import { AgentTokenPanel } from "@/components/AgentTokenPanel";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SEEDED_SOURCE_IDS } from "@/lib/source-config-seed";
import { getUserDigestConfig, getUserSourceConfigs } from "@/lib/source-config-store";

export default async function SettingsPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  return (
    <div className="page-pad">
      <section className="fb-page-head">
        <div>
          <h1 className="fb-title">Settings</h1>
          <p className="fb-desc">
            Configure feed preferences and local helper access.
          </p>
        </div>
        <Suspense fallback={<ActiveTokenChipFallback />}>
          <ActiveTokenChip userId={userId} />
        </Suspense>
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Suspense fallback={<AgentTokenPanelSkeleton />}>
          <AgentTokenSlot userId={userId} />
        </Suspense>
      </div>

      <Suspense fallback={<SourceTypeConfigSkeleton />}>
        <SourceTypeConfigSection userId={userId} />
      </Suspense>
    </div>
  );
}

async function SourceTypeConfigSection({ userId }: { userId: string }) {
  const [sourceConfigs, digestConfig] = await Promise.all([
    getUserSourceConfigs(userId),
    getUserDigestConfig(userId),
  ]);
  return (
    <section className="mt-10 grid gap-4">
      <header>
        <p className="fb-section-label">Advanced</p>
        <h2 className="fb-section-heading mt-1">Briefing rules</h2>
        <p className="fb-desc mt-1 max-w-3xl">
          Tune how source types are read and how digests are written. Changes
          apply the next time your local helper updates sources.
        </p>
      </header>

      <details className="fb-panel">
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="fb-section-heading">Source types</h3>
            <p className="mt-1 text-sm text-[var(--muted-strong)]">
              How each source type is read, summarized, and filtered.
            </p>
          </div>
          <span className="fb-kind-pill">{sourceConfigs.length} sources</span>
        </summary>
        <div className="mt-4">
          <AdminSourceTypeManager
            initialConfigs={sourceConfigs.map((c) => ({
              sourceId: c.sourceId,
              label: c.label,
              agentDefaultStatus: c.agentDefaultStatus,
              contentQuality: c.contentQuality,
              summaryPromptBody: c.summaryPromptBody,
              fetchPromptBody: c.fetchPromptBody,
              summaryStyle: c.summaryStyle,
              summaryLanguage: c.summaryLanguage,
              summaryLengthHint: c.summaryLengthHint,
              updatedAt: c.updatedAt.toISOString(),
              updatedBy: c.updatedBy,
            }))}
          />
        </div>
      </details>

      <details className="fb-panel">
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="fb-section-heading">Digest composition</h3>
            <p className="mt-1 text-sm text-[var(--muted-strong)]">
              How source summaries are assembled into the daily digest.
            </p>
          </div>
          <span className="fb-kind-pill">one set</span>
        </summary>
        <div className="mt-4">
          <AdminDigestConfigForm
            knownSourceIds={SEEDED_SOURCE_IDS}
            initialConfig={{
              id: digestConfig.userId,
              digestIntro: digestConfig.digestIntro,
              translate: digestConfig.translate,
              digestOrder: digestConfig.digestOrder as string[],
              commonSummaryRules: digestConfig.commonSummaryRules,
              updatedAt: digestConfig.updatedAt.toISOString(),
              updatedBy: digestConfig.updatedBy,
            }}
          />
        </div>
      </details>
    </section>
  );
}

function SourceTypeConfigSkeleton() {
  return (
    <section className="mt-10" aria-busy="true" aria-live="polite">
      <div className="h-3 w-40 animate-pulse rounded bg-[var(--paper-strong)]" />
      <div className="mt-2 h-5 w-64 animate-pulse rounded bg-[var(--paper-strong)]" />
      <div className="mt-5 grid gap-3">
        <div className="h-24 animate-pulse rounded bg-[var(--paper-strong)]" />
        <div className="h-24 animate-pulse rounded bg-[var(--paper-strong)]" />
        <div className="h-24 animate-pulse rounded bg-[var(--paper-strong)]" />
      </div>
    </section>
  );
}

async function ActiveTokenChip({ userId }: { userId: string }) {
  const count = await prisma.agentToken.count({
    where: { userId, revokedAt: null },
  });
  return (
    <span className="fb-chip">
      <KeyRound aria-hidden="true" />
      {count} active access keys
    </span>
  );
}

function ActiveTokenChipFallback() {
  return (
    <span className="fb-chip" aria-busy="true" aria-live="polite">
      <KeyRound aria-hidden="true" />
      <span className="inline-block h-3 w-16 animate-pulse rounded-full bg-[var(--paper-strong)]" />
    </span>
  );
}

async function AgentTokenSlot({ userId }: { userId: string }) {
  const tokens = await prisma.agentToken.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  const serializedTokens = tokens.map((token) => ({
    id: token.id,
    name: token.name,
    createdAt: token.createdAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    lastIp: token.lastIp ?? null,
    lastUserAgent: token.lastUserAgent ?? null,
    lastHostname: token.lastHostname ?? null,
    lastPlatform: token.lastPlatform ?? null,
    lastUser: token.lastUser ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
  }));
  return <AgentTokenPanel initialTokens={serializedTokens} />;
}

function AgentTokenPanelSkeleton() {
  return (
    <section className="fb-panel" aria-busy="true" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-2">
          <div className="h-5 w-32 animate-pulse rounded bg-[var(--paper-strong)]" />
          <div className="h-3 w-64 animate-pulse rounded bg-[var(--paper-strong)]" />
        </div>
        <div className="h-8 w-24 animate-pulse rounded-full bg-[var(--paper-strong)]" />
      </div>
      <div className="mt-4 h-11 animate-pulse rounded-[10px] bg-[var(--paper-strong)]" />
      <div className="mt-4 grid gap-2 overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--paper-strong)] p-3">
        <div className="h-12 animate-pulse rounded bg-[var(--paper-strong)]" />
        <div className="h-12 animate-pulse rounded bg-[var(--paper-strong)]" />
        <div className="h-12 animate-pulse rounded bg-[var(--paper-strong)]" />
      </div>
    </section>
  );
}
