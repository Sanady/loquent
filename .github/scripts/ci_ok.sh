#!/usr/bin/env bash
# Decide whether the CI aggregate gate passes.
# Usage: ci_ok.sh '<needs JSON from toJSON(needs)>' <github event name>
# Fails when a needed job failed or was cancelled, when any job other than pr-title
# was skipped, or when pr-title was skipped on a pull_request event.
set -euo pipefail

needs_json=${1:?needs JSON required}
event_name=${2:-}

bad=$(jq -r --arg event "$event_name" '
  to_entries[]
  | select(
      .value.result == "failure"
      or .value.result == "cancelled"
      or (.value.result == "skipped" and (.key != "pr-title" or $event == "pull_request"))
    )
  | "\(.key): \(.value.result)"
' <<<"$needs_json")

if [ -n "$bad" ]; then
  echo "CI gate failed:" >&2
  echo "$bad" >&2
  exit 1
fi
echo "CI gate passed."
