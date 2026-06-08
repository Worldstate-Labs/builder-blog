import { RouteLoading } from "@/components/RouteLoading";

export default function BuilderDetailLoading() {
  return (
    <RouteLoading
      label="Source"
      title="Loading source"
      rows={5}
    />
  );
}
