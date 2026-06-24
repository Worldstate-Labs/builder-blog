import { redirect } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Suspense } from "react";
import { AdminDigestConfigForm } from "@/components/AdminDigestConfigForm";
import { AdminMaintenancePanel } from "@/components/AdminMaintenancePanel";
import { AdminSourceTypeManager } from "@/components/AdminSourceTypeManager";
import { AccountDataPanel } from "@/components/AccountDataPanel";
import { AgentTokenPanel } from "@/components/AgentTokenPanel";
import { AgentTokenPanelSkeleton } from "@/components/AgentTokenPanelSkeleton";
import { CountMeta } from "@/components/Count";
import { I18nText } from "@/components/I18nProvider";
import { PageHeader } from "@/components/PageHeader";
import { SettingsRulesSkeleton } from "@/components/SettingsRulesSkeleton";
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

const ADMIN_DIGEST_PROMPT_COUNT: number = 3;
const USER_DIGEST_PROMPT_COUNT: number = 1;

export default async function SettingsPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const isAdmin = isAdminEmail(session.user.email);

  return (
    <div className="page-pad page-pad--settings">
      <PageHeader
        title={<I18nText id="workspace.settings" />}
        description={<I18nText id="workspace.settingsDesc" />}
      />

      <div className="workspace-content-stack settings-workspace">
        <div className="settings-access-grid">
          <Suspense fallback={<AgentTokenPanelSkeleton />}>
            <AgentTokenSlot userId={userId} />
          </Suspense>
          <AccountDataPanel />
          {isAdmin ? <AdminMaintenancePanel /> : null}
        </div>

        <Suspense fallback={<SettingsRulesSkeleton />}>
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
  const digestPromptCount = isAdmin ? ADMIN_DIGEST_PROMPT_COUNT : USER_DIGEST_PROMPT_COUNT;
  return (
    <section className="settings-rules">
      <details className="settings-rules-panel fb-panel" open>
        <summary className="settings-rules-summary">
          <div className="settings-rules-summary-copy">
            <h3 className="fb-section-heading">Source fetching rules</h3>
            <p className="settings-rules-summary-desc">
              Fetch and summarize source posts. Blog / Article Feed covers article pages and feeds; Podcast / Audio Feed covers podcast pages and audio feeds.
            </p>
          </div>
          <span className="settings-rules-summary-meta source-summary-line">
            <CountMeta
              label={sourceConfigs.length === 1 ? "source type" : "source types"}
              value={sourceConfigs.length}
            />
          </span>
          <span className="settings-rules-toggle-icon" aria-hidden="true">
            <ChevronDown className="settings-rules-toggle-svg" />
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
            <h3 className="fb-section-heading">AI Digest rules</h3>
            <p className="settings-rules-summary-desc">
              Build AI Digest issues.
            </p>
          </div>
          <span className="settings-rules-summary-meta source-summary-line">
            <CountMeta
              label={digestPromptCount === 1 ? "prompt" : "prompts"}
              value={digestPromptCount}
            />
          </span>
          <span className="settings-rules-toggle-icon" aria-hidden="true">
            <ChevronDown className="settings-rules-toggle-svg" />
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
            canEditDigestAssemblyPrompts={isAdmin}
          />
        </div>
      </details>
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
