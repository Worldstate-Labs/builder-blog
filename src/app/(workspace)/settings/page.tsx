import { redirect } from "next/navigation";
import { Suspense } from "react";
import { KeyRound } from "lucide-react";
import { AgentTokenPanel } from "@/components/AgentTokenPanel";
import { FeedPreferenceForm } from "@/components/FeedPreferenceForm";
import { getCurrentSession } from "@/lib/auth";
import {
  defaultDigestMaxPostAgeDays,
  digestFrequencyDays,
} from "@/lib/feed-preferences";
import { prisma } from "@/lib/prisma";

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
            Configure feed preferences and agent access.
          </p>
        </div>
        <Suspense fallback={<ActiveTokenChipFallback />}>
          <ActiveTokenChip userId={userId} />
        </Suspense>
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="fb-panel">
          <h2 className="fb-section-heading">Feed preferences</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--muted-strong)]">
            Digest generation uses these settings when the skill asks for
            context. Recommendations use the profile text and reading log to
            rank unread summarized posts.
          </p>
          <Suspense fallback={<FeedPreferenceSkeleton />}>
            <FeedPreferenceSlot userId={userId} />
          </Suspense>
        </section>

        <Suspense fallback={<AgentTokenPanelSkeleton />}>
          <AgentTokenSlot userId={userId} />
        </Suspense>
      </div>
    </div>
  );
}

async function ActiveTokenChip({ userId }: { userId: string }) {
  const count = await prisma.agentToken.count({
    where: { userId, revokedAt: null },
  });
  return (
    <span className="fb-chip">
      <KeyRound aria-hidden="true" />
      {count} active tokens
    </span>
  );
}

function ActiveTokenChipFallback() {
  return (
    <span className="fb-chip" aria-busy="true" aria-live="polite">
      <KeyRound aria-hidden="true" />
      <span className="inline-block h-3 w-16 animate-pulse rounded-full bg-black/10" />
    </span>
  );
}

async function FeedPreferenceSlot({ userId }: { userId: string }) {
  const preference = await prisma.userFeedPreference.findUnique({
    where: { userId },
  });
  const digestFrequency = preference?.digestFrequency ?? "DAILY";
  const digestCustomFrequencyDays =
    preference?.digestCustomFrequencyDays ?? digestFrequencyDays(preference);
  const digestMaxAge =
    preference?.digestMaxPostAgeDays ?? defaultDigestMaxPostAgeDays;

  return (
    <FeedPreferenceForm
      initialValue={{
        digestFrequency,
        digestCustomFrequencyDays,
        digestMaxPostAgeDays: digestMaxAge,
        recommendationProfile: preference?.recommendationProfile ?? "",
      }}
    />
  );
}

function FeedPreferenceSkeleton() {
  return (
    <div className="mt-4 grid gap-4" aria-busy="true" aria-live="polite">
      <div className="grid gap-2">
        <div className="h-3 w-32 animate-pulse rounded bg-black/10" />
        <div className="flex gap-2">
          <div className="h-9 w-16 animate-pulse rounded-full bg-black/10" />
          <div className="h-9 w-20 animate-pulse rounded-full bg-black/10" />
          <div className="h-9 w-20 animate-pulse rounded-full bg-black/10" />
        </div>
      </div>
      <div className="grid gap-2">
        <div className="h-3 w-32 animate-pulse rounded bg-black/10" />
        <div className="h-10 w-24 animate-pulse rounded bg-black/10" />
      </div>
      <div className="grid gap-2">
        <div className="h-3 w-44 animate-pulse rounded bg-black/10" />
        <div className="h-24 animate-pulse rounded bg-black/10" />
      </div>
      <div className="flex gap-2">
        <div className="h-9 w-32 animate-pulse rounded-full bg-black/10" />
        <div className="h-9 w-20 animate-pulse rounded-full bg-black/10" />
      </div>
    </div>
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
    revokedAt: token.revokedAt?.toISOString() ?? null,
  }));
  return <AgentTokenPanel initialTokens={serializedTokens} />;
}

function AgentTokenPanelSkeleton() {
  return (
    <section className="fb-panel" aria-busy="true" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-2">
          <div className="h-5 w-32 animate-pulse rounded bg-black/10" />
          <div className="h-3 w-64 animate-pulse rounded bg-black/10" />
        </div>
        <div className="h-8 w-24 animate-pulse rounded-full bg-black/10" />
      </div>
      <div className="mt-4 h-11 animate-pulse rounded-[10px] bg-black/10" />
      <div className="mt-4 grid gap-2 overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--paper-strong)] p-3">
        <div className="h-12 animate-pulse rounded bg-black/10" />
        <div className="h-12 animate-pulse rounded bg-black/10" />
        <div className="h-12 animate-pulse rounded bg-black/10" />
      </div>
    </section>
  );
}
