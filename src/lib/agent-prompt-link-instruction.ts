export function buildAgentPromptLinkInstruction(url: string) {
  return [
    `Retrieve ${url} and follow the instructions.`,
    "If browser access is blocked, use Node.js fetch instead of curl.",
  ].join(" ");
}
