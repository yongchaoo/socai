#!/usr/bin/env bash
# Gate: 改 packages/shared/contracts/ 必须伴随 contract test 绿
#
# Usage: check-contract-change.sh
#
# 检测暂存区是否有 packages/shared/contracts/ 的改动。
# 有 → 跑 pnpm test:contract（若该 script 存在）；无该 script → warn。
# 无 contracts 改动 → 直接通过。
#
# 原因：contract 改动影响多个消费端，单测全绿不代表跨端兼容，必须跑契约测试。
set -euo pipefail

verify_lt_diff_base() {
  if [[ -n "${LT_DIFF_BASE:-}" ]]; then
    if ! git rev-parse --verify "${LT_DIFF_BASE}^{commit}" >/dev/null 2>&1; then
      echo "✗ LT_DIFF_BASE 无效: ${LT_DIFF_BASE}" >&2
      exit 1
    fi
  fi
}

verify_lt_diff_base

# 共享契约/接口目录；可用 CONTRACT_DIR 覆盖。
contract_dir="${CONTRACT_DIR:-packages/shared/contracts}"

# 暂存优先，否则工作区；LT_DIFF_BASE 设了则用 range diff（socai commit 后跑 gate）
if [[ -n "${LT_DIFF_BASE:-}" ]]; then
  changed=$(git diff "${LT_DIFF_BASE}"..HEAD --name-only)
else
  changed=$(git diff --cached --name-only 2>/dev/null)
  [[ -z "$changed" ]] && changed=$(git diff --name-only 2>/dev/null)
fi

if [[ -z "$changed" ]]; then
  echo "✓ contract gate 通过（无改动）"
  exit 0
fi

# 是否有 contracts 改动
contract_changed=0
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if [[ "$f" == "$contract_dir"/* ]]; then contract_changed=1; break; fi
done <<< "$changed"

if (( contract_changed == 0 )); then
  echo "✓ contract gate 通过（未触及 ${contract_dir}）"
  exit 0
fi

echo "⚠ 检测到 $contract_dir 改动，必须跑契约测试"

# 探测 contract test script 是否存在
if ! grep -q '"test:contract"' package.json 2>/dev/null; then
  echo "✗ package.json 无 test:contract script，但改动了 contracts——无法验证跨端兼容"
  echo "   加一个 test:contract script，或回 /lt-plan 把 contract 改动标为高风险并人工验证三端。"
  exit 1
fi

echo "→ pnpm test:contract"
if ! pnpm test:contract; then
  echo "✗ contract gate 失败：契约测试未全绿"
  echo "   contract 改动影响多个消费端，单测绿不代表跨端兼容。"
  exit 1
fi

echo "✓ contract gate 通过（contracts 改动 + 契约测试全绿）"
