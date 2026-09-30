#!/bin/sh
# socai installer — runtime + host skills/agents。
# 用法：./install.sh [--host=cursor|trae|workbuddy|all] [--verify]
# 默认 --host=all。幂等、零硬依赖（npm 有则装 _runtime 的 jsdom）。
set -eu

REPO=$(cd -- "$(dirname -- "$0")" && pwd)
SOCAI_HOME="${SOCAI_HOME:-$HOME/.local/share/socai}"
BIN_DIR="${SOCAI_BIN_DIR:-$HOME/.local/bin}"
CFG_DIR="$HOME/.config/socai"
LEGACY_CFG_DIR="$HOME/.config/ma"
HOSTS="all"

SKILLS="socai lt-plan lt-execute lt-review"
AGENTS="socai-executor socai-reviewer"

usage() {
  cat <<EOF
用法: ./install.sh [--host=cursor|trae|workbuddy|all] [--verify] [--help]
  --host    装到哪个宿主（默认 all）
  --verify  校验已装路径，不改文件
EOF
}

place() {
  # place SRC DEST — 软链优先，失败则 copy
  src=$1
  dest=$2
  mkdir -p "$(dirname "$dest")"
  if [ -L "$dest" ]; then
    ln -sfn "$src" "$dest"
    printf "  %s -> %s\n" "$dest" "$src"
    return 0
  fi
  if [ -e "$dest" ]; then
    printf "  skip (exists, not symlink): %s\n" "$dest"
    return 0
  fi
  if ln -sfn "$src" "$dest" 2>/dev/null && [ -e "$dest" ]; then
    printf "  %s -> %s\n" "$dest" "$src"
    return 0
  fi
  rm -f "$dest"
  if [ -d "$src" ]; then
    cp -R "$src" "$dest"
  else
    cp "$src" "$dest"
  fi
  printf "  %s (copy) <- %s\n" "$dest" "$src"
}

place_file() {
  src=$1
  dest=$2
  mkdir -p "$(dirname "$dest")"
  if [ -L "$dest" ] || [ ! -e "$dest" ]; then
    ln -sfn "$src" "$dest" 2>/dev/null || { rm -f "$dest"; cp "$src" "$dest"; }
    printf "  %s -> %s\n" "$dest" "$src"
  else
    printf "  skip (exists, not symlink): %s\n" "$dest"
  fi
}

write_file() {
  dest=$1
  mkdir -p "$(dirname "$dest")"
  cat > "$dest"
  printf "  wrote %s\n" "$dest"
}

adapt_agent_workbuddy() {
  # stdout: agent md with tools: → allowed-tools: + context: fork
  src=$1
  awk '
    BEGIN { in_fm=0; done=0 }
    NR==1 && $0=="---" { in_fm=1; print; next }
    in_fm && $0=="---" {
      if (!seen_ctx) print "context: fork"
      print
      in_fm=0
      next
    }
    in_fm && /^tools:/ { sub(/^tools:/, "allowed-tools:") }
    in_fm && /^allowed-tools:/ { }
    in_fm && /^context:/ { seen_ctx=1 }
    { print }
  ' "$src"
}

