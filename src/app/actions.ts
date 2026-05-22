"use server";

import { BuilderKind } from "@prisma/client";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { inferBuilderKind, normalizeHandle } from "@/lib/builder-keys";
import { upsertBuilder } from "@/lib/builders";
import { prisma } from "@/lib/prisma";
import { createAgentToken } from "@/lib/tokens";

async function requireUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session.user;
}

export async function addBuilderAction(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const handleInput = String(formData.get("handle") ?? "").trim();
  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim();
  const kindInput = String(formData.get("kind") ?? "").trim();

  if (!name || (!handleInput && !sourceUrl)) {
    redirect("/builders?error=missing-builder");
  }

  const handle = handleInput ? normalizeHandle(handleInput) : null;
  const kind = isBuilderKind(kindInput)
    ? kindInput
    : inferBuilderKind(sourceUrl || null, handle);
  const builder = await upsertBuilder({
    kind,
    name,
    handle,
    sourceUrl: sourceUrl || (handle ? `https://x.com/${handle}` : null),
    crawlUrl: kind === BuilderKind.BLOG || kind === BuilderKind.PODCAST ? sourceUrl : null,
    addedByUserId: user.id,
  });

  await prisma.subscription.upsert({
    where: {
      userId_builderId: {
        userId: user.id,
        builderId: builder.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      builderId: builder.id,
    },
  });

  revalidatePath("/builders");
  redirect("/builders?added=1");
}

function isBuilderKind(value: string): value is BuilderKind {
  return Object.values(BuilderKind).includes(value as BuilderKind);
}

export async function subscribeBuilderAction(formData: FormData) {
  const user = await requireUser();
  const builderId = String(formData.get("builderId") ?? "");
  await prisma.subscription.upsert({
    where: {
      userId_builderId: {
        userId: user.id,
        builderId,
      },
    },
    update: {},
    create: {
      userId: user.id,
      builderId,
    },
  });
  revalidatePath("/builders");
  revalidatePath("/dashboard");
}

export async function unsubscribeBuilderAction(formData: FormData) {
  const user = await requireUser();
  const builderId = String(formData.get("builderId") ?? "");
  await prisma.subscription.deleteMany({
    where: {
      userId: user.id,
      builderId,
    },
  });
  revalidatePath("/builders");
  revalidatePath("/dashboard");
}

export async function approveDeviceLoginAction(formData: FormData) {
  const user = await requireUser();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const device = await prisma.deviceLogin.findUnique({ where: { code } });

  if (!device || device.expiresAt < new Date()) {
    redirect(`/device?code=${encodeURIComponent(code)}&error=expired`);
  }

  const { token, record } = await createAgentToken(user.id, "Terminal skill");
  await prisma.deviceLogin.update({
    where: { code },
    data: {
      userId: user.id,
      agentTokenId: record.id,
      issuedToken: token,
      approvedAt: new Date(),
    },
  });

  redirect(`/device?code=${encodeURIComponent(code)}&approved=1`);
}

export async function createPersonalTokenAction() {
  const user = await requireUser();
  const { token } = await createAgentToken(user.id, "Manual web token");
  redirect(`/settings?token=${encodeURIComponent(token)}`);
}

export async function revokeTokenAction(formData: FormData) {
  const user = await requireUser();
  const tokenId = String(formData.get("tokenId") ?? "");
  await prisma.agentToken.updateMany({
    where: {
      id: tokenId,
      userId: user.id,
    },
    data: { revokedAt: new Date() },
  });
  revalidatePath("/settings");
}

export async function subscribeAllDefaultBuildersAction() {
  const user = await requireUser();
  const builders = await prisma.builder.findMany({
    where: { kind: BuilderKind.X },
    take: 25,
  });
  for (const builder of builders) {
    await prisma.subscription.upsert({
      where: {
        userId_builderId: {
          userId: user.id,
          builderId: builder.id,
        },
      },
      update: {},
      create: {
        userId: user.id,
        builderId: builder.id,
      },
    });
  }
  revalidatePath("/builders");
  revalidatePath("/dashboard");
}
