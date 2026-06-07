import { RouteLoading } from "@/components/RouteLoading";

export default function SettingsLoading() {
  return (
    <RouteLoading
      label="Settings"
      title="Loading Settings"
      rows={5}
      variant="workspace"
    />
  );
}
