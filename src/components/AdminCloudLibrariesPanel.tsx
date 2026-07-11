"use client";

import { ChevronDown } from "lucide-react";
import { AdminCloudLibraryExplorer } from "@/components/AdminCloudLibraryExplorer";
import { useCloudLibraryLiveSnapshot } from "@/components/AdminCloudLibraryLiveProvider";
import { CountMeta } from "@/components/Count";

export function AdminCloudLibrariesPanel() {
  const { libraries } = useCloudLibraryLiveSnapshot();

  return (
    <details className="settings-rules-panel fb-panel">
      <summary className="settings-rules-summary">
        <div className="settings-rules-summary-copy">
          <h3 className="fb-section-heading">Cloud libraries</h3>
          <p className="settings-rules-summary-desc">
            Each language library and its sources — fetch status, how many users submitted
            each source, and how many posts it has. Expand a source for its submitters and
            recent posts.
          </p>
        </div>
        <span className="settings-rules-summary-meta source-summary-line">
          <CountMeta
            label={libraries.length === 1 ? "language library" : "language libraries"}
            value={libraries.length}
          />
        </span>
        <span className="settings-rules-toggle-icon" aria-hidden="true">
          <ChevronDown className="settings-rules-toggle-svg" />
        </span>
      </summary>
      <div className="settings-rules-body">
        <AdminCloudLibraryExplorer libraries={libraries} />
      </div>
    </details>
  );
}
