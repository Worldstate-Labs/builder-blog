import type { ReactNode } from "react";

export function EmptyState({
  body,
  className,
  title,
}: {
  body: ReactNode;
  className?: string;
  title?: ReactNode;
}) {
  return (
    <div className={["empty-state", className].filter(Boolean).join(" ")}>
      {title ? <h3 className="empty-state-title">{title}</h3> : null}
      <p className="empty-state-body">{body}</p>
    </div>
  );
}
