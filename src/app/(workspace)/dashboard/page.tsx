import Link from "next/link";
import { redirect } from "next/navigation";
import { DigestDetails, type DigestSummary } from "@/components/DigestDetails";
import type { DigestSourceLink } from "@/components/DigestContent";
import { EmptyState } from "@/components/EmptyState";
import { CountMeta } from "@/components/Count";
import { FavoritePostsSection } from "@/components/FavoritePostsSection";
import { FollowingRecommendationSection } from "@/components/FollowingRecommendationSection";
import { DashboardHomeTabs } from "@/components/DashboardHomeTabs";
import { getCurrentSession } from "@/lib/auth";
import { displayDigestPipelineTitle } from "@/lib/library-hub";
import { prisma } from "@/lib/prisma";

const digestPickerSize = 100;
const digestSummarySelect = {
  id: true,
  title: true,
  headlineSummary: true,
  itemCount: true,
  language: true,
  createdAt: true,
};
type DigestSummaryRow = Omit<DigestSummary, "createdAt"> & { createdAt: Date };
type DigestPipelineOption = {
  id: string;
  title: string;
  ownerLabel: string;
  ownerUserId: string;
  isOwnPipeline: boolean;
};

type DashboardSearchParams = Promise<{
  digest?: string | string[];
  pipeline?: string | string[];
  tab?: string | string[];
}>;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const params = await searchParams;
  const selectedTab = parseTab(firstParam(params.tab));
  const digestId = firstParam(params.digest);
  const pipelineId = firstParam(params.pipeline);
  const aiDigest = await AiDigestFeedSlot({ userId, digestId, pipelineId });

  return (
    <div className="page-pad page-pad--reading home-page">
      <h1 className="sr-only">Home</h1>

      <section className="workspace-content-stack home-workspace">
        <DashboardHomeTabs
          initialTab={selectedTab}
          aiDigest={aiDigest}
          favorites={<FavoritePostsSection />}
          subscription={<FollowingRecommendationSection />}
        />
      </section>
    </div>
  );
}

