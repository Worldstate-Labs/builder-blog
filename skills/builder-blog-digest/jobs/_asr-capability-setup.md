<!--
Shared interactive setup gate for runner-owned local speech transcription.
Installation is deliberately outside unattended runners and requires consent.
-->
Check this machine's managed-media capability before starting or scheduling a
fetch. The check writes a versioned machine profile with absolute executable
paths, including a Node.js 22+ JavaScript runtime for YouTube extraction and,
when installed, the YouTube PO token provider; unattended runs consume that
profile and never install dependencies.

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ASR_PATH="$AGENT_DIR/asr-venv/bin:$PATH"
set +e
ASR_DOCTOR_OUTPUT="$(PATH="$ASR_PATH" node "$AGENT_DIR/builder-digest.mjs" asr-doctor)"
ASR_DOCTOR_CODE="$?"
set -e
printf '%s\n' "$ASR_DOCTOR_OUTPUT"
case "$ASR_DOCTOR_CODE" in
  0)
    if printf '%s' "$ASR_DOCTOR_OUTPUT" | node -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const profile = JSON.parse(input);
        process.exit(Array.isArray(profile.maintenanceWarnings) && profile.maintenanceWarnings.length > 0 ? 0 : 1);
      });
    '; then
      echo "FOLLOWBRIEF_ASR_MAINTENANCE_RECOMMENDED"
    else
      echo "FOLLOWBRIEF_ASR_READY"
    fi
    ;;
  2) echo "FOLLOWBRIEF_ASR_SETUP_NEEDED" ;;
  *) exit "$ASR_DOCTOR_CODE" ;;
esac
```

If it prints `FOLLOWBRIEF_ASR_READY`, continue. If it prints
`FOLLOWBRIEF_ASR_MAINTENANCE_RECOMMENDED`, report the `maintenanceWarnings`
and ask whether the user wants to act on them before the initial fetch.
This is maintenance, not missing capability: if the user declines, continue
without updating and do not block the fetch or scheduler setup. Never update
or install tools unattended.

- `yt_dlp_outdated`: offer to update the media downloader.
- `pot_provider_missing`: YouTube now demands a proof-of-origin (PO) token
  for many media downloads; without a local PO token provider those posts
  fail with Action needed while everything else still runs. Offer to install
  the provider with the "PO token provider" block below (any OS). If the
  user declines, continue.

If it prints
`FOLLOWBRIEF_ASR_SETUP_NEEDED`, report the `missing` entries and ask whether the
user wants to install the local media dependencies. **Do not install
unattended.** If the user declines during a private one-time or scheduled fetch
setup, continue; media posts without captions will be reported as Action
needed, while other posts still run. If the user declines during Cloud worker
host setup, stop before replacing or installing the host.

Only after explicit consent, run the block for this machine's OS:

### macOS (`uname` is Darwin)

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
command -v brew >/dev/null 2>&1 || {
  echo "Homebrew is required to install FollowBrief media dependencies on macOS." >&2
  exit 69
}
command -v python3 >/dev/null 2>&1 || {
  echo "python3 is required to install the local speech backend." >&2
  exit 69
}
brew install ffmpeg
python3 -m venv "$AGENT_DIR/asr-venv"
"$AGENT_DIR/asr-venv/bin/python" -m pip install --upgrade pip "yt-dlp[default]" faster-whisper
```

### Linux / other

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
command -v apt-get >/dev/null 2>&1 || {
  echo "Automatic setup currently requires apt-get. Install Node.js 22+, ffmpeg, python3-venv, yt-dlp with its default EJS support, and faster-whisper with this system's package manager, then re-run this setup prompt." >&2
  exit 69
}
sudo apt-get update
sudo apt-get install -y ffmpeg python3 python3-venv
python3 -m venv "$AGENT_DIR/asr-venv"
"$AGENT_DIR/asr-venv/bin/python" -m pip install --upgrade pip "yt-dlp[default]" faster-whisper
```

### PO token provider (any OS, after explicit consent)

Installs the bgutil PO token provider so YouTube downloads behind the
proof-of-origin wall stop failing with 403. Two parts, both consumed on
demand by the media downloader — the runner starts the provider only for
the duration of a media download and stops it afterwards, so nothing stays
running between fetches:

- the provider runtime, built into `$AGENT_DIR/pot-provider` (pinned
  version; the yt-dlp invocation points at it explicitly), and
- the yt-dlp plugin, copied into yt-dlp's user plugin directory so it is
  loaded regardless of how yt-dlp itself was installed.

Requires `git` and `npm` (npm ships with the Node.js runtime this skill
already requires). The dependency download is ~60MB, so this can take a
few minutes on slow networks; it honors the usual npm registry overrides.

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
command -v git >/dev/null 2>&1 || {
  echo "git is required to install the FollowBrief PO token provider." >&2
  exit 69
}
command -v npm >/dev/null 2>&1 || {
  echo "npm (bundled with Node.js 22+) is required to install the FollowBrief PO token provider." >&2
  exit 69
}
POT_DIR="$AGENT_DIR/pot-provider"
rm -rf "$POT_DIR"
git clone --depth 1 --single-branch --branch 1.3.1 \
  https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "$POT_DIR"
cd "$POT_DIR/server"
npm ci
npx tsc
npm prune --omit=dev
test -f "$POT_DIR/server/build/generate_once.js" || {
  echo "PO token provider build did not produce build/generate_once.js." >&2
  exit 70
}
PLUGIN_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/yt-dlp/plugins/bgutil"
mkdir -p "$PLUGIN_DIR"
rm -rf "$PLUGIN_DIR/yt_dlp_plugins"
cp -R "$POT_DIR/plugin/yt_dlp_plugins" "$PLUGIN_DIR/"
```

Then verify the installed paths and backend. Do not continue if this still
reports setup needed, and after a consented PO token provider install the
`pot_provider_missing` maintenance warning must be gone:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
PATH="$AGENT_DIR/asr-venv/bin:$PATH" node "$AGENT_DIR/builder-digest.mjs" asr-doctor
```
