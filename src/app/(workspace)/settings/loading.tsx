import { AgentTokenPanelSkeleton } from "@/components/AgentTokenPanelSkeleton";
import { I18nText } from "@/components/I18nProvider";
import { PageHeader } from "@/components/PageHeader";
import { SettingsRulesSkeleton } from "@/components/SettingsRulesSkeleton";

export default function SettingsLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="page-pad page-pad--settings settings-loading"
    >
      <PageHeader
        title={<I18nText id="workspace.settings" />}
        description={<I18nText id="workspace.settingsDesc" />}
      />

      <div className="workspace-content-stack settings-workspace">
        <div className="settings-access-grid">
          <AgentTokenPanelSkeleton />
        </div>

        <SettingsRulesSkeleton />
      </div>
    </div>
  );
}
