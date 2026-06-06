import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminDigestConfigForm } from "@/components/AdminDigestConfigForm";
import { AdminSourceTypeManager } from "@/components/AdminSourceTypeManager";
import { AgentTokenPanel } from "@/components/AgentTokenPanel";
import { CountMeta } from "@/components/Count";
import { PageHeader } from "@/components/PageHeader";
import {
  CommonFetchRulesForm,
  CommonSummaryRulesForm,
} from "@/components/CommonSummaryRulesForm";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getAllSourceConfigs,
  getUserDigestConfig,
  getUserSourceConfigs,
} from "@/lib/source-config-store";

const DIGEST_PROMPT_COUNT: number = 3;

export default async function SettingsPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const isAdmin = isAdminEmail(session.user.email);

  return (
    <div className="page-pad page-pad--settings">
      <PageHeader title="Settings" />

      <div className="workspace-content-stack settings-workspace">
        <div className="settings-access-grid">
          <Suspense fallback={<AgentTokenPanelSkeleton />}>
            <AgentTokenSlot userId={userId} />
          </Suspense>
        </div>

        <Suspense fallback={<SourceTypeConfigSkeleton />}>
          <SourceTypeConfigSection userId={userId} isAdmin={isAdmin} />
        </Suspense>
      </div>
    </div>
  );
}

async function SourceTypeConfigSection({
  userId,
  isAdmin,
}: {
  userId: string;
  isAdmin: boolean;
}) {
  const [userSourceConfigs, defaultSourceConfigs, digestConfig] = await Promise.all([
    getUserSourceConfigs(userId),
    getAllSourceConfigs(),
    getUserDigestConfig(userId),
  ]);
  const defaultSourceConfigById = new Map(defaultSourceConfigs.map((c) => [c.sourceId, c]));
  const sourceConfigs = userSourceConfigs.map((config) => ({
    ...config,
    contentQuality: defaultSourceConfigById.get(config.sourceId)?.contentQuality ?? config.contentQuality,
  }));
  return (
    <section className="settings-rules">
      <details className="settings-rules-panel fb-panel">
        <summary className="settings-rules-summary">
          <div className="settings-rules-summary-copy">
            <h3 className="fb-section-heading">Source update rules</h3>
            <p className="settings-rules-summary-desc">
              Fetch, filter, and write per-post summaries.
            </p>
          </div>
          <span className="settings-rules-summary-meta source-summary-line">
            <CountMeta
              label={sourceConfigs.length === 1 ? "source type" : "source types"}
              value={sourceConfigs.length}
            />
          </span>
        </summary>
        <div className="settings-rules-body">
          {isAdmin ? (
            <div className="settings-config-form settings-config-form--common">
              <CommonFetchRulesForm
                initialValue={digestConfig.commonFetchRules}
                updatedAt={digestConfig.updatedAt.toISOString()}
              />
              <CommonSummaryRulesForm
                initialValue={digestConfig.commonSummaryRules}
                updatedAt={digestConfig.updatedAt.toISOString()}
              />
            </div>
          ) : null}
          <AdminSourceTypeManager
            canEditQualityGates={isAdmin}
            initialConfigs={sourceConfigs.map((c) => ({
              sourceId: c.sourceId,
              label: c.label,
              agentDefaultStatus: c.agentDefaultStatus,
              contentQuality: c.contentQuality,
              summaryPromptBody: c.summaryPromptBody,
              fetchPromptBody: c.fetchPromptBody,
              summaryStyle: c.summaryStyle,
              updatedAt: c.updatedAt.toISOString(),
              updatedBy: c.updatedBy,
            }))}
          />
        </div>
      </details>

      <details className="settings-rules-panel fb-panel">
        <summary className="settings-rules-summary">
          <div className="settings-rules-summary-copy">
            <h3 className="fb-section-heading">Digest rules</h3>
            <p className="settings-rules-summary-desc">
              Write digest headlines, source notes, and translated post summaries.
            </p>
          </div>
          <span className="settings-rules-summary-meta source-summary-line">
            <CountMeta
              label={DIGEST_PROMPT_COUNT === 1 ? "prompt" : "prompts"}
              value={DIGEST_PROMPT_COUNT}
            />
          </span>
        </summary>
        <div className="settings-rules-body">
          <AdminDigestConfigForm
            initialConfig={{
              id: digestConfig.userId,
              headlinePrompt: digestConfig.headlinePrompt,
              perSourceSummaryPrompt: digestConfig.perSourceSummaryPrompt,
              translate: digestConfig.translate,
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
    <section className="settings-rules settings-rules-skeleton" aria-busy="true" aria-live="polite">
      <div className="settings-rules-skeleton-list">
        <div className="settings-skeleton-card" />
        <div className="settings-skeleton-card" />
      </div>
    </section>
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
    <section className="access-keys-panel fb-panel" aria-busy="true" aria-live="polite">
      <div className="access-keys-head">
        <div className="access-keys-skeleton-copy">
          <div className="settings-skeleton-line settings-skeleton-line--access-title" />
          <div className="settings-skeleton-line settings-skeleton-line--access-desc" />
        </div>
        <div className="settings-skeleton-pill" />
      </div>
      <div className="access-keys-list access-keys-list--skeleton">
        <div className="settings-skeleton-row" />
        <div className="settings-skeleton-row" />
        <div className="settings-skeleton-row" />
      </div>
    </section>
  );
}
