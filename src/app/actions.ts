"use server";

import { BuilderKind, BuilderPoolOrigin, BuilderScope, LibraryHubKind } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { activePoolBuilderIds, addBuilderToPool } from "@/lib/builder-pool";
import { inferBuilderKind, normalizeHandle } from "@/lib/builder-keys";
import { upsertBuilder } from "@/lib/builders";
import {
  importLibrariesFromHub,
  sharePersonalLibraryToHub,
  unsharePersonalLibraryFromHub,
} from "@/lib/library-hub";
import { prisma } from "@/lib/prisma";
import { builderKindForSourceType } from "@/lib/source-registry";
import {
  defaultDigestMaxPostAgeDays,
  digestMaxPostAgeDays,
  normalizeDigestFrequency,
} from "@/lib/feed-preferences";
import { createAgentToken } from "@/lib/tokens";

async function requireUser() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session.user;
}

async function requireAdminUser() {
  const user = await requireUser();
  if (!isAdminEmail(user.email)) {
    redirect("/dashboard?error=admin-required");
  }
  return user;
}

export async function addCentralBuilderAction(formData: FormData) {
  const user = await requireUser();
  if (!isAdminEmail(user.email)) {
    redirect("/dashboard?error=admin-required");
  }
  const name = String(formData.get("name") ?? "").trim();
  const handleInput = String(formData.get("handle") ?? "").trim();
  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim();
  const sourceType = String(formData.get("sourceType") ?? "").trim();
  const kindInput = String(formData.get("kind") ?? "").trim();
  const explicitSourceType = sourceType.toLowerCase() === "auto" ? "" : sourceType;

  if (!name || (!handleInput && !sourceUrl)) {
    redirect("/admin?error=missing-builder");
  }

  const handle = handleInput ? normalizeHandle(handleInput) : null;
  const kind = explicitSourceType
    ? builderKindForSourceType(explicitSourceType)
    : isBuilderKind(kindInput)
      ? kindInput
      : inferBuilderKind(sourceUrl || null, handle);
  const builder = await upsertBuilder({
    scope: BuilderScope.CENTRAL,
    kind,
    sourceType: explicitSourceType || null,
    name,
    handle,
    sourceUrl: sourceUrl || (handle ? `https://x.com/${handle}` : null),
    crawlUrl: kind === BuilderKind.BLOG || kind === BuilderKind.PODCAST ? sourceUrl : null,
    addedByUserId: user.id,
  });

  revalidatePath("/admin");
  revalidatePath("/builders");
  redirect(`/admin?builder=${encodeURIComponent(builder.id)}`);
}

export async function deleteCentralBuilderAction(formData: FormData) {
  await requireAdminUser();
  const builderId = String(formData.get("builderId") ?? "");
  await prisma.builder.deleteMany({
    where: {
      id: builderId,
      scope: BuilderScope.CENTRAL,
    },
  });
  revalidatePath("/admin");
  revalidatePath("/builders");
}

function isBuilderKind(value: string): value is BuilderKind {
  return Object.values(BuilderKind).includes(value as BuilderKind);
}

export async function subscribeBuilderAction(formData: FormData) {
  const user = await requireUser();
  const builderId = String(formData.get("builderId") ?? "");
  const poolBuilderIds = await activePoolBuilderIds(user.id);
  if (!poolBuilderIds.includes(builderId)) {
    redirect("/builders?error=not-in-library");
  }
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
  redirect("/builders?subscribed=1");
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
  redirect("/builders?unsubscribed=1");
}

export async function addBuilderToLibraryAction(formData: FormData) {
  const user = await requireUser();
  const builderId = String(formData.get("builderId") ?? "");
  const builder = await prisma.builder.findUnique({
    where: { id: builderId },
    select: { scope: true, ownerUserId: true },
  });
  if (!builder) redirect("/builders?error=missing-builder");
  if (builder.scope === BuilderScope.PERSONAL && builder.ownerUserId !== user.id) {
    redirect("/builders?error=not-your-builder");
  }
  await addBuilderToPool({
    userId: user.id,
    builderId,
    origin:
      builder.scope === BuilderScope.CENTRAL
        ? BuilderPoolOrigin.HUB_IMPORT
        : BuilderPoolOrigin.PERSONAL_SYNC,
  });
  revalidatePath("/builders");
  revalidatePath("/dashboard");
  redirect("/builders?added=1");
}

export async function removeBuilderFromLibraryAction(formData: FormData) {
  const user = await requireUser();
  const builderId = String(formData.get("builderId") ?? "");
  const poolEntry = await prisma.builderPoolEntry.findUnique({
    where: {
      userId_builderId: {
        userId: user.id,
        builderId,
      },
    },
    select: { origin: true, removedAt: true },
  });

  if (!poolEntry || poolEntry.removedAt) {
    redirect("/builders?error=not-in-library");
  }
  if (poolEntry.origin === BuilderPoolOrigin.HUB_IMPORT) {
    redirect("/builders?error=imported-builder-remove-denied");
  }

  await prisma.$transaction([
    prisma.subscription.deleteMany({
      where: { userId: user.id, builderId },
    }),
    prisma.builderPoolEntry.updateMany({
      where: { userId: user.id, builderId },
      data: { removedAt: new Date() },
    }),
  ]);
  revalidatePath("/builders");
  revalidatePath("/dashboard");
  redirect("/builders?removed=1");
}

