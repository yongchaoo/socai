#!/usr/bin/env bash
# socai bug memory helper — 调 life-kb 检索/写入跨任务失败记忆。
# 编排者用；零渗漏：输出重定向到文件，编排者不读内容（守「编排者恒定 context」铁律）。
#
# Usage:
#   bug-memory.sh recall <slug> <query...>
#       检索 life-kb（category=procedure）→ 写 .socai/<slug>/bug-memory.md
#   bug-memory.sh ingest <bug-md-path>
#       把一条「症状+根因+修复+防回归断言」四元组文件写入 life-kb
#   bug-memory.sh doctor
#       打印解析到的 LIFE_DIR / 依赖 / 一次探测检索；非 0 = 记忆不可用
#
# Env / 解析顺序（第一个含 src/cli/search.ts 的目录胜出）：
#   1. MA_LIFE_DIR（显式设置但未含 src/cli/search.ts → 不 fall-through，
#      直接按该路径报降级原因；静默换库会让「无 life」被本机另一份真库掩盖）
#   2. ~/.config/socai/config.json 的 paths.life 或 life_dir
#   3. 候选：脚本在 SoCai 仓时的 <repo>/../life、
#      $HOME/www/life、/Volumes/dufa-mac/www/life、cwd/../life
#   BUG_MEMORY_LIMIT  检索 top-k（默认 5）
#
# 降级：life-kb 不存在 / CLI 起不来 / 无命中 → bug-memory.md 写显式「⚠️ 降级」
# 标 + 具体原因（路径、缺 tsx、CLI 错误摘要），不阻塞 socai 原流程。
set -euo pipefail

_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 脚本在 SoCai/.claude/skills/socai/_runtime 时 ROOT=SoCai 仓根；
# 若有人把文件复制到别处，ROOT 只作候选之一，不再是唯一路径。
ROOT="$(cd "$_here/../../../.." && pwd)"
LIMIT="${BUG_MEMORY_LIMIT:-5}"
LIFE_LAST_ERR=""

config_life_dir() {
  local cfg="$HOME/.config/socai/config.json"
  [[ -f "$cfg" ]] || return 0
  python3 -c "
import json, sys
c = json.load(open(sys.argv[1]))
print((c.get('paths') or {}).get('life') or c.get('life_dir') or '')
" "$cfg" 2>/dev/null || true
}

resolve_life_dir() {
  local candidates=()
  local from_cfg
  from_cfg="$(config_life_dir)"
  [[ -n "$from_cfg" ]] && candidates+=("$from_cfg")
  candidates+=("$ROOT/../life")
  candidates+=("$HOME/www/life")
  candidates+=("/Volumes/dufa-mac/www/life")
  candidates+=("$(pwd)/../life")

  local raw abs
  for raw in "${candidates[@]}"; do
    [[ -z "$raw" ]] && continue
    abs="$(cd "$raw" 2>/dev/null && pwd || true)"
    [[ -z "$abs" ]] && continue
    if [[ -f "$abs/src/cli/search.ts" ]]; then
      printf '%s' "$abs"
      return 0
    fi
  done
  return 1
}

sanitize_err() {
  # 诊断进 bug-memory.md / stderr，不得带出密钥
  sed -E 's/sk-[a-zA-Z0-9]+/sk-***/g; s/(API_KEY|AUTH_TOKEN|TOKEN|PASSWORD)=[^[:space:]]+/\1=***/g'
}

life_cli_ready() {
  local dir="${1:-}"
  [[ -n "$dir" && -f "$dir/src/cli/search.ts" ]] || return 1
  [[ -f "$dir/src/cli/search.mjs" ]] && return 0
  [[ -f "$dir/node_modules/tsx/package.json" ]] || return 1
  [[ -f "$dir/node_modules/better-sqlite3/package.json" ]] || return 1
  return 0
}

