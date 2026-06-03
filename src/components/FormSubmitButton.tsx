"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function FormSubmitButton({
  children,
  className,
  disabled = false,
  pendingLabel = "Working...",
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      aria-busy={pending}
      className={`${className ?? ""} submit-button`}
      disabled={pending || disabled}
      type="submit"
    >
      <span
        className={`submit-button-content${pending ? " is-pending" : ""}`}
      >
        {children}
      </span>
      {pending ? (
        <span className="submit-button-pending">
          {pendingLabel}
        </span>
      ) : null}
    </button>
  );
}
