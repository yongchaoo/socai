#!/usr/bin/env bash
# socai 执行日志 — 给自进化用的机械事件流（JSONL）。
# 编排者只 append / snapshot，不 Read 目标仓源码。
#
# Usage:
#   run-log.sh start  [--slug S] [--target-repo P] [--goal T] [--mode auto|attended]
#                     [--baseline X] [--merge X] [--executor X] [--reviewer X]
#                     [--host cursor|trae|workbuddy|claude-code|ci] [--model-orchestrator X]
#       stdout 一行 run_id；同时写 $SOCAI_LOG_ROOT/current/<slug>
#   run-log.sh event  [--run-id ID] --type TYPE [--batch N] [--json '{...}']
#                     [--key value]...
#   run-log.sh snapshot-plans [--run-id ID] --from DIR
#       拷贝 goal/00-master/NN-*.spec.md 到 logs/snapshots/<run_id>/plans/
#   run-log.sh finish [--run-id ID] [--status done|blocked|aborted] [--json '{...}']
#
# 默认根：SOCAI_LOG_ROOT 或 $SOCAI_HOME/logs（SOCAI_HOME 默认 ~/.local/share/socai）
set -euo pipefail

SOCAI_HOME="${SOCAI_HOME:-$HOME/.local/share/socai}"
ROOT="${SOCAI_LOG_ROOT:-$SOCAI_HOME/logs}"
RUNS="$ROOT/runs"
CURRENT="$ROOT/current"
SNAPS="$ROOT/snapshots"

die() { echo "run-log: $*" >&2; exit 2; }

slug_ok() {
  [[ "$1" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$ ]]
}