async function AiDigestFeedSlot({
  userId,
  digestId,
  pipelineId,
}: {
  userId: string;
  digestId?: string;
  pipelineId?: string;
}) {
  const [importedDigestPipelines, ownPipelineShare] = await Promise.all([
    prisma.digestPipelineImport.findMany({
      where: { userId, pipeline: { isPublic: true } },
      include: {
        pipeline: {
          include: {
            owner: { select: { name: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.digestPipelineShare.findUnique({
      where: { ownerUserId: userId },
      select: { title: true },
    }),
  ]);
  const ownPipelineTitle = displayDigestPipelineTitle(ownPipelineShare?.title ?? "AI Digest");
  const digestPipelineOptions: DigestPipelineOption[] = [
    {
      id: "own",
      title: ownPipelineTitle,
      ownerLabel: "Your AI Digest",
      ownerUserId: userId,
      isOwnPipeline: true,
    },
    ...importedDigestPipelines.map(({ pipeline }) => ({
      id: pipeline.id,
      title: displayDigestPipelineTitle(pipeline.title),
      ownerLabel: `Imported from ${pipeline.owner.name || pipeline.owner.email || "a FollowBrief user"}`,
      ownerUserId: pipeline.ownerUserId,
      isOwnPipeline: false,
    })),
  ];
  const selectedPipeline =
    digestPipelineOptions.find((pipeline) => pipeline.id === pipelineId) ??
    digestPipelineOptions[0];
  const digestOwnerUserId = selectedPipeline.ownerUserId;

  const [
    digestSummaries,
    digestSourceLinks,
  ] = await Promise.all([
      // The digest picker lists the latest digest plus archived digests in one
      // control. Keep this as summaries only; the body is fetched on demand.
      prisma.digest.findMany({
        where: { userId: digestOwnerUserId, itemCount: { gt: 0 } },
        orderBy: { createdAt: "desc" },
        take: digestPickerSize,
        select: digestSummarySelect,
      }),
      digestSourceLinksForUser(digestOwnerUserId),
    ]);

  const latestDigest = digestSummaries[0] ?? null;
  const selectedDigest =
    digestSummaries.find((digest) => digest.id === digestId) ??
    latestDigest;

  return (
    <AiDigestFeed
      digestPipelineOptions={digestPipelineOptions}
      sourceLinks={digestSourceLinks}
      digestSummaries={digestSummaries}
      latestDigest={latestDigest}
      selectedDigest={selectedDigest}
      selectedPipeline={selectedPipeline}
    />
  );
}

function AiDigestFeed({
  digestPipelineOptions,
  sourceLinks,
  digestSummaries,
  latestDigest,
  selectedDigest,
  selectedPipeline,
}: {
  digestPipelineOptions: DigestPipelineOption[];
  sourceLinks: DigestSourceLink[];
  digestSummaries: DigestSummaryRow[];
  latestDigest: DigestSummaryRow | null;
  selectedDigest: DigestSummaryRow | null;
  selectedPipeline: DigestPipelineOption;
}) {
  const isOwnPipeline = selectedPipeline.isOwnPipeline;

  return (
    <section className="ai-digest-stack">
      <DigestPipelineSelector
        options={digestPipelineOptions}
        selectedPipelineId={selectedPipeline.id}
      />
      <section className="ai-digest-panel">
        <div className="ai-digest-body">
          <section className="ai-digest-section" aria-label="Selected digest">
            {selectedDigest ? (
              <DigestDetails
                digest={serializeDigestSummary(selectedDigest)}
                headerAction={
                  digestSummaries.length > 0 ? (
                    <DigestArchiveSelector
                      digests={digestSummaries}
                      isOwnPipeline={isOwnPipeline}
                      latestDigestId={latestDigest?.id ?? null}
                      selectedDigestId={selectedDigest.id}
                      selectedPipelineId={selectedPipeline.id}
                    />
                  ) : null
                }
                isLatest={selectedDigest.id === latestDigest?.id}
                mode="today"
                sourceLinks={sourceLinks}
              />
            ) : (
              <EmptyState
                className="ai-digest-empty"
                title="No digest yet"
                body={
                  isOwnPipeline
                    ? "Your local helper can save a brief when followed sources have new activity."
                    : "This imported digest has no saved briefs yet."
                }
              />
            )}
          </section>

          {isOwnPipeline ? null : (
            <p className="sr-only">Imported digest view: read-only results.</p>
          )}
        </div>
      </section>
    </section>
  );
}

function DigestArchiveSelector({
  digests,
  isOwnPipeline,
  latestDigestId,
  selectedDigestId,
  selectedPipelineId,
}: {
  digests: DigestSummaryRow[];
  isOwnPipeline: boolean;
  latestDigestId: string | null;
  selectedDigestId: string | null;
  selectedPipelineId: string;
}) {
  const selectedDigest = digests.find((digest) => digest.id === selectedDigestId) ?? digests[0];

  return (
    <details className="digest-picker">
      <summary className="digest-picker-summary">
        <span className="sr-only">Digest history</span>
        <DigestPickerItem digest={selectedDigest} isLatest={selectedDigest.id === latestDigestId} />
      </summary>
      <div className="digest-picker-menu" role="listbox" aria-label="Digest archive">
        {digests.map((digest) => (
          <Link
            aria-current={digest.id === selectedDigest.id ? "true" : undefined}
            className="digest-picker-option"
            href={digestHref({ digestId: digest.id, isOwnPipeline, selectedPipelineId })}
            key={digest.id}
            role="option"
          >
            <DigestPickerItem digest={digest} isLatest={digest.id === latestDigestId} />
          </Link>
        ))}
      </div>
    </details>
  );
}

function DigestPickerItem({
  digest,
  isLatest,
}: {
  digest: DigestSummaryRow;
  isLatest: boolean;
}) {
  return (
    <span className="digest-picker-item">
      <span className="digest-picker-date">{formatDigestPickerDate(digest.createdAt)}</span>
      <CountMeta label={digest.itemCount === 1 ? "item" : "items"} value={digest.itemCount} />
      {isLatest ? <span className="digest-latest-mark">Latest</span> : null}
    </span>
  );
}

function digestHref({
  digestId,
  isOwnPipeline,
  selectedPipelineId,
}: {
  digestId: string;
  isOwnPipeline: boolean;
  selectedPipelineId: string;
}) {
  const params = new URLSearchParams({ tab: "ai-digest", digest: digestId });
  if (!isOwnPipeline) params.set("pipeline", selectedPipelineId);
  return `/dashboard?${params.toString()}`;
}

function DigestPipelineSelector({
  options,
  selectedPipelineId,
}: {
  options: DigestPipelineOption[];
  selectedPipelineId: string;
}) {
  if (options.length <= 1) return null;

  return (
    <section aria-label="Digest source" className="digest-source-selector">
      <div className="digest-source-list">
        {options.map((pipeline) => {
          const active = pipeline.id === selectedPipelineId;
          const href = pipeline.isOwnPipeline
            ? "/dashboard?tab=ai-digest"
            : `/dashboard?tab=ai-digest&pipeline=${pipeline.id}`;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className="digest-source-pill"
              href={href}
              key={pipeline.id}
            >
              <span className="digest-source-title">{pipeline.title}</span>
              <span className="sr-only">{pipeline.ownerLabel}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function digestSourceLinksForUser(userId: string): Promise<DigestSourceLink[]> {
  const subscriptions = await prisma.subscription.findMany({
    where: { userId },
    include: {
      builder: {
        include: {
          entity: {
            select: {
              handle: true,
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const byEntityId = new Map<string, DigestSourceLink>();
  for (const subscription of subscriptions) {
    const builder = subscription.builder;
    if (!builder?.entity || byEntityId.has(builder.entity.id)) continue;
    byEntityId.set(builder.entity.id, {
      aliases: [builder.name],
      entityId: builder.entity.id,
      fetchUrl: builder.fetchUrl,
      handle: builder.entity.handle ?? builder.handle,
      href: `/builder/${builder.entity.id}`,
      name: builder.entity.name || builder.name,
      sourceUrl: builder.sourceUrl,
    });
  }
  return [...byEntityId.values()];
}

function parseTab(value: string | undefined) {
  if (value === "favorites") return value;
  if (value === "subscription") return value;
  return "ai-digest";
}

function serializeDigestSummary(digest: DigestSummaryRow) {
  return {
    ...digest,
    title: displayDigestTitle(digest.title),
    createdAt: digest.createdAt.toISOString(),
  };
}

function formatDigestPickerDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function displayDigestTitle(title: string) {
  return title.replace(/^AI Builder Digest\b/, "AI Digest");
}
