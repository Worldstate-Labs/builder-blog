import { NextResponse } from "next/server";
import { getUserFromBearer } from "@/lib/tokens";

export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    email: user.email,
    userId: user.id,
    name: user.name,
  });
}
