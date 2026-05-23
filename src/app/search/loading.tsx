import { RouteLoading } from "@/components/RouteLoading";

export default function SearchLoading() {
  return <RouteLoading label="Search" title="Searching your library" stats={2} rows={4} />;
}
