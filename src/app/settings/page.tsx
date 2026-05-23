import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { AgentTokenPanel } from "@/components/AgentTokenPanel";
import { AppShell } from "@/components/AppShell";
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

  const [tokens, preference] = await Promise.all([
    prisma.agentToken.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.userFeedPreference.findUnique({
      where: { userId: session.user.id },
    }),
  ]);
  const digestFrequency = preference?.digestFrequency ?? "DAILY";
  const digestCustomFrequencyDays =
    preference?.digestCustomFrequencyDays ?? digestFrequencyDays(preference);
  const digestMaxAge =
    preference?.digestMaxPostAgeDays ?? defaultDigestMaxPostAgeDays;
  const serializedTokens = tokens.map((token) => ({
    id: token.id,
    name: token.name,
    createdAt: token.createdAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null,
  }));

  return (
    <AppShell session={session}>
      <div className="page-pad">
        <div className="page-kicker-row">
          <p className="section-label">Settings</p>
          <span className="status-chip">
            <KeyRound className="h-3.5 w-3.5" />
            {tokens.filter((token) => !token.revokedAt).length} active
          </span>
        </div>
        <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight md:text-6xl">
          Settings
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted-strong)]">
          The skill uses an agent token to fetch your library, sync personal
          builder items, and write generated digests back to this archive.
        </p>

        <section className="action-panel mt-8 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-serif text-3xl">Feed preferences</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-strong)]">
                Digest generation uses these settings when the skill asks for
                context. Recommendations use the profile text and reading log
                to rank unread crawled posts.
              </p>
            </div>
          </div>
          <FeedPreferenceForm
            initialValue={{
              digestFrequency,
              digestCustomFrequencyDays,
              digestMaxPostAgeDays: digestMaxAge,
              recommendationProfile: preference?.recommendationProfile ?? "",
            }}
          />
        </section>

        <AgentTokenPanel initialTokens={serializedTokens} />
      </div>
    </AppShell>
  );
}
