#!/usr/bin/env bash
# Gate: 运行时验证 — 行为类缺 RUNTIME_VERIFY / 弱命令 / DOM 断言失败 → 硬 fail
#
# Usage:
#   PROJECT_TYPE=library RUNTIME_VERIFY='node --test socai.test.mjs' bash check-runtime.sh
#
# 环境变量：
#   PROJECT_TYPE       library|backend|cli|frontend|integrated-app|single-file-frontend|unknown
#   RUNTIME_VERIFY     要 eval 的验证命令（必填，行为类 / library）
#   AUTO_MODE          1 → unknown 硬 fail
#   MA_RUNTIME_STRICT  1 → unknown 硬 fail
#   DOM_ASSERT_HTML / DOM_ASSERT_SELECTORS  可选 DOM 断言（single-file-frontend / frontend）
set -euo pipefail

PROJECT_TYPE="${PROJECT_TYPE:-unknown}"
RUNTIME_VERIFY="${RUNTIME_VERIFY:-}"
AUTO_MODE="${AUTO_MODE:-}"
MA_RUNTIME_STRICT="${MA_RUNTIME_STRICT:-}"

BEHAVIORAL_TYPES='frontend|single-file-frontend|cli|backend|integrated-app'

fail_structured() {
  local code="$1"
  local location="$2"
  local expected="$3"
  local actual="$4"
  local command="${5:-}"
  local stdout_tail="${6:-}"
  echo "✗ runtime gate 失败" >&2
  echo "CODE=${code}" >&2
  echo "LOCATION=${location}" >&2
  echo "EXPECTED=${expected}" >&2
  echo "ACTUAL=${actual}" >&2
  echo "COMMAND=${command}" >&2
  echo "STDOUT_TAIL=${stdout_tail}" >&2
  exit 1
}

is_weak_verify() {
  local cmd="$1"
  local trimmed
  trimmed=$(echo "$cmd" | sed -E 's/^[[:space:]]+//;s/[[:space:]]+$//')
  if [[ -z "$trimmed" ]]; then
    return 0
  fi
  # 纯 grep/rg
  if echo "$trimmed" | grep -qE '^(grep|rg)[[:space:]]'; then
    return 0
  fi
  # new Function 伪跑
  if echo "$trimmed" | grep -qE 'new[[:space:]]+Function'; then
    return 0
  fi
  # 仅 node --check
  if echo "$trimmed" | grep -qE '^node[[:space:]]+--check[[:space:]]'; then
    return 0
  fi
  # 纯 --help（无其它真跑片段）；用 \-\-help 避免 macOS grep 把 --help 当自身 flag
  if echo "$trimmed" | grep -qE '\-\-help' && ! echo "$trimmed" | grep -qE '(node --test|npm test|pnpm|vitest|bash|python|pytest|curl|playwright|run-dom-assert|run-smoke|node -e|node \.)'; then
    return 0
  fi
  return 1
}

# 交互型前端：仅 run-dom-assert、无 run-smoke → 静态偷懒（fixture 可 ALLOW_STATIC_DOM=1）
is_static_only_frontend() {
  local cmd="$1"
  if [[ ! "$PROJECT_TYPE" =~ ^(frontend|single-file-frontend)$ ]]; then
    return 1
  fi
  if [[ "${ALLOW_STATIC_DOM:-}" == "1" ]]; then
    return 1
  fi
  if echo "$cmd" | grep -qE 'run-smoke'; then
    return 1
  fi
  if echo "$cmd" | grep -qE 'run-dom-assert'; then
    return 0
  fi
  return 1
}

# unknown 类型
if [[ "$PROJECT_TYPE" == "unknown" ]]; then
  if [[ -z "$RUNTIME_VERIFY" ]]; then
    if [[ "$AUTO_MODE" == "1" || "$MA_RUNTIME_STRICT" == "1" ]]; then
      fail_structured "UNKNOWN_NEEDS_HUMAN" "check-runtime.sh:PROJECT_TYPE" \
        "attended 人工判定类型并设置 RUNTIME_VERIFY" "PROJECT_TYPE=unknown 且无 RUNTIME_VERIFY" "" ""
    fi
    echo "⚠ runtime gate：PROJECT_TYPE=unknown 且无 RUNTIME_VERIFY，warn-only 通过（attended 模式）"
    echo "✓ runtime gate 通过"
    exit 0
  fi
fi

# 行为类 + library 缺 VERIFY
if [[ -z "$RUNTIME_VERIFY" ]]; then
  if [[ "$PROJECT_TYPE" =~ ^($BEHAVIORAL_TYPES)$ ]] || [[ "$PROJECT_TYPE" == "library" ]]; then
    fail_structured "MISSING_RUNTIME_VERIFY" "check-runtime.sh:RUNTIME_VERIFY" \
      "非空 RUNTIME_VERIFY 命令" "RUNTIME_VERIFY 未设置（PROJECT_TYPE=${PROJECT_TYPE}）" "" ""
  fi
  echo "✓ runtime gate 通过（无 RUNTIME_VERIFY，跳过）"
  exit 0
fi

# 弱命令检测
if is_weak_verify "$RUNTIME_VERIFY"; then
  fail_structured "WEAK_VERIFY" "check-runtime.sh:RUNTIME_VERIFY" \
    "真跑命令（test / DOM assert / 脚本执行）" "弱命令：${RUNTIME_VERIFY}" "$RUNTIME_VERIFY" ""
fi

# 交互型前端禁止「只有静态 DOM assert」
if is_static_only_frontend "$RUNTIME_VERIFY"; then
  fail_structured "STATIC_ONLY" "check-runtime.sh:RUNTIME_VERIFY" \
    "含 run-smoke（click/eval 交互步骤）；fixture 可设 ALLOW_STATIC_DOM=1" \
    "仅 run-dom-assert、无交互 smoke：${RUNTIME_VERIFY}" "$RUNTIME_VERIFY" ""
fi

echo "→ 跑 runtime verify：$RUNTIME_VERIFY"

# 可选 DOM 断言（env 或命令内含 run-dom-assert）
if [[ -n "${DOM_ASSERT_HTML:-}" && -n "${DOM_ASSERT_SELECTORS:-}" ]]; then
  if ! node "${DOM_ASSERT_SCRIPT:-.claude/skills/socai/_runtime/run-dom-assert.mjs}" \
      "$DOM_ASSERT_HTML" "$DOM_ASSERT_SELECTORS"; then
    dom_out=$(node "${DOM_ASSERT_SCRIPT:-.claude/skills/socai/_runtime/run-dom-assert.mjs}" \
      "$DOM_ASSERT_HTML" "$DOM_ASSERT_SELECTORS" 2>&1 | tail -20 || true)
    fail_structured "DOM_ASSERT_FAIL" "run-dom-assert.mjs" \
      "DOM selectors 全部满足" "DOM 断言失败" \
      "node run-dom-assert.mjs $DOM_ASSERT_HTML $DOM_ASSERT_SELECTORS" "$dom_out"
  fi
fi

# 执行 RUNTIME_VERIFY
set +e
verify_out=$(eval "$RUNTIME_VERIFY" 2>&1)
verify_status=$?
set -e

if [[ $verify_status -ne 0 ]]; then
  stdout_tail=$(echo "$verify_out" | tail -20)
  fail_structured "RUNTIME_VERIFY_FAIL" "eval RUNTIME_VERIFY" \
    "exit 0" "exit ${verify_status}" "$RUNTIME_VERIFY" "$stdout_tail"
fi

echo "✓ runtime gate 通过"
