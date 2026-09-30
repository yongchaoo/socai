#!/usr/bin/env bash
# Tool-agnostic pre-commit runner: runs lt gates on every git commit.
#
# 任何 AI（Cursor / Codex / Claude Code / 人）只要走 git commit，都会触发这个 hook。
# 不依赖任何 IDE 特定机制。
#
# 安装：./install-pre-commit.sh（在目标仓库根目录跑一次）
# 绕过：git commit --no-verify（紧急情况，review 报告 vs diff 互审会兜底）
#
# 行为：
# - 始终跑：invariant 守卫（静态跨层检查）+ hack 计数（无 spec 指针时 warn-only）+ contract 改动检查
# - 有 .lt-current 指针时（lt-execute commit 前写）：额外跑 文件白名单 + 先行 test
# - .lt-current 格式（KEY=VALUE，每行一条）：
#     SPEC=plans/<phase>/NN-<topic>.spec.md
#     MASTER=plans/<phase>/00-master.md
#     TEST_CMD=pnpm exec vitest run <test 文件>
#
# NOTE（bash 3.2 可移植性）：echo 里 $var 一律用 ${var} 大括号——macOS bash 3.2
# + `set -u` 会把紧跟多字节字符（全角（）／，等）的裸 $var 误当未定义变量而崩溃。
# 详见 check-hack-count.sh 头注释；勿"简化"回裸 $var。
set -euo pipefail

GATES_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$(git rev-parse --show-toplevel)"

failed=0
spec=""
master=""
test_cmd=""
pointer=".lt-current"

if [[ -f "$pointer" ]]; then
  while IFS='=' read -r k v; do
    case "$k" in
      SPEC)     spec="$v" ;;
      MASTER)   master="$v" ;;
      TEST_CMD) test_cmd="$v" ;;
    esac
  done < "$pointer"
fi

echo "▶ lt pre-commit gate"

# 1. invariant 守卫（始终跑；master 可选——无 master 时只跑内置静态检查）
if [[ -n "$master" && -f "$master" ]]; then
  "$GATES_DIR/check-invariant.sh" "$master" || failed=1
else
  "$GATES_DIR/check-invariant.sh" || failed=1
fi

# 2. hack 计数（始终跑；无 spec 指针时 warn-only，因为没法验债登记）
if [[ -n "$spec" && -f "$spec" ]]; then
  "$GATES_DIR/check-hack-count.sh" "$spec" || failed=1
else
  pattern='TODO|FIXME|@ts-ignore|@ts-expect-error|hack|XXX'
  before=$( { git grep -hE "$pattern" HEAD 2>/dev/null || true; } | wc -l | tr -d ' ')
  before=${before:-0}
  after=$( { rg --no-filename "$pattern" 2>/dev/null || true; } | wc -l | tr -d ' ')
  after=${after:-0}
  delta=$(( after - before ))
  if (( delta > 0 )); then
    echo "⚠ hack 标记新增 ${delta} 处（before=${before} after=${after}）——无 spec 指针，无法验债登记，warn-only"
    echo "  走 /lt-execute 流程时 .lt-current 指针会让此 gate 变硬（未登记 arch-debt 则拒）"
  fi
fi

# 3. 文件白名单（仅 spec 指针存在时——普通 commit 不卡白名单）
if [[ -n "$spec" && -f "$spec" ]]; then
  "$GATES_DIR/check-file-whitelist.sh" "$spec" || failed=1
fi

# 4. 先行 test（spec + test_cmd 都有才跑）
if [[ -n "$spec" && -f "$spec" && -n "$test_cmd" ]]; then
  "$GATES_DIR/check-test-gate.sh" "$test_cmd" || failed=1
fi

# 5. contract 改动 → 必须跑 contract test（始终检查 diff，不依赖指针）
"$GATES_DIR/check-contract-change.sh" || failed=1

# 6. spec 同步（仅 spec 指针存在时——验子 plan `## Spec 同步` 声明 vs diff 一致）
if [[ -n "$spec" && -f "$spec" ]]; then
  "$GATES_DIR/check-spec-sync.sh" "$spec" || failed=1
fi

if (( failed == 1 )); then
  echo ""
  echo "✗ lt pre-commit gate 失败。"
  echo "  修到绿再 commit，或回 /lt-plan 修订 spec/invariant。"
  echo "  紧急绕过：git commit --no-verify（review 报告 vs diff 互审会兜底，勿常用）"
  exit 1
fi

echo "✓ lt pre-commit gate 通过"