export async function sharePersonalLibraryToHubAction(formData: FormData) {
  const user = await requireUser();
  const name =
    String(formData.get("name") ?? "").trim() ||
    `${user.name || user.email || "Personal"} library`;
  const description = String(formData.get("description") ?? "").trim();

  const result = await sharePersonalLibraryToHub({
    userId: user.id,
    name,
    description,
  });
  revalidatePath("/library-hub");
  revalidatePath("/builders");
  const redirectTo = String(formData.get("redirectTo") ?? "");
  redirect(redirectTo === "/builders" ? `/builders?shared=${result.builderCount}` : `/library-hub?shared=${result.builderCount}`);
}

export async function togglePersonalLibraryHubAvailabilityAction(formData: FormData) {
  const user = await requireUser();
  const existing = await prisma.libraryHubEntry.findFirst({
    where: {
      ownerUserId: user.id,
      kind: LibraryHubKind.PERSONAL,
    },
    select: { id: true },
  });

  if (existing) {
    await unsharePersonalLibraryFromHub(user.id);
    revalidatePath("/library-hub");
    revalidatePath("/builders");
    redirect("/builders?hub=private");
  }

  const name =
    String(formData.get("name") ?? "").trim() ||
    `${user.name || user.email || "Personal"} library`;
  const result = await sharePersonalLibraryToHub({
    userId: user.id,
    name,
  });
  revalidatePath("/library-hub");
  revalidatePath("/builders");
  redirect(`/builders?hub=public&shared=${result.builderCount}`);
}

export async function importHubLibrariesAction(formData: FormData) {
  const user = await requireUser();
  const libraryIds = formData
    .getAll("libraryId")
    .map((value) => String(value))
    .filter(Boolean);
  const result = await importLibrariesFromHub({
    userId: user.id,
    libraryIds,
  });

  revalidatePath("/library-hub");
  revalidatePath("/builders");
  revalidatePath("/dashboard");
  redirect(`/library-hub?imported=${result.builders}`);
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

export async function updateFeedPreferenceAction(formData: FormData) {
  const user = await requireUser();
  const digestFrequency = normalizeDigestFrequency(
    String(formData.get("digestFrequency") ?? ""),
  );
  const customDaysInput = Number(formData.get("digestCustomFrequencyDays"));
  const digestCustomFrequencyDays =
    Number.isFinite(customDaysInput) && customDaysInput > 0
      ? Math.min(365, Math.floor(customDaysInput))
      : null;
  const maxPostAgeInput = Number(formData.get("digestMaxPostAgeDays"));
  const recommendationProfile = String(formData.get("recommendationProfile") ?? "")
    .trim()
    .slice(0, 4000);

  await prisma.userFeedPreference.upsert({
    where: { userId: user.id },
    update: {
      digestFrequency,
      digestCustomFrequencyDays,
      digestMaxPostAgeDays: digestMaxPostAgeDays({
        digestMaxPostAgeDays: Number.isFinite(maxPostAgeInput)
          ? maxPostAgeInput
          : defaultDigestMaxPostAgeDays,
      }),
      recommendationProfile: recommendationProfile || null,
    },
    create: {
      userId: user.id,
      digestFrequency,
      digestCustomFrequencyDays,
      digestMaxPostAgeDays: digestMaxPostAgeDays({
        digestMaxPostAgeDays: Number.isFinite(maxPostAgeInput)
          ? maxPostAgeInput
          : defaultDigestMaxPostAgeDays,
      }),
      recommendationProfile: recommendationProfile || null,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/recommendations");
  redirect("/settings?saved=feed");
}

export async function subscribeAllDefaultBuildersAction() {
  const user = await requireUser();
  const poolBuilderIds = await activePoolBuilderIds(user.id);
  const builders = await prisma.builder.findMany({
    where: { id: { in: poolBuilderIds }, kind: BuilderKind.X },
    select: { id: true },
  });
  if (builders.length > 0) {
    await prisma.subscription.createMany({
      data: builders.map((builder) => ({
        userId: user.id,
        builderId: builder.id,
      })),
      skipDuplicates: true,
    });
  }
  revalidatePath("/builders");
  revalidatePath("/dashboard");
  redirect("/builders?subscribed=default");
}

export async function subscribeAllLibraryBuildersAction() {
  const user = await requireUser();
  const poolBuilderIds = await activePoolBuilderIds(user.id);
  if (poolBuilderIds.length > 0) {
    await prisma.subscription.createMany({
      data: poolBuilderIds.map((builderId) => ({
        userId: user.id,
        builderId,
      })),
      skipDuplicates: true,
    });
  }
  revalidatePath("/builders");
  revalidatePath("/dashboard");
  redirect("/builders?subscribed=all");
}
