import { SourceBadge, type SourceBadgeBuilder } from "@/components/SourceBadge";

type OriginalSourceActionProps = {
  ariaLabel: string;
  builder?: SourceBadgeBuilder | null;
  href: string;
  label?: string;
  onClick?: () => void;
  sourceType?: string | null;
  title?: string;
};

export function OriginalSourceAction({
  ariaLabel,
  builder,
  href,
  label = "Original",
  onClick,
  sourceType,
  title = label,
}: OriginalSourceActionProps) {
  return (
    <a
      aria-label={ariaLabel}
      className="post-inline-action post-inline-action--label post-source-original"
      href={href}
      onClick={onClick}
      rel="noreferrer"
      target="_blank"
      title={title}
    >
      <SourceBadge
        builder={builder}
        decorative
        sourceType={builder?.sourceType ?? sourceType ?? null}
        showLabel={false}
      />
      <span>{label}</span>
    </a>
  );
}
