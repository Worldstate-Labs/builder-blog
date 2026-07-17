import { CircleStop, Clock3, Languages } from "lucide-react";
import type { SourceLibraryMetadata as SourceLibraryMetadataValue } from "@/lib/source-library-metadata";

export function SourceLibraryMetadata({
  metadata,
}: {
  metadata: SourceLibraryMetadataValue;
}) {
  const CadenceIcon = metadata.cadenceState === "active" ? Clock3 : CircleStop;
  const cadenceAriaLabel =
    metadata.cadenceState === "active"
      ? `Build frequency: ${metadata.cadenceLabel}`
      : `Build status: ${metadata.cadenceLabel}`;

  return (
    <div className="source-library-metadata">
      <span
        aria-label={cadenceAriaLabel}
        className="source-library-metadata-item"
        role="group"
      >
        <CadenceIcon aria-hidden="true" size={16} />
        <span>{metadata.cadenceLabel}</span>
      </span>
      <span
        aria-label={`Language: ${metadata.languageLabel}`}
        className="source-library-metadata-item"
        role="group"
      >
        <Languages aria-hidden="true" size={16} />
        <span>{metadata.languageLabel}</span>
      </span>
    </div>
  );
}
