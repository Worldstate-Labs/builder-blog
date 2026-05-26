export async function markPostRead(feedItemId: string): Promise<void> {
  try {
    await fetch("/api/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedItemId }),
    });
  } catch {
    // best-effort; read state can be re-recorded on subsequent interactions
  }
}
