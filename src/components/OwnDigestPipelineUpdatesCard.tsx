"use client";

import { useId, useState, type ReactNode } from "react";
import {
  DigestLogPanel,
  DigestStatusToggle,
  type DigestLogPanelProps,
} from "@/components/DigestLogPanel";
import {
  OwnDigestPipelineCard,
  type OwnDigestPipeline,
} from "@/components/DigestPipelineImportForm";
import { statusStyle, type DigestUpdateStatus } from "@/lib/digest-update-status";

type OwnDigestPipelineUpdatesCardProps = Omit<
  DigestLogPanelProps,
  "actions" | "detailsOpen" | "onDetailsOpenChange" | "onStatusChange" | "showStatusToggle"
> & {
  actions?: ReactNode;
  pipeline: OwnDigestPipeline;
};

export function OwnDigestPipelineUpdatesCard({
  actions,
  pipeline,
  ...logPanelProps
}: OwnDigestPipelineUpdatesCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<DigestUpdateStatus>(
    fullDigestUpdateStatus(pipeline.digestUpdateStatus),
  );
  const detailsRootId = useId();

  return (
    <OwnDigestPipelineCard
      beforePreview={
        <section className="sources-sync-section">
          <DigestLogPanel
            {...logPanelProps}
            actions={actions}
            detailsOpen={detailsOpen}
            detailsRootId={detailsRootId}
            onDetailsOpenChange={setDetailsOpen}
            onStatusChange={setUpdateStatus}
            showHeading={false}
            showStatusToggle={false}
          />
        </section>
      }
      cronStatusControl={
        <DigestStatusToggle
          detailsOpen={detailsOpen}
          onToggle={() => setDetailsOpen((value) => !value)}
          status={updateStatus}
        />
      }
      pipeline={{
        ...pipeline,
        digestUpdateStatus: updateStatus,
      }}
    >
      <div id={detailsRootId} />
    </OwnDigestPipelineCard>
  );
}

function fullDigestUpdateStatus(
  status: OwnDigestPipeline["digestUpdateStatus"],
): DigestUpdateStatus {
  const tone =
    status.key === "healthy"
      ? "ok"
      : status.key === "needs-attention"
        ? "failed"
        : "partial";
  return {
    ...status,
    style: statusStyle(tone),
  };
}
