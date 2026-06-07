import { RouteLoading } from "@/components/RouteLoading";

export default function PostLoading() {
  return (
    <RouteLoading
      label="Summarized post"
      title="Loading summarized post"
      rows={4}
    />
  );
}
