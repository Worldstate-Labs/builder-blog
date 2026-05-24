import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { builderLibraryState } from "@/lib/builder-library-state";

export const runtime = "nodejs";
export const maxDuration = 300;

const pollMs = 2500;
const pingEveryMs = 15_000;
const streamMaxMs = 4 * 60 * 1000;

export async function GET(req: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  let lastVersion = url.searchParams.get("version") ?? "";
  const userId = session.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };
      const ping = () => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          closed = true;
        }
      };
      const closeStream = () => {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      send("open", { version: lastVersion });
      const started = Date.now();
      let lastPing = Date.now();

      while (!req.signal.aborted && !closed && Date.now() - started < streamMaxMs) {
        try {
          const builderIds = await activePoolBuilderIds(userId);
          const state = await builderLibraryState(userId, builderIds);
          if (state.version !== lastVersion) {
            lastVersion = state.version;
            send("library-state", state);
          } else if (Date.now() - lastPing > pingEveryMs) {
            ping();
            lastPing = Date.now();
          }
        } catch (error) {
          console.error("[library-stream] poll error:", error);
          send("error", { message: "library stream error" });
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }

      closeStream();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
