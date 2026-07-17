"use client";

import type { ReactNode } from "react";
import { CountMeta } from "@/components/Count";
import { DigestHeadlineSummary } from "@/components/DigestHeadlineSummary";
import { RelativeTime } from "@/components/RelativeTime";
import type { DigestPipelineRuntimeMetadata } from "@/lib/digest-pipeline-metadata";
import { displayLanguagePreference } from "@/lib/language-preference";

export type OwnDigestPipeline = DigestPipelineRuntimeMetadata & {
  title: "Your AI Brief";
};

export type FollowBriefDigestPipeline = DigestPipelineRuntimeMetadata & {
  title: "FollowBrief AI Brief";
};

const HEADLINE_PREVIEW_LINES = 6;

export function OwnDigestPipelineCard({
  beforePreview,
  children,
  cronStatusControl,
  pipeline,
}: {
  beforePreview?: ReactNode;
  children?: ReactNode;
  cronStatusControl?: ReactNode;
  pipeline: OwnDigestPipeline;
}) {
  return (
    <DigestPipelineInfoCard
      beforePreview={beforePreview}
      className="own-digest-card"
      cronStatusControl={cronStatusControl}
      detailsSlot={children}
      pipeline={pipeline}
      title={pipeline.title}
    />
  );
}

export function FollowBriefDigestPipelineCard({
  pipeline,
}: {
  pipeline: FollowBriefDigestPipeline;
}) {
  return (
    <DigestPipelineInfoCard
      className="fb-hub-card digest-pipeline-card followbrief-digest-card"
      pipeline={pipeline}
      title={pipeline.title}
    />
  );
}

function DigestPipelineInfoCard({
  beforePreview,
  className,
  cronStatusControl,
  detailsSlot,
  pipeline,
  title,
}: {
  beforePreview?: ReactNode;
  className: string;
  cronStatusControl?: ReactNode;
  detailsSlot?: ReactNode;
  pipeline: DigestPipelineRuntimeMetadata;
  title: string;
}) {
  return (
    <article className={className}>
      <div className="fb-hub-card-head">
        <div className="fb-hub-card-titleblock">
          <h2 className="fb-hub-title">{title}</h2>
        </div>
      </div>

      {beforePreview}

      <DigestPipelinePreviewCard
        cronStatusControl={cronStatusControl}
        detailsSlot={detailsSlot}
        pipeline={pipeline}
      />

      <div className="fb-hub-card-stats">
        <CountMeta
          label={pipeline.digestCount === 1 ? "issue" : "issues"}
          value={pipeline.digestCount}
        />
      </div>
    </article>
  );
}

export function DigestPipelinePreviewCard({
  cronStatusControl,
  detailsSlot,
  pipeline,
}: {
  cronStatusControl?: ReactNode;
  detailsSlot?: ReactNode;
  pipeline: DigestPipelineRuntimeMetadata;
}) {
  const headline = pipeline.latestDigestHeadline?.trim();

  return (
    <div className="fb-hub-digest-preview">
      <DigestPipelineMetaGrid cronStatusControl={cronStatusControl} pipeline={pipeline} />
      {detailsSlot}
      <div className="fb-hub-digest-preview-row">
        <div>
          {headline ? (
            <DigestHeadlineSummary
              collapsedLineCount={HEADLINE_PREVIEW_LINES}
              sourceLinks={pipeline.latestDigestSourceLinks}
              text={headline}
            />
          ) : (
            <div className="fb-hub-digest-preview-title">No AI Briefs yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

function DigestPipelineMetaGrid({
  cronStatusControl,
  pipeline,
}: {
  cronStatusControl?: ReactNode;
  pipeline: DigestPipelineRuntimeMetadata;
}) {
  const status = pipeline.digestUpdateStatus;
  const scheduleLanguage =
    pipeline.scheduleStatus === "active"
      ? displayLanguagePreference(
          pipeline.summaryLanguage ?? pipeline.latestDigestLanguage ?? "zh",
        )
      : "N/A";

  return (
    <dl className="fb-hub-digest-meta" aria-label="AI Brief details">
      <DigestPipelineMetaItem
        label="Build frequency"
        value={pipeline.frequencyLabel ?? "Not scheduled"}
      />
      <DigestPipelineMetaItem label="Language" value={scheduleLanguage} />
      <div className="fb-hub-digest-meta-item">
        <dt>Latest issue</dt>
        <dd>
          {pipeline.latestDigestAt ? (
            <RelativeTime value={pipeline.latestDigestAt} />
          ) : (
            "None yet"
          )}
        </dd>
      </div>
      <div className="fb-hub-digest-meta-item">
        <dt>Status / log</dt>
        <dd>
          {cronStatusControl ?? (
            <span className={`fb-hub-digest-status is-${status.key}`}>
              {status.label}
            </span>
          )}
        </dd>
      </div>
    </dl>
  );
}

function DigestPipelineMetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="fb-hub-digest-meta-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
