"use client";

import { Star } from "lucide-react";

export function PostFavoriteButton({
  disabled = false,
  isFavorite,
  onToggle,
}: {
  disabled?: boolean;
  isFavorite: boolean;
  onToggle: () => void;
}) {
  const label = isFavorite ? "Remove saved post" : "Save post";
  return (
    <button
      aria-label={label}
      aria-pressed={isFavorite}
      className={`post-action-btn post-favorite-btn${isFavorite ? " post-action-btn--active" : ""}`}
      disabled={disabled}
      onClick={onToggle}
      title={label}
      type="button"
    >
      <Star aria-hidden="true" className="post-action-icon" />
    </button>
  );
}
