import { RouteLoading } from "@/components/RouteLoading";

export default function BuilderDetailLoading() {
  return (
    <RouteLoading
      label="Source"
      title="Loading Source"
      rows={5}
    />
  );
}
