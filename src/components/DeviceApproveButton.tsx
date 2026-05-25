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
    <div className="mt-6 flex flex-col gap-3">
      <button
        className="fb-auth-btn justify-center disabled:cursor-wait disabled:opacity-65"
        disabled={isPending}
        onClick={approve}
        type="button"
      >
        {isPending ? "Approving..." : "Approve device"}
      </button>
      <span aria-live="polite">
        {message ? (
          <p
            className={
              status === "approved"
                ? "rounded-lg border border-emerald-300/30 bg-emerald-400/15 p-4 text-sm text-emerald-100"
                : "rounded-lg border border-red-300/30 bg-red-400/15 p-4 text-sm text-red-100"
            }
          >
            {message}
          </p>
        ) : null}
      </span>
    </div>
  );
}
