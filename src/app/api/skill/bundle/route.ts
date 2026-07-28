import { buildAgentSkillBundle } from "@/lib/agent-skill-bundle";

export async function GET() {
  return Response.json(await buildAgentSkillBundle(), {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
