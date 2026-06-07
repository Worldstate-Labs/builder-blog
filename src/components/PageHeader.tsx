import type { HTMLAttributes, ReactNode } from "react";

export function PageHeader({
  actions,
  children,
  className,
  description,
  title,
  ...headerProps
}: Omit<HTMLAttributes<HTMLElement>, "title"> & {
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  description?: ReactNode;
  title: ReactNode;
}) {
  return (
    <header {...headerProps} className={["fb-page-head", className].filter(Boolean).join(" ")}>
      <div>
        {children ?? (
          <>
            <h1 className="fb-title">{title}</h1>
            {description ? <p className="fb-desc">{description}</p> : null}
          </>
        )}
      </div>
      {actions ? <div className="fb-page-head-actions">{actions}</div> : null}
    </header>
  );
}
