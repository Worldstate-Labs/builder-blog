import { permanentRedirect } from "next/navigation";

export default function RecommendationsPage() {
  permanentRedirect("/dashboard?tab=following");
}
