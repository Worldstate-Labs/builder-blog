<!--
Shared interactive setup gate for runner-owned local speech transcription.
Installation is deliberately outside unattended runners and requires consent.
-->
Check this machine's managed-media capability before starting or scheduling a
fetch. The check writes a versioned machine profile with absolute executable
paths; unattended runs consume that profile and never install dependencies.

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ASR_PATH="$AGENT_DIR/asr-venv/bin:$PATH"
set +e
PATH="$ASR_PATH" node "$AGENT_DIR/builder-digest.mjs" asr-doctor
ASR_DOCTOR_CODE="$?"
set -e
case "$ASR_DOCTOR_CODE" in
  0) echo "FOLLOWBRIEF_ASR_READY" ;;
  2) echo "FOLLOWBRIEF_ASR_SETUP_NEEDED" ;;
  *) exit "$ASR_DOCTOR_CODE" ;;
esac
```

If it prints `FOLLOWBRIEF_ASR_READY`, continue. If it prints
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
brew install yt-dlp ffmpeg
python3 -m venv "$AGENT_DIR/asr-venv"
"$AGENT_DIR/asr-venv/bin/python" -m pip install --upgrade pip faster-whisper
```

### Linux / other

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
command -v apt-get >/dev/null 2>&1 || {
  echo "Automatic setup currently requires apt-get. Install ffmpeg, python3-venv, yt-dlp, and faster-whisper with this system's package manager, then re-run this setup prompt." >&2
  exit 69
}
sudo apt-get update
sudo apt-get install -y ffmpeg python3 python3-venv
python3 -m venv "$AGENT_DIR/asr-venv"
"$AGENT_DIR/asr-venv/bin/python" -m pip install --upgrade pip yt-dlp faster-whisper
```

Then verify the installed paths and backend. Do not continue if this still
reports setup needed:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
PATH="$AGENT_DIR/asr-venv/bin:$PATH" node "$AGENT_DIR/builder-digest.mjs" asr-doctor
```