run_id_ok() {
  [[ "$1" =~ ^[0-9]{8}T[0-9]{6}Z-[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$ ]]
}

resolve_run_id() {
  local id="${RUN_ID:-}"
  if [[ -z "$id" && -n "${SLUG:-}" && -f "$CURRENT/$SLUG" ]]; then
    id="$(cat "$CURRENT/$SLUG")"
  fi
  [[ -n "$id" ]] || die "missing --run-id (or --slug with current pointer)"
  run_id_ok "$id" || die "bad run_id: $id"
  printf '%s' "$id"
}

clear_current_for_run() {
  local id="$1"
  mkdir -p "$CURRENT"
  local f
  for f in "$CURRENT"/*; do
    [[ -f "$f" ]] || continue
    if [[ "$(cat "$f")" == "$id" ]]; then
      rm -f "$f"
    fi
  done
}

append_jsonl() {
  local id="$1" obj="$2"
  mkdir -p "$RUNS"
  python3 -c '
import json, sys
obj = json.loads(sys.argv[1])
print(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
' "$obj" >> "$RUNS/$id.jsonl"
}

now_iso() {
  python3 -c 'from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))'
}

cmd="${1:-}"
shift || true

RUN_ID=""
SLUG=""
TYPE=""
BATCH=""
JSON="{}"
STATUS="done"
FROM=""
EXTRA=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --slug) SLUG="${2:-}"; shift 2 ;;
    --type) TYPE="${2:-}"; shift 2 ;;
    --batch) BATCH="${2:-}"; shift 2 ;;
    --json) JSON="${2:-}"; shift 2 ;;
    --status) STATUS="${2:-}"; shift 2 ;;
    --from) FROM="${2:-}"; shift 2 ;;
    --target-repo|--goal|--mode|--baseline|--merge|--executor|--reviewer|--host|--model-orchestrator|--model-executor|--model-reviewer)
      EXTRA+=("$1" "${2:-}")
      shift 2
      ;;
    --key)
      EXTRA+=("--key" "${2:-}")
      shift 2
      ;;
    *)
      die "unknown arg: $1"
      ;;
  esac
done

extra_json() {
  python3 -c '
import json, sys
pairs = sys.argv[1:]
out = {}
i = 0
while i < len(pairs):
    raw_k = pairs[i]
    v = pairs[i+1] if i+1 < len(pairs) else ""
    if raw_k in ("--key", "key") and "=" in v:
        k, _, rest = v.partition("=")
        out[k] = rest
    else:
        k = raw_k.lstrip("-").replace("-", "_")
        if k == "key":
            i += 2
            continue
        out[k] = v
    i += 2
print(json.dumps(out, ensure_ascii=False))
' "${EXTRA[@]+"${EXTRA[@]}"}"
}

case "$cmd" in
  start)
    [[ -n "$SLUG" ]] || die "start needs --slug"
    slug_ok "$SLUG" || die "bad slug: $SLUG"
    ts="$(date -u +%Y%m%dT%H%M%SZ)"
    run_id="${ts}-${SLUG}"
    mkdir -p "$RUNS" "$CURRENT"
    extras="$(extra_json)"
    obj="$(python3 -c '
import json, sys
from datetime import datetime, timezone
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
extras = json.loads(sys.argv[1])
payload = json.loads(sys.argv[4])
obj = {
  "ts": now,
  "run_id": sys.argv[2],
  "slug": sys.argv[3],
  "type": "run_start",
  "schema": 1,
  **extras,
  **payload,
}
print(json.dumps(obj, ensure_ascii=False))
' "$extras" "$run_id" "$SLUG" "$JSON")"
    append_jsonl "$run_id" "$obj"
    printf '%s\n' "$run_id" > "$CURRENT/$SLUG"
    printf '%s\n' "$run_id"
    ;;
  event)
    [[ -n "$TYPE" ]] || die "event needs --type"
    id="$(resolve_run_id)"
    extras="$(extra_json)"
    obj="$(python3 -c '
import json, sys
from datetime import datetime, timezone
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
payload = json.loads(sys.argv[1])
extras = json.loads(sys.argv[2])
obj = {
  "ts": now,
  "run_id": sys.argv[3],
  "type": sys.argv[4],
  **extras,
  **payload,
}
batch = sys.argv[5]
if batch:
    obj["batch"] = batch
print(json.dumps(obj, ensure_ascii=False))
' "$JSON" "$extras" "$id" "$TYPE" "$BATCH")"
    append_jsonl "$id" "$obj"
    ;;
  snapshot-plans)
    [[ -n "$FROM" ]] || die "snapshot-plans needs --from DIR"
    id="$(resolve_run_id)"
    dest="$SNAPS/$id/plans"
    mkdir -p "$dest"
    count=0
    if [[ -d "$FROM" ]]; then
      while IFS= read -r -d '' f; do
        cp "$f" "$dest/"
        count=$((count + 1))
      done < <(find "$FROM" -maxdepth 1 \( -name 'goal.md' -o -name '00-master.md' -o -name '[0-9][0-9]-*.spec.md' -o -name 'progress.md' -o -name '*.prompt.md' -o -name 'batch-*.prompt.md' \) -print0)
    fi
    extras="$(extra_json)"
    obj="$(python3 -c '
import json, sys
from datetime import datetime, timezone
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
print(json.dumps({
  "ts": now,
  "run_id": sys.argv[1],
  "type": "plan_snapshot",
  "files": int(sys.argv[2]),
  "path": sys.argv[3],
}, ensure_ascii=False))
' "$id" "$count" "$dest")"
    append_jsonl "$id" "$obj"
    echo "run-log: snapshot $count files -> $dest" >&2
    ;;
  finish)
    id="$(resolve_run_id)"
    extras="$(extra_json)"
    obj="$(python3 -c '
import json, sys
from datetime import datetime, timezone
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
payload = json.loads(sys.argv[1])
extras = json.loads(sys.argv[2])
obj = {
  "ts": now,
  "run_id": sys.argv[3],
  "type": "run_finish",
  "status": sys.argv[4],
  **extras,
  **payload,
}
print(json.dumps(obj, ensure_ascii=False))
' "$JSON" "$extras" "$id" "$STATUS")"
    append_jsonl "$id" "$obj"
    clear_current_for_run "$id"
    if [[ -n "${SLUG:-}" ]]; then
      rm -f "$CURRENT/$SLUG"
    fi
    ;;
  *)
    die "usage: start|event|snapshot-plans|finish"
    ;;
esac
