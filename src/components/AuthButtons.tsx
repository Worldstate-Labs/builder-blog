"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { GitBranch, Mail } from "lucide-react";

type Provider = "google" | "github";

const providers: Array<{ id: Provider; label: string; icon: typeof Mail }> = [
  { id: "google", label: "Google", icon: Mail },
  { id: "github", label: "GitHub", icon: GitBranch },
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
      {providers.map((provider) => {
        const Icon = provider.icon;
        return (
          <button
            className="auth-button text-left disabled:cursor-wait disabled:opacity-65"
            disabled={pendingProvider !== null}
            key={provider.id}
            onClick={() => void handleSignIn(provider.id)}
            type="button"
          >
            <Icon className="h-4 w-4 shrink-0 text-[var(--accent)]" />
            <span>
              {pendingProvider === provider.id
                ? `Opening ${provider.label}...`
                : `${labelPrefix} ${provider.label}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
