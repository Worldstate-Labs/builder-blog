export function RouteLoading({
  label,
  title,
  stats = 3,
  rows = 4,
}: {
  label: string;
  title: string;
  stats?: number;
  rows?: number;
}) {
  return (
    <div className="page-pad">
      <div className="fb-page-head" aria-live="polite" aria-busy="true">
        <div>
          <p className="sr-only">{label}</p>
          <div className="route-loading-title" />
          <p className="sr-only">{title}</p>
          <div className="route-loading-desc" />
        </div>
        <div className="page-toolbar">
          {Array.from({ length: stats }, (_, index) => (
            <div key={index} className="route-loading-chip" />
          ))}
        </div>
      </div>
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
