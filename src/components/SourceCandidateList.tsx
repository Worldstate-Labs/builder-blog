"use client";

import { SourceAvatar } from "@/components/SourceAvatar";
import { sourceLabelForType } from "@/lib/source-display";
import {
  type SourceCandidate,
  sourceCandidateValue,
} from "@/lib/source-candidates";

export function SourceCandidateList({
  candidates,
  id,
  onSelect,
}: {
  candidates: SourceCandidate[];
  id: string;
  onSelect: (candidate: SourceCandidate) => void;
}) {
  if (candidates.length === 0) return null;

  return (
    <div className="source-candidate-list" id={id} role="listbox">
      {candidates.map((candidate) => (
        <button
          aria-selected={false}
          className="source-candidate-option"
          key={candidate.id}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(candidate)}
          role="option"
          type="button"
        >
          <SourceAvatar
            className="source-candidate-avatar"
            imageSize={32}
            source={candidate}
          />
          <span className="source-candidate-copy">
            <span className="source-candidate-name">{candidate.name}</span>
            <span className="source-candidate-meta">
              {sourceLabelForType(candidate.sourceType)}
              {sourceCandidateValue(candidate)
                ? ` - ${sourceCandidateValue(candidate)}`
                : ""}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
