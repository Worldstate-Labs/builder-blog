"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function FormSubmitButton({
  children,
  className,
  pendingLabel = "Working...",
}: {
  children: ReactNode;
  className?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      aria-busy={pending}
      className={`${className ?? ""} relative justify-center`}
      disabled={pending}
      type="submit"
    >
      <span
        className={`inline-flex items-center justify-center gap-2 ${pending ? "invisible" : ""}`}
      >
        {children}
      </span>
      {pending ? (
        <span className="absolute inset-0 inline-flex items-center justify-center px-3">
          {pendingLabel}
        </span>
      ) : null}
    </button>
  );
}
