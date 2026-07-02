#!/bin/sh
set -eu

AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
export BUILDER_BLOG_RUN_SOURCE="${BUILDER_BLOG_RUN_SOURCE:-cloud}"

exec "$AGENT_DIR/builder-agent-runner.sh" cloud-library-host
