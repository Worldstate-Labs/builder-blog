import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

export const metadata: Metadata = { title: "Following" };

export default function RecommendationsPage() {
  permanentRedirect("/dashboard?tab=following");
}
