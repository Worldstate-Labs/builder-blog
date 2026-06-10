"use client";

import { useState, useTransition } from "react";
import { PostFavoriteButton, postFavoriteActionLabel } from "@/components/PostFavoriteButton";

export function PostFavoriteControl({
  feedItemId,
  initialIsFavorite,
  targetLabel,
}: {
  feedItemId: string;
  initialIsFavorite: boolean;
  targetLabel?: string | null;
}) {
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function toggleFavorite() {
    const nextFavorite = !isFavorite;
    setError("");
    setIsFavorite(nextFavorite);
    startTransition(async () => {
      try {
        const response = await fetch("/api/favorites", {
          method: nextFavorite ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedItemId }),
        });
        if (!response.ok) throw new Error("Favorite update failed");
      } catch {
        setIsFavorite(!nextFavorite);
        setError("Could not update reading queue. Try again.");
      }
    });
  }

  return (
    <span className="post-favorite-control">
      <PostFavoriteButton
        ariaLabel={postFavoriteActionLabel(isFavorite, targetLabel)}
        disabled={isPending}
        isFavorite={isFavorite}
        onToggle={toggleFavorite}
      />
      {error ? (
        <span className="post-favorite-status" role="status">
          {error}
        </span>
      ) : null}
    </span>
  );
}
