"use server";

import { BuilderKind, BuilderPoolOrigin, BuilderScope } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { activePoolBuilderIds, addBuilderToPool } from "@/lib/builder-pool";
import { builderKindForSourceType } from "@/lib/source-registry";
import { normalizeHandle, upsertBuilder } from "@/lib/builders";
import { sharePersonalLibraryToHub } from "@/lib/library-hub";
import { prisma } from "@/lib/prisma";

async function requireUser() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session.user;
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

export async function addPersonalBuilderAction(formData: FormData) {
  const user = await requireUser();
  const sourceType = String(formData.get("sourceType") ?? "x").trim() || "x";
  const handleInput = String(formData.get("handle") ?? "").trim();
  const sourceUrlInput = String(formData.get("sourceUrl") ?? "").trim();
  const crawlUrlInput = String(formData.get("crawlUrl") ?? "").trim();
  const handle = handleInput ? normalizeHandle(handleInput) : handleFromUrl(sourceUrlInput);
  const sourceUrl = sourceUrlInput || (handle ? `https://x.com/${handle}` : crawlUrlInput);
  const crawlUrl = crawlUrlInput || (sourceType === "blog" || sourceType === "podcast" ? sourceUrl : "");
  const name =
    String(formData.get("name") ?? "").trim() ||
    (handle ? `@${handle}` : hostFromUrl(sourceUrl));

  if (!name || (!handle && !sourceUrl && !crawlUrl)) {
    redirect("/builders?error=missing-builder");
  }

  const builder = await upsertBuilder({
    scope: BuilderScope.PERSONAL,
    ownerUserId: user.id,
    addedByUserId: user.id,
    kind: builderKindForSourceType(sourceType),
    sourceType,
    name,
    handle: sourceType === "x" ? handle : null,
    sourceUrl: sourceUrl || null,
    crawlUrl: crawlUrl || null,
  });

  await addBuilderToPool({
    userId: user.id,
    builderId: builder.id,
    origin: BuilderPoolOrigin.PERSONAL_SYNC,
  });
  revalidatePath("/builders");
  revalidatePath("/dashboard");
  redirect(`/builders?added=${encodeURIComponent(builder.id)}`);
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

function handleFromUrl(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(url.hostname)) return null;
    const [handle] = url.pathname.split("/").filter(Boolean);
    return handle ? normalizeHandle(handle) : null;
  } catch {
    return null;
  }
}

function hostFromUrl(value: string) {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
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
