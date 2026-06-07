import { RouteLoading } from "@/components/RouteLoading";

export default function RecommendationsLoading() {
  return (
    <RouteLoading
      label="Following"
      title="Loading Following"
      rows={6}
    />
  );
}
