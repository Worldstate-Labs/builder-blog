import { RouteLoading } from "@/components/RouteLoading";

export default function BuilderHandleLoading() {
  return (
    <RouteLoading
      label="Source"
      title="Loading Source"
      rows={5}
    />
  );
}
