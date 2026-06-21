"use client";

import { useCallback, useId, useState, type ReactNode } from "react";
import {
  buildDigestTimeline,
  DigestLogPanel,
  DigestStatusToggle,
  getDigestActivityStatus,
  type DigestLogPanelProps,
} from "@/components/DigestLogPanel";
import {
  OwnDigestPipelineCard,
  type OwnDigestPipeline,
} from "@/components/DigestPipelineImportForm";
import {
  buildDigestCronStatus,
  digestCronFrequencyLabel,
  type DigestUpdateStatus,
} from "@/lib/digest-update-status";

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
  const [activityStatus, setActivityStatus] = useState<DigestUpdateStatus>(
    () => initialDigestActivityStatus(logPanelProps),
  );
  const [frequencyLabel, setFrequencyLabel] = useState(
    () => digestCronFrequencyLabel(logPanelProps.initialCronJob),
  );
  const detailsRootId = useId();

  const handleCronJobChange = useCallback((cronJob: DigestLogPanelProps["initialCronJob"]) => {
    setFrequencyLabel(digestCronFrequencyLabel(cronJob));
  }, []);

  return (
    <OwnDigestPipelineCard
      beforePreview={
        <section className="sources-sync-section">
          <DigestLogPanel
            {...logPanelProps}
            actions={actions}
            actionsPlacement="start"
            detailsOpen={detailsOpen}
            detailsRootId={detailsRootId}
            onCronJobChange={handleCronJobChange}
            onDetailsOpenChange={setDetailsOpen}
            onStatusChange={setActivityStatus}
            showHeading={false}
            showStatusToggle={false}
          />
        </section>
      }
      cronStatusControl={
        <DigestStatusToggle
          detailsOpen={detailsOpen}
          onToggle={() => setDetailsOpen((value) => !value)}
          status={activityStatus}
        />
      }
      pipeline={{
        ...pipeline,
        digestUpdateStatus: activityStatus,
        frequencyLabel,
      }}
    >
      <div className="fb-hub-digest-details-slot" id={detailsRootId} />
    </OwnDigestPipelineCard>
  );
}

function initialDigestActivityStatus({
  initialCronJob,
  initialCronRuns,
  initialJobRuns = [],
  initialRuns,
  initialScheduledJobRuns = [],
}: Pick<
  DigestLogPanelProps,
  "initialCronJob" | "initialCronRuns" | "initialJobRuns" | "initialRuns" | "initialScheduledJobRuns"
>): DigestUpdateStatus {
  const cronStatus = buildDigestCronStatus(
    initialCronJob,
    initialCronRuns,
    initialScheduledJobRuns,
  );
  return getDigestActivityStatus(
    buildDigestTimeline({
      jobRuns: initialJobRuns,
      runs: initialRuns,
      slots: cronStatus.slots,
    }),
  );
}
