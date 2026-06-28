import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import { normalizeCloudLanguageLibraryPatchInput } from "@/lib/cloud-source-config";
import { prisma } from "@/lib/prisma";
import { formatZodError } from "@/lib/zod-error";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await requireCloudFetchAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  }

  const libraries = await prisma.cloudLanguageLibrary.findMany({
    include: {
      owner: { select: { id: true, email: true, name: true } },
      hubEntry: { select: { id: true, slug: true, name: true } },
    },
    orderBy: { summaryLanguage: "asc" },
  });
  return NextResponse.json({
    status: "ok",
    libraries,
  });
}

export async function PATCH(request: Request) {
  const admin = await requireCloudFetchAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  }

  const parsed = normalizePatch(await request.json().catch(() => ({})));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const owner = await findCloudLibraryOwner({
    ownerUserId: parsed.data.ownerUserId,
    ownerEmail: parsed.data.ownerEmail,
  });
  if (!owner) {
    return NextResponse.json({ error: "Cloud owner user was not found." }, { status: 404 });
  }

  const library = await prisma.cloudLanguageLibrary.upsert({
    where: { summaryLanguage: parsed.data.summaryLanguage },
    update: {
      ownerUserId: owner.id,
      enabled: parsed.data.enabled,
    },
    create: {
      summaryLanguage: parsed.data.summaryLanguage,
      ownerUserId: owner.id,
      enabled: parsed.data.enabled,
    },
    include: {
      owner: { select: { id: true, email: true, name: true } },
      hubEntry: { select: { id: true, slug: true, name: true } },
    },
  });
  return NextResponse.json({
    status: "ok",
    library,
  });
}

async function findCloudLibraryOwner(input: {
  ownerUserId: string | null;
  ownerEmail: string | null;
}) {
  if (input.ownerUserId) {
    return prisma.user.findUnique({
      where: { id: input.ownerUserId },
      select: { id: true },
    });
  }
  if (!input.ownerEmail) return null;
  return prisma.user.findUnique({
    where: { email: input.ownerEmail },
    select: { id: true },
  });
}

function normalizePatch(input: unknown) {
  try {
    return { ok: true as const, data: normalizeCloudLanguageLibraryPatchInput(input) };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false as const, error: formatZodError(error) };
    }
    return { ok: false as const, error: "Invalid cloud language library config." };
  }
}
