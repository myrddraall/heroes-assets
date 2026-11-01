#!/usr/bin/env bash
# Dispatches a workflow on a branch, waits for that run to finish and fails if it failed.
# The run is found by the branch's tip commit and its start time, so a run left from an earlier
# attempt on the same commit is never mistaken for it.
#
#   tools/await-run.sh <workflow file> <branch> [-f key=value ...]
set -euo pipefail
workflow=$1 branch=$2
shift 2
sha=$(gh api "repos/{owner}/{repo}/commits/$branch" --jq .sha)
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gh workflow run "$workflow" --ref "$branch" "$@"
run=''
for _ in $(seq 60); do
  sleep 10
  run=$(gh run list --workflow "$workflow" --branch "$branch" --event workflow_dispatch \
    --json databaseId,headSha,createdAt \
    --jq "map(select(.headSha == \"$sha\" and .createdAt >= \"$since\")) | last | .databaseId // empty")
  [ -n "$run" ] && break
done
[ -n "$run" ] || { echo "::error::$workflow never started on $branch ($sha)"; exit 1; }
echo "Waiting for $workflow run $run"
gh run watch "$run" --exit-status --interval 15 > /dev/null
