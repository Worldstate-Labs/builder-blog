import { RouteLoading } from "@/components/RouteLoading";

export default function BuilderHandleLoading() {
  return (
    <RouteLoading
      label="Source"
      title="Loading source"
      rows={5}
    />
  );
}
