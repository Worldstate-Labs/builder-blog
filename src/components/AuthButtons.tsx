"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

type Provider = "google" | "github";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="auth-provider-icon" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18a11 11 0 0 0 0 9.87z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="auth-provider-icon" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.16c-3.2.7-3.87-1.36-3.87-1.36-.52-1.34-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.25 3.34.95.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.27-5.23-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.18a10.95 10.95 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.68 5.37-5.24 5.65.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

const providers: Array<{ id: Provider; label: string; Icon: () => React.ReactElement; outline: boolean }> = [
  { id: "google", label: "Google", Icon: GoogleIcon, outline: false },
  { id: "github", label: "GitHub", Icon: GithubIcon, outline: true },
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
    <div className="auth-button-stack">
      {providers.map(({ id, label, Icon, outline }) => (
        <button
          className={`fb-auth-btn${outline ? " outline" : ""}`}
          disabled={pendingProvider !== null}
          key={id}
          onClick={() => void handleSignIn(id)}
          type="button"
        >
          <Icon />
          <span>
            {pendingProvider === id
              ? `Opening ${label}...`
              : `${labelPrefix} ${label}`}
          </span>
        </button>
      ))}
    </div>
  );
}
