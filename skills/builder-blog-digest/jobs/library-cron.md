Use the Builder Blog skill to run the scheduled private library job.

This is an unattended scheduled run. Do not ask the user questions.

Run these steps exactly. If any command fails, stop and write the command, exit
code, and stderr to the scheduled job log. Do not browse for extra context. Do
not use `--force` unless the user explicitly requested a forced run in the
scheduled job configuration.

Before doing work, ensure the skill is installed:

```bash
/bin/sh -c "$(curl -fsSL ${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}/api/skill/bootstrap)"
```

Then crawl and sync personal builders:

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" crawl-personal --days 30 --limit 3
```

Rules:

- Skip posts that are already synced.
- Only use agent judgment if a source requires AI work, transcription, cookies,
  or custom access. In that case, use the local agent environment and sync the
  resulting items through the Builder Blog CLI.
- If the run cannot complete without a missing credential or unsupported local
  capability, write the concrete reason to the scheduled job log and stop.