LIFE_DIR=""
LIFE_DB=""
LIFE_AVAILABLE=false
LIFE_VIA="none"
LIFE_UNAVAILABLE_REASON=""
FALLBACK_PY="$_here/life-fts-fallback.py"
if [[ -n "${MA_LIFE_DIR:-}" ]]; then
  _ma_abs="$(cd "$MA_LIFE_DIR" 2>/dev/null && pwd || true)"
  if [[ -n "$_ma_abs" && -f "$_ma_abs/src/cli/search.ts" ]]; then
    LIFE_DIR="$_ma_abs"
  else
    LIFE_UNAVAILABLE_REASON="MA_LIFE_DIR=$MA_LIFE_DIR 无 src/cli/search.ts（显式设置但未解析到 life-kb）"
  fi
elif LIFE_DIR="$(resolve_life_dir)"; then
  :
else
  LIFE_UNAVAILABLE_REASON="life-kb 未找到（设 MA_LIFE_DIR 或 ~/.config/socai/config.json paths.life）"
fi

if [[ -n "$LIFE_DIR" ]]; then
  LIFE_DB="$LIFE_DIR/data/life.db"
  if life_cli_ready "$LIFE_DIR"; then
    LIFE_AVAILABLE=true
    LIFE_VIA="node-cli"
  elif [[ -f "$LIFE_DB" && -f "$FALLBACK_PY" ]]; then
    LIFE_AVAILABLE=true
    LIFE_VIA="fts-fallback"
  else
    LIFE_UNAVAILABLE_REASON="life-kb 在 $LIFE_DIR 但缺 node_modules 且无 data/life.db（pnpm install 或确认库文件）"
  fi
fi

run_life_cli() {
  local rel="$1"
  shift
  local base="${rel%.ts}"
  local errf
  errf="$(mktemp)"
  if [[ -f "$LIFE_DIR/${base}.mjs" ]]; then
    if (cd "$LIFE_DIR" && node "${base}.mjs" "$@" 2>"$errf"); then
      rm -f "$errf"
      return 0
    fi
  else
    if (cd "$LIFE_DIR" && node --env-file=.env --import tsx "$rel" "$@" 2>"$errf"); then
      rm -f "$errf"
      return 0
    fi
  fi
  LIFE_LAST_ERR="$(tr '\n' ' ' < "$errf" | sanitize_err | head -c 240)"
  rm -f "$errf"
  return 1
}

run_life_fallback() {
  local rel="$1"
  shift
  local errf
  errf="$(mktemp)"
  if [[ "$rel" == *search.ts ]]; then
    local query="" catg="" limit="$LIMIT" fmt="text"
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --category=*) catg="${1#--category=}" ;;
        --limit=*) limit="${1#--limit=}" ;;
        --format=*) fmt="${1#--format=}" ;;
        --*) ;;
        *) query+="${query:+ }$1" ;;
      esac
      shift
    done
    if python3 "$FALLBACK_PY" search "$LIFE_DB" "$query" \
      ${catg:+--category="$catg"} --limit="$limit" --format="$fmt" 2>"$errf"; then
      rm -f "$errf"
      return 0
    fi
  elif [[ "$rel" == *ingest.ts ]]; then
    local catg="procedure" src="ai-inferred" file="-"
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --category=*) catg="${1#--category=}" ;;
        --source=*) src="${1#--source=}" ;;
        --*) ;;
        *) file="$1" ;;
      esac
      shift
    done
    if python3 "$FALLBACK_PY" ingest "$LIFE_DB" "$file" \
      --category="$catg" --source="$src" 2>"$errf"; then
      rm -f "$errf"
      return 0
    fi
  else
    echo "fts-fallback: unsupported $rel" >"$errf"
  fi
  LIFE_LAST_ERR="$(tr '\n' ' ' < "$errf" | sanitize_err | head -c 240)"
  rm -f "$errf"
  return 1
}

# 跑 life-kb CLI。node 缺依赖、或 CLI 因 embedding/Ollama fetch 挂掉时，
# 降到 FTS fallback——库在磁盘上就不能因为向量侧失败而整条记忆作废。
run_in_life() {
  if ! $LIFE_AVAILABLE; then return 1; fi
  if [[ "$LIFE_VIA" == "node-cli" ]]; then
    if run_life_cli "$@"; then return 0; fi
    if [[ -f "$LIFE_DB" && -f "$FALLBACK_PY" ]]; then
      run_life_fallback "$@"
      return $?
    fi
    return 1
  fi
  run_life_fallback "$@"
}

