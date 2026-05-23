"use client";

import { useState, useTransition } from "react";

export function DeviceApproveButton({ code }: { code: string }) {
  const [status, setStatus] = useState<"idle" | "approved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function approve() {
    setStatus("idle");
    setMessage("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/device/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
        setStatus("approved");
        setMessage("Approved. Return to your terminal.");
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Approval failed");
      }
    });
  }

  return (
    <div className="mt-8">
      <button className="auth-button" disabled={isPending} onClick={approve} type="button">
        {isPending ? "Approving..." : "Approve terminal access"}
      </button>
      <span aria-live="polite">
        {message ? (
          <p
            className={
              status === "approved"
                ? "mt-8 rounded-lg bg-emerald-400/15 p-5 text-emerald-100"
                : "mt-8 rounded-lg bg-red-400/15 p-5 text-red-100"
            }
          >
            {message}
          </p>
        ) : null}
      </span>
    </div>
  );
}
