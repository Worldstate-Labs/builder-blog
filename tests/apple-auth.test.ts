import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("Apple sign-in is wired through NextAuth and the login UI", () => {
  const auth = source("src/lib/auth.ts");
  const authButtons = source("src/components/AuthButtons.tsx");
  const envExample = source(".env.example");

  assert.match(auth, /AppleProvider/);
  assert.match(auth, /process\.env\.APPLE_ID/);
  assert.match(auth, /process\.env\.APPLE_SECRET/);
  assert.match(auth, /allowDangerousEmailAccountLinking:\s*true/);
  assert.match(authButtons, /type Provider = "google" \| "github" \| "apple"/);
  assert.match(authButtons, /function AppleIcon/);
  assert.match(authButtons, /label: "Apple"/);
  assert.match(envExample, /APPLE_ID=""/);
  assert.match(envExample, /APPLE_SECRET=""/);
});
