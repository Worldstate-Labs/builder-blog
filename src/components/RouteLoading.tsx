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
      <div className="page-header" aria-live="polite" aria-busy="true">
        <div>
          <p className="sr-only">{label}</p>
          <div className="h-7 w-44 rounded-lg bg-black/10" />
          <p className="sr-only">{title}</p>
          <div className="mt-3 h-4 max-w-sm rounded-lg bg-black/10" />
        </div>
        <div className="page-toolbar">
          {Array.from({ length: stats }, (_, index) => (
            <div key={index} className="h-8 w-24 rounded-full bg-black/10" />
          ))}
        </div>
      </div>
      <div className="item-list mt-6">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="h-24 rounded-lg bg-black/10" />
        ))}
      </div>
    </div>
  );
}
