import { RouteLoading } from "@/components/RouteLoading";

export default function LibraryHubLoading() {
  return (
    <RouteLoading
      label="Hub"
      title="Loading Hub"
      rows={5}
      variant="workspace"
    />
  );
}
