import { PageHeader } from "@/components/PageHeader";

export function RouteLoading({
  label,
  title,
  rows = 4,
}: {
  label: string;
  title: string;
  rows?: number;
}) {
  return (
    <div className="page-pad">
      <PageHeader
        aria-busy="true"
        aria-live="polite"
        title={title}
      >
        <div>
          <p className="sr-only">{label}</p>
          <div className="route-loading-title" />
          <p className="sr-only">{title}</p>
          <div className="route-loading-desc" />
        </div>
      </PageHeader>
      <div className="workspace-content-stack">
        <div className="route-loading-list">
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="route-loading-row" />
          ))}
        </div>
      </div>
    </div>
  );
}
