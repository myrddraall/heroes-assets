#!/usr/bin/env bash
# Waits for a dispatched workflow run to finish and fails if it failed: the newest
# workflow_dispatch run of <workflow> on <branch> for commit <sha>.
#
#   tools/await-run.sh <workflow file> <branch> <sha>
set -euo pipefail
workflow=$1 branch=$2 sha=$3
run=''
for _ in $(seq 60); do
  run=$(gh run list --workflow "$workflow" --branch "$branch" --event workflow_dispatch \
    --json databaseId,headSha --jq "map(select(.headSha == \"$sha\")) | .[0].databaseId // empty")
  [ -n "$run" ] && break
  sleep 10
done
[ -n "$run" ] || { echo "::error::$workflow never started on $branch for $sha"; exit 1; }
echo "Waiting for $workflow run $run"
gh run watch "$run" --exit-status --interval 15 > /dev/null
