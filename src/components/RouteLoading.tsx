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
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]" aria-live="polite" aria-busy="true">
        <div>
          <p className="section-label">{label}</p>
          <div className="mt-3 h-14 max-w-3xl rounded-lg bg-black/10" />
          <p className="sr-only">{title}</p>
          <div className="mt-6 h-6 max-w-2xl rounded-lg bg-black/10" />
          <div className="mt-3 h-6 max-w-xl rounded-lg bg-black/10" />
        </div>
        <div className="stats-panel">
          {Array.from({ length: stats }, (_, index) => (
            <div key={index} className="h-16 rounded-lg bg-black/10" />
          ))}
        </div>
      </div>
      <div className="item-list mt-10">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="h-24 rounded-lg bg-black/10" />
        ))}
      </div>
    </div>
  );
}
