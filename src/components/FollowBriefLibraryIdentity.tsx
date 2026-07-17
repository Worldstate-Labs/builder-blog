import { BrandMark } from "@/components/BrandMark";
import { followBriefSourceLibraryName } from "@/lib/followbrief-library";

export function FollowBriefLibraryIdentity({
  compact = false,
  label = followBriefSourceLibraryName,
}: {
  compact?: boolean;
  label?: string;
}) {
  return (
    <span
      className={`followbrief-library-identity${compact ? " is-compact" : ""}`}
    >
      <BrandMark className="followbrief-library-mark" />
      <span>{label}</span>
    </span>
  );
}
