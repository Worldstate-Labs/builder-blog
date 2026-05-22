#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const CONFIG_DIR = join(homedir(), ".builder-blog");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

function usage() {
  console.log(`builder-digest commands:
  login --app-url http://localhost:3000
  prepare [--days 1]
  sync-builders --file personal-builders.json
  sync --file digest.md [--title "AI Builder Digest"]
  status`);
}

async function readConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  return JSON.parse(await readFile(CONFIG_PATH, "utf8"));
}

async function saveConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function argValue(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

async function postJson(url, body, token) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function getJson(url, token) {
  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && data.status !== "pending") {
    throw new Error(data.error || data.status || `HTTP ${response.status}`);
  }
  return data;
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const child = spawn(command, [url], { detached: true, stdio: "ignore" });
  child.unref();
}

async function login(args) {
  const appUrl = argValue(args, "--app-url", process.env.BUILDER_BLOG_URL || "http://localhost:3000").replace(/\/$/, "");
  const start = await postJson(`${appUrl}/api/device/start`, { appName: "Builder Blog skill" });
  console.log(`Open this URL to approve the terminal:\n${start.verificationUrl}\n`);
  console.log(`Code: ${start.code}`);
  openBrowser(start.verificationUrl);

  const deadline = Date.now() + (start.expiresInSeconds ?? 600) * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const poll = await getJson(`${appUrl}/api/device/poll?code=${encodeURIComponent(start.code)}`);
    if (poll.status === "approved" && poll.token) {
      await saveConfig({ appUrl, token: poll.token });
      console.log(`Logged in. Config saved to ${CONFIG_PATH}`);
      return;
    }
    process.stdout.write(".");
  }
  throw new Error("Login timed out");
}

async function prepare(args) {
  const config = await readConfig();
  if (!config.appUrl || !config.token) {
    throw new Error("Not logged in. Run: builder-digest login --app-url http://localhost:3000");
  }
  const days = argValue(args, "--days", "1");
  const context = await getJson(`${config.appUrl}/api/skill/context?days=${encodeURIComponent(days)}`, config.token);
  console.log(JSON.stringify(context, null, 2));
}

async function sync(args) {
  const config = await readConfig();
  if (!config.appUrl || !config.token) {
    throw new Error("Not logged in. Run: builder-digest login --app-url http://localhost:3000");
  }

  const file = argValue(args, "--file");
  const title = argValue(args, "--title", `AI Builder Digest — ${new Date().toLocaleDateString()}`);
  let content = "";
  if (file) {
    content = await readFile(file, "utf8");
  } else {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    content = Buffer.concat(chunks).toString("utf8");
  }
  if (!content.trim()) throw new Error("Digest content is empty");

  const now = new Date();
  const result = await postJson(
    `${config.appUrl}/api/skill/digests`,
    {
      title,
      content,
      language: "zh",
      periodStart: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      periodEnd: now.toISOString(),
      itemCount: Number(argValue(args, "--item-count", "0")),
    },
    config.token,
  );
  console.log(JSON.stringify(result, null, 2));
}

async function syncBuilders(args) {
  const config = await readConfig();
  if (!config.appUrl || !config.token) {
    throw new Error("Not logged in. Run: builder-digest login --app-url http://localhost:3000");
  }

  const file = argValue(args, "--file");
  if (!file) throw new Error("Missing --file personal-builders.json");
  const payload = JSON.parse(await readFile(file, "utf8"));
  const result = await postJson(`${config.appUrl}/api/skill/builders`, payload, config.token);
  console.log(JSON.stringify(result, null, 2));
}

async function status() {
  const config = await readConfig();
  console.log(
    JSON.stringify(
      {
        loggedIn: Boolean(config.appUrl && config.token),
        appUrl: config.appUrl ?? null,
        configPath: CONFIG_PATH,
      },
      null,
      2,
    ),
  );
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "login") await login(args);
  else if (command === "prepare") await prepare(args);
  else if (command === "sync-builders") await syncBuilders(args);
  else if (command === "sync") await sync(args);
  else if (command === "status") await status();
  else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
