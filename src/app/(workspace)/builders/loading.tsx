import { RouteLoading } from "@/components/RouteLoading";

export default function BuildersLoading() {
  return (
    <RouteLoading
      label="Sources"
      title="Loading Sources"
      rows={6}
      variant="workspace"
    />
  );
}