install_runtime() {
  mkdir -p "$SOCAI_HOME" "$BIN_DIR"
  place "$REPO/.claude/skills/socai/_runtime" "$SOCAI_HOME/runtime"
  place "$REPO/.claude/skills/lt-execute/references/gates" "$SOCAI_HOME/gates"
  place "$REPO/.claude/agents" "$SOCAI_HOME/agents"
  place_file "$REPO/.claude/skills/lt-review/references/bug-signatures.md" "$SOCAI_HOME/refs/bug-signatures.md"
  place_file "$REPO/socai-call.mjs" "$BIN_DIR/socai-call"
  chmod +x "$REPO/socai-call.mjs" 2>/dev/null || true
  rm -f "$BIN_DIR/socai" "$BIN_DIR/ma"
  place_file "$REPO/socai-call.mjs" "$BIN_DIR/ma-call"

  if [ -f "$LEGACY_CFG_DIR/config.json" ] && [ ! -f "$CFG_DIR/config.json" ]; then
    mkdir -p "$CFG_DIR"
    cp "$LEGACY_CFG_DIR/config.json" "$CFG_DIR/config.json"
    chmod 600 "$CFG_DIR/config.json" 2>/dev/null || true
    printf "  migrated %s -> %s\n" "$LEGACY_CFG_DIR/config.json" "$CFG_DIR/config.json"
  fi

  if command -v npm >/dev/null 2>&1 && [ -f "$REPO/.claude/skills/socai/_runtime/package.json" ]; then
    (cd "$REPO/.claude/skills/socai/_runtime" && npm install --omit=dev --no-fund --no-audit >/dev/null 2>&1) \
      && echo "  npm install _runtime (jsdom)" \
      || echo "  ⚠ npm install _runtime 失败（DOM assert 可能缺 jsdom）"
  fi
}

install_skills_into() {
  dest_root=$1
  mkdir -p "$dest_root"
  for s in $SKILLS; do
    place "$REPO/.claude/skills/$s" "$dest_root/$s"
  done
}

install_agents_into() {
  dest_root=$1
  mkdir -p "$dest_root"
  for a in $AGENTS; do
    place_file "$REPO/.claude/agents/$a.md" "$dest_root/$a.md"
  done
}

install_workbuddy_agents() {
  dest_agents=$1
  dest_skills=$2
  mkdir -p "$dest_agents" "$dest_skills" "$SOCAI_HOME/hosts/workbuddy/agents"
  for a in $AGENTS; do
    gen="$SOCAI_HOME/hosts/workbuddy/agents/$a.md"
    adapt_agent_workbuddy "$REPO/.claude/agents/$a.md" > "$gen"
    place_file "$gen" "$dest_agents/$a.md"
    mkdir -p "$dest_skills/$a"
    write_file "$dest_skills/$a/SKILL.md" < "$gen"
  done
}

install_cursor() {
  echo "--- cursor ---"
  install_skills_into "$HOME/.agents/skills"
  install_skills_into "$HOME/.claude/skills"
  install_agents_into "$HOME/.claude/agents"
  install_agents_into "$HOME/.cursor/agents"
}

install_trae() {
  echo "--- trae ---"
  install_skills_into "$HOME/.trae/skills"
  install_agents_into "$HOME/.trae/agents"
}

install_workbuddy() {
  echo "--- workbuddy ---"
  install_skills_into "$HOME/.workbuddy/skills"
  install_workbuddy_agents "$HOME/.workbuddy/agents" "$HOME/.workbuddy/skills"
  if [ -d "$HOME/.codebuddy" ]; then
    echo "--- codebuddy (legacy sibling) ---"
    install_skills_into "$HOME/.codebuddy/skills"
    install_workbuddy_agents "$HOME/.codebuddy/agents" "$HOME/.codebuddy/skills"
  fi
}

check() {
  if [ -e "$2" ]; then
    printf "  ✓ %s\n" "$1"
    return 0
  fi
  printf "  ✗ %s（缺: %s）\n" "$1" "$2"
  return 1
}

