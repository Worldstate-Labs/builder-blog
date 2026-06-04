import Link from "next/link";
import { redirect } from "next/navigation";
import { DigestArchivePicker, type DigestArchivePickerOption } from "@/components/DigestArchivePicker";
import { DigestDetails, type DigestSummary } from "@/components/DigestDetails";
import type { DigestSourceLink } from "@/components/DigestContent";
import { EmptyState } from "@/components/EmptyState";
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
  const digestArchiveOptions = digestSummaries.map(serializeDigestArchiveOption);

  return (
    <section className="ai-digest-stack">
      <DigestControlBar
        digestArchiveOptions={digestArchiveOptions}
        isOwnPipeline={isOwnPipeline}
        latestDigestId={latestDigest?.id ?? null}
        options={digestPipelineOptions}
        selectedDigestId={selectedDigest?.id ?? null}
        selectedPipeline={selectedPipeline}
        selectedPipelineId={selectedPipeline.id}
      />
      <section className="ai-digest-panel">
        <div className="ai-digest-body">
          <section className="ai-digest-section" aria-label="Selected digest">
            {selectedDigest ? (
              <DigestDetails
                digest={serializeDigestSummary(selectedDigest)}
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

function DigestControlBar({
  digestArchiveOptions,
  isOwnPipeline,
  latestDigestId,
  options,
  selectedDigestId,
  selectedPipeline,
  selectedPipelineId,
}: {
  digestArchiveOptions: DigestArchivePickerOption[];
  isOwnPipeline: boolean;
  latestDigestId: string | null;
  options: DigestPipelineOption[];
  selectedDigestId: string | null;
  selectedPipeline: DigestPipelineOption;
  selectedPipelineId: string;
}) {
  return (
    <section
      aria-label="Digest selection"
      className="grid gap-3 rounded-[8px] border border-[var(--line)] bg-[var(--paper-strong)] p-3 shadow-[var(--shadow-soft)] md:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)]"
    >
      <DigestPipelineSelector
        options={options}
        selectedPipeline={selectedPipeline}
        selectedPipelineId={selectedPipelineId}
      />
      <div className="grid min-w-0 gap-1">
        <span className="text-[0.68rem] font-[850] uppercase tracking-[0.14em] text-[var(--muted)]">
          Issue
        </span>
        {digestArchiveOptions.length > 0 ? (
          <DigestArchivePicker
            digests={digestArchiveOptions}
            isOwnPipeline={isOwnPipeline}
            latestDigestId={latestDigestId}
            selectedDigestId={selectedDigestId}
            selectedPipelineId={selectedPipelineId}
          />
        ) : (
          <span className="inline-flex min-h-10 items-center rounded-[8px] border border-dashed border-[var(--line)] px-3 text-sm font-[750] text-[var(--muted-strong)]">
            No saved issues
          </span>
        )}
      </div>
    </section>
  );
}

function DigestPipelineSelector({
  options,
  selectedPipeline,
  selectedPipelineId,
}: {
  options: DigestPipelineOption[];
  selectedPipeline: DigestPipelineOption;
  selectedPipelineId: string;
}) {
  const ownerText = selectedPipeline.isOwnPipeline
    ? "Your digest"
    : `${selectedPipeline.ownerLabel} - Read-only`;

  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-[0.68rem] font-[850] uppercase tracking-[0.14em] text-[var(--muted)]">
        Digest
      </span>
      {options.length > 1 ? (
        <details className="group relative min-w-0">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-[8px] border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-left text-sm font-[800] text-[var(--ink)] shadow-[var(--shadow-soft)] transition hover:border-[var(--accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
            <span className="min-w-0 truncate">{selectedPipeline.title}</span>
            <span aria-hidden="true" className="text-[0.7rem] text-[var(--muted)]">
              v
            </span>
          </summary>
          <div className="absolute left-0 right-0 z-20 mt-2 grid gap-1 rounded-[8px] border border-[var(--line)] bg-[var(--paper)] p-1 shadow-[var(--shadow-pop)]">
            {options.map((pipeline) => {
              const active = pipeline.id === selectedPipelineId;
              const href = pipeline.isOwnPipeline
                ? "/dashboard?tab=ai-digest"
                : `/dashboard?tab=ai-digest&pipeline=${pipeline.id}`;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={[
                    "grid min-w-0 gap-0.5 rounded-[6px] px-3 py-2 text-sm text-[var(--ink)] no-underline transition hover:bg-[color-mix(in_oklch,var(--accent)_8%,transparent)]",
                    active ? "bg-[var(--accent-soft)] font-[850] text-[var(--accent-strong)]" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  href={href}
                  key={pipeline.id}
                >
                  <span className="min-w-0 truncate">{pipeline.title}</span>
                  <span className="min-w-0 truncate text-xs font-[650] text-[var(--muted)]">
                    {pipeline.isOwnPipeline ? "Your digest" : pipeline.ownerLabel}
                  </span>
                </Link>
              );
            })}
          </div>
        </details>
      ) : (
        <div className="flex min-h-10 min-w-0 items-center rounded-[8px] border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm font-[800] text-[var(--ink)]">
          <span className="min-w-0 truncate">{selectedPipeline.title}</span>
        </div>
      )}
      <span className="min-w-0 truncate text-xs font-[650] text-[var(--muted)]">
        {ownerText}
      </span>
    </div>
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
      avatarUrl: builder.avatarUrl,
      entityId: builder.entity.id,
      fetchUrl: builder.fetchUrl,
      handle: builder.entity.handle ?? builder.handle,
      href: `/builder/${builder.entity.id}`,
      name: builder.entity.name || builder.name,
      sourceUrl: builder.sourceUrl,
      sourceType: builder.sourceType,
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

function serializeDigestArchiveOption(digest: DigestSummaryRow): DigestArchivePickerOption {
  return {
    createdAt: digest.createdAt.toISOString(),
    id: digest.id,
    itemCount: digest.itemCount,
  };
}

function displayDigestTitle(title: string) {
  return title.replace(/^AI Builder Digest\b/, "AI Digest");
}
