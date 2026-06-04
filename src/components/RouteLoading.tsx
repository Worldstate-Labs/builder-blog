import { PageHeader } from "@/components/PageHeader";

export function RouteLoading({
  label,
  title,
  rows = 4,
  variant = "reading",
}: {
  label: string;
  title: string;
  rows?: number;
  variant?: "reading" | "workspace";
}) {
  const pageClassName =
    variant === "reading" ? "page-pad page-pad--reading" : "page-pad";

  return (
    <div className={pageClassName}>
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