verify_runtime() {
  rc=0
  command -v socai-call >/dev/null 2>&1 && echo "  ✓ socai-call 在 PATH" || { echo "  ✗ socai-call 不在 PATH（装到 $BIN_DIR）"; rc=1; }
  check "runtime bug-memory" "$SOCAI_HOME/runtime/bug-memory.sh" || rc=1
  check "runtime run-log" "$SOCAI_HOME/runtime/run-log.sh" || rc=1
  check "gates check-test-gate" "$SOCAI_HOME/gates/check-test-gate.sh" || rc=1
  check "agents socai-executor" "$SOCAI_HOME/agents/socai-executor.md" || rc=1
  if [ -f "$SOCAI_HOME/runtime/package.json" ]; then
    if node --input-type=module -e "import 'jsdom'" >/dev/null 2>&1 \
      || node --input-type=module -e "import 'jsdom'" --cwd "$SOCAI_HOME/runtime" >/dev/null 2>&1 \
      || [ -d "$REPO/.claude/skills/socai/_runtime/node_modules/jsdom" ]; then
      echo "  ✓ jsdom"
    else
      echo "  ⚠ jsdom 未装（cd .claude/skills/socai/_runtime && npm install）"
    fi
  fi
  if [ -x "$SOCAI_HOME/runtime/bug-memory.sh" ]; then
    if bash "$SOCAI_HOME/runtime/bug-memory.sh" doctor >/dev/null; then
      echo "  ✓ bug-memory / life-kb"
    else
      echo "  ⚠ bug-memory 不可用（设 MA_LIFE_DIR 或 ~/.config/socai/config.json paths.life）"
    fi
  fi
  if [ -n "${SOCAI_DEEPSEEK_KEY:-${MA_DEEPSEEK_KEY:-}}" ]; then
    echo "  ✓ SOCAI_DEEPSEEK_KEY/MA_DEEPSEEK_KEY 在 env"
  else
    echo "  ⚠ deepseek key 未在 env（外部 executor 才需要）"
  fi
  return $rc
}

verify_host() {
  host=$1
  rc=0
  case "$host" in
    cursor)
      check "cursor skill socai" "$HOME/.agents/skills/socai/SKILL.md" || rc=1
      check "cursor agent executor" "$HOME/.claude/agents/socai-executor.md" || rc=1
      ;;
    trae)
      check "trae skill socai" "$HOME/.trae/skills/socai/SKILL.md" || rc=1
      check "trae agent executor" "$HOME/.trae/agents/socai-executor.md" || rc=1
      ;;
    workbuddy)
      check "workbuddy skill socai" "$HOME/.workbuddy/skills/socai/SKILL.md" || rc=1
      check "workbuddy agent executor" "$HOME/.workbuddy/agents/socai-executor.md" || rc=1
      ;;
  esac
  return $rc
}

do_verify() {
  echo "=== socai 安装校验 ==="
  rc=0
  verify_runtime || rc=1
  installed=""
  if [ -f "$SOCAI_HOME/installed-hosts" ]; then
    installed=$(cat "$SOCAI_HOME/installed-hosts")
  fi
  if [ -z "$installed" ] || [ "$installed" = "all" ]; then
    installed="cursor trae workbuddy"
  fi
  for h in $installed; do
    verify_host "$h" || rc=1
  done
  exit $rc
}

# --- args ---
VERIFY=0
for arg in "$@"; do
  case "$arg" in
    --verify) VERIFY=1 ;;
    --host=*) HOSTS=${arg#--host=} ;;
    --help|-h) usage; exit 0 ;;
    *) echo "未知参数: $arg" >&2; usage; exit 2 ;;
  esac
done

case "$HOSTS" in
  cursor|trae|workbuddy|all) ;;
  *) echo "未知 --host=$HOSTS（cursor|trae|workbuddy|all）" >&2; exit 2 ;;
esac

if [ "$VERIFY" = 1 ]; then
  do_verify
fi

echo "=== 安装 socai（source: $REPO  host=$HOSTS）==="
echo "--- runtime ---"
install_runtime

if [ "$HOSTS" = "all" ]; then
  install_cursor
  install_trae
  install_workbuddy
else
  install_"$HOSTS"
fi

printf '%s\n' "$HOSTS" > "$SOCAI_HOME/installed-hosts"

cat <<EOF

=== 下一步 ===
1. 确保 $BIN_DIR 在 PATH（试：socai-call → 打印用法）
2. 开一个新会话（agent 类型只在启动时加载）
3. 在目标项目敲 /socai <目标>
4. 校验：$REPO/install.sh --verify
5. 可选：echo 'export SOCAI_DEEPSEEK_KEY=sk-...' >> ~/.zshenv

限制：跨模型 review 取决于宿主能否换 reviewer 模型；换不了则只剩机械 gate。
EOF
