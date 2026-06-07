import { RouteLoading } from "@/components/RouteLoading";

export default function SearchLoading() {
  return (
    <RouteLoading
      label="Search"
      title="Loading Search"
      rows={5}
    />
  );
}
