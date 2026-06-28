import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireCloudFetchAdmin } from "@/lib/cloud-source-admin";
import {
  CLOUD_FETCH_CONFIG_ID,
  normalizeCloudFetchConfigPatchInput,
  serializeCloudFetchConfig,
} from "@/lib/cloud-source-config";
import { prisma } from "@/lib/prisma";
import { formatZodError } from "@/lib/zod-error";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await requireCloudFetchAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  }

  const config = await prisma.cloudFetchConfig.findUnique({
    where: { id: CLOUD_FETCH_CONFIG_ID },
  });
  return NextResponse.json({
    status: "ok",
    config: serializeCloudFetchConfig(config),
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

  const config = await prisma.cloudFetchConfig.upsert({
    where: { id: CLOUD_FETCH_CONFIG_ID },
    update: {
      ...parsed.data,
      updatedByUserId: admin.user.id,
    },
    create: {
      id: CLOUD_FETCH_CONFIG_ID,
      ...parsed.data,
      updatedByUserId: admin.user.id,
    },
  });
  return NextResponse.json({
    status: "ok",
    config: serializeCloudFetchConfig(config),
  });
}

function normalizePatch(input: unknown) {
  try {
    return { ok: true as const, data: normalizeCloudFetchConfigPatchInput(input) };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false as const, error: formatZodError(error) };
    }
    return { ok: false as const, error: "Invalid cloud fetch config." };
  }
}
