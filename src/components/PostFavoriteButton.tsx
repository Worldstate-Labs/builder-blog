"use client";

import { Star } from "lucide-react";

export function PostFavoriteButton({
  ariaLabel,
  disabled = false,
  isFavorite,
  onToggle,
}: {
  ariaLabel?: string;
  disabled?: boolean;
  isFavorite: boolean;
  onToggle: () => void;
}) {
  const label = isFavorite ? "Remove from Favorites" : "Save to Favorites";
  const accessibleLabel = ariaLabel ?? label;
  return (
    <button
      aria-label={accessibleLabel}
      aria-pressed={isFavorite}
      className={`post-action-btn post-favorite-btn${isFavorite ? " post-action-btn--active" : ""}`}
      disabled={disabled}
      onClick={onToggle}
      title={accessibleLabel}
      type="button"
    >
      <Star aria-hidden="true" className="post-action-icon" />
    </button>
  );
}
