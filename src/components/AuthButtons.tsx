"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

type Provider = "google" | "github";

const providers: Array<{ id: Provider; label: string }> = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
];

export function AuthButtons({
  callbackUrl = "/dashboard",
  labelPrefix = "Continue with",
}: {
  callbackUrl?: string;
  labelPrefix?: string;
}) {
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);

  async function handleSignIn(provider: Provider) {
    setPendingProvider(provider);
    await signIn(provider, { callbackUrl });
    setPendingProvider(null);
  }

  return (
    <div className="grid gap-3">
      {providers.map((provider) => (
        <button
          className="auth-button text-left disabled:cursor-wait disabled:opacity-65"
          disabled={pendingProvider !== null}
          key={provider.id}
          onClick={() => void handleSignIn(provider.id)}
          type="button"
        >
          {pendingProvider === provider.id
            ? `Opening ${provider.label}...`
            : `${labelPrefix} ${provider.label}`}
        </button>
      ))}
    </div>
  );
}
