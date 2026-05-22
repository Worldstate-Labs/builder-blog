export default function Loading() {
  return (
    <div className="page-pad">
      <div className="space-y-7" aria-live="polite" aria-busy="true">
        <div className="h-4 w-28 rounded-full bg-black/10" />
        <div className="h-16 max-w-2xl rounded-lg bg-black/10" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="h-28 rounded-lg bg-black/10" />
          <div className="h-28 rounded-lg bg-black/10" />
          <div className="h-28 rounded-lg bg-black/10" />
        </div>
        <div className="grid gap-4">
          <div className="h-24 rounded-lg bg-black/10" />
          <div className="h-24 rounded-lg bg-black/10" />
          <div className="h-24 rounded-lg bg-black/10" />
        </div>
      </div>
    </div>
  );
}