# 从 life-kb JSON hits 解析 YAML frontmatter → paradigm_class + trigger_keywords
# stdout: 每行 "paradigm_class|kw1 kw2 ..."（去重按 class）
parse_paradigm_classes() {
  node --input-type=module -e "
const hits = JSON.parse(process.argv[1] || '[]');
const seen = new Map();
for (const h of hits) {
  const c = h.content || '';
  const m = c.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n---/);
  if (!m) continue;
  const block = m[1];
  const cls = block.match(/^paradigm_class:\\s*(.+)$/m)?.[1]?.trim();
  if (!cls) continue;
  let kws = [];
  const arr = block.match(/^trigger_keywords:\\s*\\[(.*)\\]\\s*$/m);
  if (arr) {
    kws = arr[1].split(',').map(s => s.trim().replace(/^['\"]|['\"]$/g, '')).filter(Boolean);
  } else {
    const inline = block.match(/^trigger_keywords:\\s*(.+)$/m)?.[1]?.trim();
    if (inline) kws = inline.split(/[,\\s]+/).filter(Boolean);
  }
  if (!seen.has(cls)) seen.set(cls, kws);
}
for (const [cls, kws] of seen) console.log(cls + '|' + kws.join(' '));
" "$1"
}

# 范式保底：按 frontmatter paradigm_class 多类检索；无 frontmatter 时回退 control-paradigm 硬编码。
paradigm_fallback() {
  local scan_json=""
  scan_json="$(run_in_life src/cli/search.ts __paradigm_scan__ \
    --category=procedure --limit=20 --format=json 2>/dev/null || echo "[]")"

  local classes
  classes="$(parse_paradigm_classes "$scan_json")"

  if [[ -n "$classes" ]]; then
    while IFS='|' read -r pclass keywords; do
      [[ -z "$pclass" ]] && continue
      echo ""
      echo "## 范式保底检索（${pclass}，绕 CJK 分词缺陷）"
      if [[ -n "$keywords" ]]; then
        run_in_life src/cli/search.ts "$keywords" \
          --category=procedure --limit=1 --format=text 2>/dev/null \
          || echo "（${pclass} 无命中）"
      else
        echo "（${pclass} 无 trigger_keywords，跳过）"
      fi
    done <<< "$classes"
  else
    echo ""
    echo "## 范式保底检索（control-paradigm，绕 CJK 分词缺陷）"
    run_in_life src/cli/search.ts \
      "choice select radio option change lock paradigm quiz widget" \
      --category=procedure --limit=1 --format=text 2>/dev/null \
      || echo "（control-paradigm 无命中）"
  fi
}

print_doctor() {
  echo "LIFE_DIR=${LIFE_DIR:-<unresolved>}"
  echo "LIFE_AVAILABLE=$LIFE_AVAILABLE"
  echo "LIFE_VIA=$LIFE_VIA"
  if [[ -n "$LIFE_UNAVAILABLE_REASON" ]]; then
    echo "REASON=$LIFE_UNAVAILABLE_REASON"
  fi
  if [[ -n "$LIFE_DIR" ]]; then
    echo "search.ts=$([ -f "$LIFE_DIR/src/cli/search.ts" ] && echo yes || echo no)"
    echo "tsx=$([ -f "$LIFE_DIR/node_modules/tsx/package.json" ] && echo yes || echo no)"
    echo "better-sqlite3=$([ -f "$LIFE_DIR/node_modules/better-sqlite3/package.json" ] && echo yes || echo no)"
    echo "db=$([ -f "$LIFE_DIR/data/life.db" ] && echo yes || echo no)"
    echo "fallback_py=$([ -f "$FALLBACK_PY" ] && echo yes || echo no)"
  fi
  if $LIFE_AVAILABLE; then
    local probe
    if probe="$(run_in_life src/cli/search.ts "procedure control-paradigm" \
      --category=procedure --limit=1 --format=text)"; then
      echo "probe=ok"
      echo "$probe" | head -3
      return 0
    fi
    echo "probe=fail ${LIFE_LAST_ERR}"
    return 1
  fi
  return 1
}

case "${1:-}" in
  doctor)
    print_doctor
    ;;
  recall)
    slug="${2:?usage: recall <slug> <query...>}"
    shift 2
    query="$*"
    out=".socai/$slug/bug-memory.md"
    mkdir -p ".socai/$slug"

    degraded=false
    degrade_reason=""
    body=""

    if ! $LIFE_AVAILABLE; then
      degraded=true
      degrade_reason="${LIFE_UNAVAILABLE_REASON:-life-kb 不可用}"
    fi

    body+="## 历史教训（bug memory · life-kb 检索 top-$LIMIT · category=procedure）"$'\n'
    body+="若与本任务相关：① 遵守修复方向；② 在 smoke 复用「防回归断言」（如 \`mustNotExist .picked-bad\`）。"$'\n'
    if [[ -n "$LIFE_DIR" ]]; then
      body+=""$'\n'
      body+="_source: \`${LIFE_DIR}\` via ${LIFE_VIA}_"$'\n'
    fi
    body+=""$'\n'

    if [[ -z "$query" ]]; then
      body+="（无 query，跳过检索）"$'\n'
      degraded=true
      degrade_reason="${degrade_reason:-无 query}"
    elif ! $LIFE_AVAILABLE; then
      body+="（${degrade_reason}，跳过主检索）"$'\n'
    else
      main_out=""
      if main_out="$(run_in_life src/cli/search.ts "$query" \
        --category=procedure --limit="$LIMIT" --format=text)"; then
        body+="$main_out"$'\n'
        if [[ "$main_out" == *"(no hits)"* ]] || [[ -z "${main_out//[[:space:]]/}" ]]; then
          degraded=true
          degrade_reason="${degrade_reason:-life-kb 无命中}"
        fi
      else
        body+="（life CLI 失败：${LIFE_LAST_ERR:-unknown}）"$'\n'
        degraded=true
        degrade_reason="${degrade_reason:-life CLI 失败: ${LIFE_LAST_ERR:-unknown}}"
      fi
    fi

    skip_paradigm=false
    if ! $LIFE_AVAILABLE || [[ -z "$query" ]]; then
      skip_paradigm=true
    fi

    if $skip_paradigm; then
      body+="（降级：跳过范式保底检索）"$'\n'
    else
      body+="$(paradigm_fallback)"$'\n'
    fi

    if $degraded; then
      {
        echo "⚠️ bug-memory 降级:本任务无历史教训兜底(${degrade_reason})"
        echo ""
        printf '%s' "$body"
      } > "$out"
    else
      printf '%s' "$body" > "$out"
    fi

    echo "bug-memory: wrote $out" >&2
    ;;
  ingest)
    if ! $LIFE_AVAILABLE; then
      echo "bug-memory: ${LIFE_UNAVAILABLE_REASON:-life-kb 不存在}。设 MA_LIFE_DIR 或 paths.life。" >&2
      exit 1
    fi
    file="${2:?usage: ingest <bug-md-path>}"
    if [[ ! -f "$file" ]]; then echo "bug-memory: file not found: $file" >&2; exit 1; fi
    # node CLI 吃 stdin；失败后 fallback 必须用文件路径（stdin 可能已被读空）
    if [[ "${LIFE_VIA}" == "node-cli" ]]; then
      if run_life_cli src/cli/ingest.ts --category=procedure --source=ai-inferred - < "$file"; then
        exit 0
      fi
    fi
    if [[ -f "${LIFE_DB}" && -f "${FALLBACK_PY}" ]]; then
      python3 "${FALLBACK_PY}" ingest "${LIFE_DB}" "$file" --category=procedure --source=ai-inferred
      exit $?
    fi
    echo "bug-memory: ingest failed (${LIFE_LAST_ERR:-no fallback})" >&2
    exit 1
    ;;
  *)
    echo "usage: bug-memory.sh recall <slug> <query...> | ingest <bug-md-path> | doctor" >&2
    exit 2
    ;;
esac
