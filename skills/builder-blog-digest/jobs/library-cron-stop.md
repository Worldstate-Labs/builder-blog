Stop the FollowBrief private source library scheduled job on this machine.

This is an interactive local agent task. Do not ask the user questions except
where step 1 requires it (more than one library job is found and the account is
ambiguous), or when a scheduler permission blocks removal. Run the numbered
steps exactly. If any command fails, stop and report the command, exit code, and
stderr. Do not invoke any other skill, plugin, or subagent — run the numbered
steps yourself exactly as written; this prompt is the whole task.

Scope — do not exceed it: remove only the recurring **schedule** (the launchd
LaunchAgent on macOS, or the crontab entry on Linux), then report that stopped
state to FollowBrief. Do not delete any already-fetched library content, and do
not touch the digest cron.

1. Find the existing FollowBrief library job(s) on this machine. Run the path
for this machine's OS — run `uname` if unsure.

### macOS (`uname` is Darwin)

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
if [ -n "$ACCT" ]; then
  printf 'com.followbrief.library.%s\n' "$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
else
  launchctl list 2>/dev/null | awk '{ print $3 }' | grep -E '^com\.followbrief\.library\.' || echo "(none found)"
fi
```

### Linux / other

```bash
crontab -l 2>/dev/null | grep -E 'builder-agent-runner\.sh library-cron' || echo "(none found)"
```

If the result is "(none found)" — or, on macOS, the account-scoped label is not
present in `launchctl list 2>/dev/null | awk '{ print $3 }'` — STOP: report that
there is no library schedule to remove, and change nothing. If more than one
library job is listed and `BUILDER_BLOG_ACCOUNT` is not set (so you can't tell
which account to stop), list them and ask the user which to stop before
continuing — removing all of them stops every FollowBrief account on this
machine.

2. Remove the schedule. Use the path for this machine's OS.

### macOS (`uname` is Darwin) → unload the LaunchAgent and delete its plist

Set `LABEL` to the job you are stopping. When the account email is available it
derives the label exactly as the setup did; otherwise set `LABEL` to the exact
label printed in step 1.

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
[ -n "$ACCT" ] && LABEL="com.followbrief.library.$(printf '%s' "$ACCT" | tr -c 'a-zA-Z0-9' '_')"
# If BUILDER_BLOG_ACCOUNT is unset, replace the line above with the label from
# step 1, e.g. LABEL="com.followbrief.library.jie_worldstatelabs_com"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && echo "STILL PRESENT: $LABEL" || echo "removed: $LABEL"
```

### Linux / other → drop the crontab entry

```bash
ACCT="${BUILDER_BLOG_ACCOUNT}"
if [ -n "$ACCT" ]; then
  crontab -l 2>/dev/null | grep -v "# FollowBrief library cron · $ACCT" | grep -v "BUILDER_BLOG_ACCOUNT=\"$ACCT\".*builder-agent-runner.sh library-cron" | crontab -
else
  crontab -l 2>/dev/null | grep -v "# FollowBrief library cron" | grep -v "builder-agent-runner.sh library-cron" | crontab -
fi
crontab -l 2>/dev/null | grep -E 'builder-agent-runner\.sh library-cron' && echo "STILL PRESENT" || echo "removed"
```

3. Remove the per-job pin files so a future re-install starts clean (safe if
they are absent):

```bash
rm -f "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/runtime-library-cron" \
      "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/fetch-force-library-cron"
```

4. Report the stopped status to FollowBrief so the web app stops expecting
future library fetch runs:

```bash
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" cron-status \
  --job library-cron \
  --status stopped
```

5. Report the outcome to the user: which label (macOS) or crontab entry (Linux)
was removed (or that none existed), and that the step-2 verification line printed
"removed". Tell the user they can resume later by re-running the library cron
setup prompt.
