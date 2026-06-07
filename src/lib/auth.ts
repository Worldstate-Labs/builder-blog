import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { cache } from "react";
import { getServerSession } from "next-auth";
import type { NextAuthOptions } from "next-auth";
import AppleProvider from "next-auth/providers/apple";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";

function authLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      cause: authLogValue((value as Error & { cause?: unknown }).cause),
    };
  }

  if (!value || typeof value !== "object") return value;

  if (Array.isArray(value)) return value.map(authLogValue);

  const record = value as Record<string, unknown>;
  return {
    providerId: record.providerId,
    error: authLogValue(record.error),
    error_description: record.error_description,
  };
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  cookies: {
    pkceCodeVerifier: {
      name: "__Secure-next-auth.pkce.code_verifier",
      options: {
        httpOnly: true,
        sameSite: "none",
        path: "/",
        secure: true,
        maxAge: 60 * 15,
      },
    },
  },
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID ?? "",
      clientSecret: process.env.GITHUB_SECRET ?? "",
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      // Google enforces verified email on every OAuth identity, so the
      // takeover risk that this flag introduces for other providers
      // does not apply here: only the actual owner of the gmail can
      // present a Google sub bound to it. We re-enable linking on this
      // provider specifically so a user whose Account row is missing
      // (deleted, or never created in early-flag-on periods) can sign
      // in again instead of being silently bounced with
      // OAuthAccountNotLinked. GitHub keeps it off — its email field
      // is user-claimed and would be unsafe.
      allowDangerousEmailAccountLinking: true,
    }),
    AppleProvider({
      clientId: process.env.APPLE_ID ?? "",
      clientSecret: process.env.APPLE_SECRET ?? "",
      // Apple ID tokens only contain Apple-verified emails. If the user
      // chooses Hide My Email, Apple returns a relay address that is still
      // verified and unique to the Apple account.
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  logger: {
    error(code, metadata) {
      console.error(
        "[next-auth:error]",
        JSON.stringify({ code, metadata: authLogValue(metadata) }),
      );
    },
  },
};

export const getCurrentSession = cache(() => getServerSession(authOptions));
