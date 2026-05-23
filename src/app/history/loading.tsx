import { RouteLoading } from "@/components/RouteLoading";

export default function HistoryLoading() {
  return <RouteLoading label="Archive" title="Loading digest history" stats={1} rows={6} />;
}
