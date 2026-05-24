import { redirect } from "next/navigation";
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
    <div className="page-pad">
        <section className="page-header">
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-description">
              Configure feed preferences and agent access.
            </p>
          </div>
          <span className="status-chip">
            <KeyRound className="h-3.5 w-3.5" />
            {tokens.filter((token) => !token.revokedAt).length} active
          </span>
        </section>

        <section className="action-panel mt-6 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="section-heading">Feed preferences</h2>
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
  );
}
