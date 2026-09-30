#!/bin/sh
# 真跑一小批：dsh 当 socai-call exec 写手，看能不能走完 test-first + commit。
# 用法（在 SoCai-wt-dsh 根）：bash scripts/dsh-batch-probe.sh
set -e
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SANDBOX="${SOCAI_DSH_PROBE_DIR:-$(mktemp -d /tmp/socai-dsh-probe-XXXXXX)}"
export SOCAI_CONFIG_HOME="$SANDBOX/cfg"
export SOCAI_EXECUTOR_BACKEND=dsh
export MA_EXECUTOR_BACKEND=dsh
export SOCAI_DSH_EXTRA_PATCH="$ROOT/.claude/skills/socai/_runtime/dsh-pin-official.yml"
mkdir -p "$SOCAI_CONFIG_HOME"
printf '%s\n' '{"roles":{"executor":{"backend":"dsh"}}}' > "$SOCAI_CONFIG_HOME/config.json"

git -C "$SANDBOX" init -q
git -C "$SANDBOX" checkout -q -b socai/dsh-probe
git -C "$SANDBOX" -c user.email=probe@socai -c user.name=probe commit --allow-empty -q -m "probe base"

cat > "$SANDBOX/add.mjs" <<'EOF'
export function add() {
  throw new Error('not implemented');
}
EOF
cat > "$SANDBOX/add.test.mjs" <<'EOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import { add } from './add.mjs';

test('add(2, 3) === 5', () => {
  assert.equal(add(2, 3), 5);
});
EOF
git -C "$SANDBOX" add add.mjs add.test.mjs
git -C "$SANDBOX" -c user.email=probe@socai -c user.name=probe commit -q -m "probe: red add()"

{
  cat "$ROOT/.claude/agents/socai-executor.md"
  printf '\n\n'
  cat <<'SPEC'
# Batch 1 — add(a, b)

risk: low

## Spec
- 实现 `add.mjs` 的 `add(a, b)`：返回两数之和。
- 白名单：`add.mjs`（测试已在，不要改测试文件名）。
- test-first：验收 `node --test add.test.mjs` 必须先红后绿（实现前会 fail）。
- 一批一 commit，message 用 `feat(add): implement add(a, b)`，禁止 push/switch。
- 完成后回 ≤6 行摘要（实现了什么 / 测试 N pass / commit hash）。

<restate>
- 分支 socai/dsh-probe，一批一 commit
- 白名单：add.mjs
- test-first；验收 node --test add.test.mjs
</restate>
SPEC
} > "$SANDBOX/batch.prompt.md"

echo "sandbox=$SANDBOX"
echo "running socai-call exec via dsh …"
set +e
node "$ROOT/socai-call.mjs" exec "$SANDBOX/batch.prompt.md" --timeout=900
CODE=$?
set -e
echo "socai-call exit=$CODE"
echo "--- git log ---"
git -C "$SANDBOX" log --oneline
echo "--- test ---"
set +e
node --test "$SANDBOX/add.test.mjs"
TEST=$?
set -e
echo "test exit=$TEST"
if [ "$CODE" -eq 0 ] && [ "$TEST" -eq 0 ]; then
  echo "VERDICT=PASS dsh 走完一批（exec 0 + 测试绿）"
  exit 0
fi
echo "VERDICT=FAIL exec=$CODE test=$TEST"
exit 1
