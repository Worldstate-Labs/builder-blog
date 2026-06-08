"use client";

import { useState, useTransition } from "react";
import { PostFavoriteButton } from "@/components/PostFavoriteButton";

export function PostFavoriteControl({
  feedItemId,
  initialIsFavorite,
}: {
  feedItemId: string;
  initialIsFavorite: boolean;
}) {
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite);
  const [isPending, startTransition] = useTransition();

  function toggleFavorite() {
    const nextFavorite = !isFavorite;
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
      }
    });
  }

  return (
    <PostFavoriteButton
      disabled={isPending}
      isFavorite={isFavorite}
      onToggle={toggleFavorite}
    />
  );
}
