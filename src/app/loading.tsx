export default function Loading() {
  return (
    <div className="page-pad">
      <div aria-live="polite" aria-busy="true">
        <div className="fb-page-head">
          <div>
            <div className="h-7 w-44 rounded-lg bg-black/10" />
            <div className="mt-3 h-4 max-w-sm rounded-lg bg-black/10" />
          </div>
          <div className="stats-panel">
            <div className="h-16 rounded-lg bg-black/10" />
            <div className="h-16 rounded-lg bg-black/10" />
            <div className="h-16 rounded-lg bg-black/10" />
          </div>
        </div>
        <div className="workspace-content-stack">
          <div className="grid gap-4">
            <div className="h-24 rounded-lg bg-black/10" />
            <div className="h-24 rounded-lg bg-black/10" />
            <div className="h-24 rounded-lg bg-black/10" />
          </div>
        </div>
      </div>
    </div>
  );
}
