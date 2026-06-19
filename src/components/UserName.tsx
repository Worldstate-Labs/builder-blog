import type { ReactNode } from "react";

export function UserName({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={["fb-user-name", className].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}
