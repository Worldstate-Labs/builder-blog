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
  const label = postFavoriteActionLabel(isFavorite);
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

export function postFavoriteActionLabel(isFavorite: boolean, targetLabel?: string | null) {
  const target = targetLabel?.trim();
  if (!target) return isFavorite ? "Remove from Favorites" : "Save to Favorites";
  return isFavorite ? `Remove ${target} from Favorites` : `Save ${target} to Favorites`;
}
