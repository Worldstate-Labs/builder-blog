import type { AriaRole, ReactNode } from "react";

export function EmptyState({
  actions,
  ariaLive,
  body,
  children,
  className,
  role,
  title,
  tone,
}: {
  actions?: ReactNode;
  ariaLive?: "off" | "polite" | "assertive";
  body?: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: AriaRole;
  title?: ReactNode;
  tone?: "empty" | "error";
}) {
  const content = body ?? children;
  return (
    <div
      aria-live={ariaLive}
      className={["empty-state", className].filter(Boolean).join(" ")}
      data-tone={tone}
      role={role}
    >
      {title ? <h3 className="empty-state-title">{title}</h3> : null}
      {content ? <div className="empty-state-body">{content}</div> : null}
      {actions ? <div className="empty-state-actions">{actions}</div> : null}
    </div>
  );
}
