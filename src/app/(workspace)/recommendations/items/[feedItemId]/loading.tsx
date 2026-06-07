import { RouteLoading } from "@/components/RouteLoading";

export default function LegacyRecommendationItemLoading() {
  return (
    <RouteLoading
      label="Post"
      title="Loading Post"
      rows={4}
    />
  );
}
