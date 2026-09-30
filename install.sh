#!/bin/sh
# socai installer — skill + agents + socai-call 全局 symlink。
# 用法：./install.sh [--verify]。幂等、零依赖。
set -eu

REPO=$(cd -- "$(dirname -- "$0")" && pwd)
SKILLS_DIR="$HOME/.claude/skills"
AGENTS_DIR="$HOME/.claude/agents"
BIN_DIR="$HOME/.local/bin"
CFG_DIR="$HOME/.config/socai"
LEGACY_CFG_DIR="$HOME/.config/ma"

link() {
  mkdir -p "$(dirname "$2")"
  ln -sfn "$1" "$2"
  printf "  %s -> %s\n" "$2" "$1"
}

check() {
  if [ -e "$2" ]; then printf "  ✓ %s\n" "$1"; else printf "  ✗ %s(缺: %s)\n" "$1" "$2"; return 1; fi
}

if [ "${1:-}" = "--verify" ]; then
  echo "=== socai 安装校验 ==="
  rc=0
  command -v socai-call >/dev/null 2>&1 && echo "  ✓ socai-call 在 PATH" || { echo "  ✗ socai-call 不在 PATH(装到 $BIN_DIR)"; rc=1; }
  check "skill socai" "$SKILLS_DIR/socai/SKILL.md" || rc=1
  check "skill lt-plan" "$SKILLS_DIR/lt-plan/SKILL.md" || rc=1
  check "skill lt-execute" "$SKILLS_DIR/lt-execute/SKILL.md" || rc=1
  check "skill lt-review" "$SKILLS_DIR/lt-review/SKILL.md" || rc=1
  check "agent socai-executor" "$AGENTS_DIR/socai-executor.md" || rc=1
  check "agent socai-reviewer" "$AGENTS_DIR/socai-reviewer.md" || rc=1
  if [ -x "$SKILLS_DIR/socai/_runtime/bug-memory.sh" ]; then
    if bash "$SKILLS_DIR/socai/_runtime/bug-memory.sh" doctor >/dev/null; then
      echo "  ✓ bug-memory / life-kb"
    else
      echo "  ⚠ bug-memory 不可用（跑: bash $SKILLS_DIR/socai/_runtime/bug-memory.sh doctor）"
    fi
  fi
  if [ -n "${SOCAI_DEEPSEEK_KEY:-${MA_DEEPSEEK_KEY:-}}" ]; then echo "  ✓ SOCAI_DEEPSEEK_KEY/MA_DEEPSEEK_KEY 在 env"
  else echo "  ⚠ deepseek key 未在 env（export SOCAI_DEEPSEEK_KEY=sk-...）"; fi
  for old in "$SKILLS_DIR/ma" "$SKILLS_DIR/ma-v3" "$AGENTS_DIR/ma-executor.md" "$AGENTS_DIR/ma-reviewer.md" "$BIN_DIR/socai" "$BIN_DIR/ma"; do
    if [ -e "$old" ] || [ -L "$old" ]; then
      echo "  ⚠ 残留旧路径 $old（可 rm；v1 CLI / v2 /ma 已删除）"
    fi
  done
  exit $rc
fi

echo "=== 安装 socai(source: $REPO)==="
chmod +x "$REPO/socai-call.mjs" 2>/dev/null || true

if [ -f "$LEGACY_CFG_DIR/config.json" ] && [ ! -f "$CFG_DIR/config.json" ]; then
  mkdir -p "$CFG_DIR"
  cp "$LEGACY_CFG_DIR/config.json" "$CFG_DIR/config.json"
  chmod 600 "$CFG_DIR/config.json" 2>/dev/null || true
  printf "  migrated %s -> %s\n" "$LEGACY_CFG_DIR/config.json" "$CFG_DIR/config.json"
fi

link "$REPO/socai-call.mjs" "$BIN_DIR/socai-call"
# 旧 CLI 名：不再提供 v1 自治 CLI；清掉指向已删 socai.mjs 的软链
rm -f "$BIN_DIR/socai" "$BIN_DIR/ma"
# 兼容：ma-call → socai-call
link "$REPO/socai-call.mjs" "$BIN_DIR/ma-call"

rm -f "$SKILLS_DIR/ma-v3" "$SKILLS_DIR/ma"
rm -f "$AGENTS_DIR/ma-executor.md" "$AGENTS_DIR/ma-reviewer.md"

for s in socai lt-plan lt-execute lt-review; do
  link "$REPO/.claude/skills/$s" "$SKILLS_DIR/$s"
done
link "$REPO/.claude/agents/socai-executor.md" "$AGENTS_DIR/socai-executor.md"
link "$REPO/.claude/agents/socai-reviewer.md" "$AGENTS_DIR/socai-reviewer.md"

cat <<EOF

=== 下一步 ===
1. 确保 $BIN_DIR 在 PATH（试：socai-call → 打印用法）
2. 可选：echo 'export SOCAI_DEEPSEEK_KEY=sk-...' >> ~/.zshenv
3. 开新窗口，敲 /socai <目标>
4. 校验：$REPO/install.sh --verify
EOF
