import { RouteLoading } from "@/components/RouteLoading";

export default function PostLoading() {
  return (
    <RouteLoading
      label="Post"
      title="Loading Post"
      rows={4}
    />
  );
}
