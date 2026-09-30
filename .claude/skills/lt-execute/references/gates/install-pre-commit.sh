#!/usr/bin/env bash
# Install lt pre-commit hook into the current git repo (tool-agnostic).
#
# 在目标仓库根目录跑一次：bash <本 skill 路径>/references/gates/install-pre-commit.sh
# 装完后，任何走 git commit 的 AI / 人都自动过 lt gate。
# 卸载：rm .git/hooks/pre-commit（或恢复 .git/hooks/pre-commit.bak）
set -euo pipefail

GATES_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "✗ 当前目录不是 git 仓库" >&2
  exit 2
fi

GIT_DIR="$(git rev-parse --git-dir)"
HOOK="$GIT_DIR/hooks/pre-commit"

# 备份已有 hook
if [[ -f "$HOOK" ]] && ! grep -q "lt pre-commit" "$HOOK" 2>/dev/null; then
  echo "⚠ 已有 pre-commit hook，备份为 pre-commit.bak"
  mv "$HOOK" "$HOOK.bak"
fi

# 写一个极小 stub，exec 到 gates 目录里的 pre-commit.sh（绝对路径，更新自动生效）
cat > "$HOOK" <<STUB
#!/usr/bin/env bash
# lt pre-commit gate (installed from $GATES_DIR)
exec "$GATES_DIR/pre-commit.sh" "\$@"
STUB
chmod +x "$HOOK"

# .lt-current 指针文件加进 .gitignore（lt-execute commit 前写它，不应入库）
GITIGNORE="$(git rev-parse --show-toplevel)/.gitignore"
touch "$GITIGNORE"
if ! grep -qx '.lt-current' "$GITIGNORE" 2>/dev/null; then
  printf '\n.lt-current\n' >> "$GITIGNORE"
  echo "✓ 已把 .lt-current 加入 .gitignore"
fi

echo "✓ 已装 lt pre-commit hook → $HOOK"
echo "  任何 git commit 都会自动跑：invariant 守卫 / hack 计数 / contract 改动检查"
echo "  走 /lt-execute 流程时（写 .lt-current 指针）：额外跑 文件白名单 / 先行 test"
echo "  紧急绕过：git commit --no-verify"
