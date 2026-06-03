import type { ReactNode } from "react";

export function EmptyState({
  actions,
  body,
  children,
  className,
  title,
}: {
  actions?: ReactNode;
  body?: ReactNode;
  children?: ReactNode;
  className?: string;
  title?: ReactNode;
}) {
  const content = body ?? children;
  return (
    <div className={["empty-state", className].filter(Boolean).join(" ")}>
      {title ? <h3 className="empty-state-title">{title}</h3> : null}
      {content ? <div className="empty-state-body">{content}</div> : null}
      {actions ? <div className="empty-state-actions">{actions}</div> : null}
    </div>
  );
}
