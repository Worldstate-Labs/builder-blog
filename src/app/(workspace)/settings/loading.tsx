import { AgentTokenPanelSkeleton } from "@/components/AgentTokenPanelSkeleton";
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
        title="Settings"
        description="Access keys and rules for Fetch sources and AI Digest."
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
