#!/usr/bin/env bash
# check-artifact.sh <spec.md> — socai B05 收尾产物验收：量安装产物（.app/.dmg），不量 staging。
#
# 子 plan 独占行声明：acceptance.artifact: kind=app-size max=250M measure=du-app [path=<dir>]
# - 无该字段 → exit 0（跳过）
# - kind=app-size：在 path（默认 src-tauri/target/release/bundle，相对仓库根）找最新 .app，
#   找不到则找最新 .dmg mount 后量其中 .app；du -sm ≤ max 才 exit 0
# - 找不到 .app/.dmg → 非 0（fail-loud；禁止用 staging / --check 数字顶替）
# - kind=cmd → exit 0（测量即子 plan「## 验收点」已有命令，本脚本不重复跑）
# stdout 固定一行：ARTIFACT path=... size_mb=... max=...
set -euo pipefail

SPEC="${1:?usage: check-artifact.sh <spec.md>}"
[[ -f "$SPEC" ]] || { echo "check-artifact: spec not found: $SPEC" >&2; exit 2; }

# 只认正文独占行；``` 围栏代码块里的格式示例不算声明（避免 spec 自指找 .app）。
_line="$(awk '/^```/{f=!f; next} !f && /^acceptance\.artifact:/ {print; exit}' "$SPEC")"
[[ -z "$_line" ]] && exit 0

_kind="" _max="" _path=""
for _tok in ${_line#acceptance.artifact:}; do
  case "$_tok" in
    kind=*) _kind="${_tok#kind=}" ;;
    max=*) _max="${_tok#max=}" ;;
    path=*) _path="${_tok#path=}" ;;
  esac
done

case "$_kind" in
  cmd) echo "check-artifact: kind=cmd 由子 plan「## 验收点」命令测量，本脚本跳过" >&2; exit 0 ;;
  app-size) ;;
  *) echo "check-artifact: unsupported kind='$_kind' (want app-size|cmd)" >&2; exit 2 ;;
esac

_max_mb="${_max%[Mm]}"
[[ "$_max_mb" =~ ^[0-9]+$ ]] || { echo "check-artifact: bad max='$_max' (want e.g. max=250M)" >&2; exit 2; }

_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
_dir="${_path:-src-tauri/target/release/bundle}"
[[ "$_dir" = /* ]] || _dir="$_root/$_dir"

# BSD find 无 -maxdepth；.app 用 -prune 防止钻进包内。awk 'NR==1' 读全流，避免 head 早关管道触发 pipefail。
_newest_app() {
  [[ -d "$1" ]] || return 0
  find "$1" -type d -name '*.app' -prune -exec stat -f '%m %N' {} + 2>/dev/null | sort -rn | awk 'NR==1' | cut -d' ' -f2-
}
_newest_dmg() {
  [[ -d "$1" ]] || return 0
  find "$1" -type f -name '*.dmg' -exec stat -f '%m %N' {} + 2>/dev/null | sort -rn | awk 'NR==1' | cut -d' ' -f2-
}

_app="$(_newest_app "$_dir")"
_mount=""
if [[ -z "$_app" ]]; then
  _dmg="$(_newest_dmg "$_dir")"
  if [[ -n "$_dmg" ]]; then
    _mount="$(mktemp -d /tmp/check-artifact.XXXXXX)"
    trap 'hdiutil detach "$_mount" -quiet >/dev/null 2>&1 || true; rmdir "$_mount" 2>/dev/null || true' EXIT
    hdiutil attach "$_dmg" -nobrowse -readonly -mountpoint "$_mount" -quiet || { echo "check-artifact: hdiutil attach failed: $_dmg" >&2; exit 3; }
    _app="$(_newest_app "$_mount")"
  fi
fi

if [[ -z "$_app" ]]; then
  echo "check-artifact: no .app/.dmg under $_dir (fail-loud；禁止用 staging 顶替)" >&2
  exit 1
fi

_size_mb="$(du -sm "$_app" | awk '{print $1}')"
echo "ARTIFACT path=$_app size_mb=$_size_mb max=$_max_mb"
if [[ "$_size_mb" -le "$_max_mb" ]]; then
  exit 0
fi
echo "check-artifact: ${_size_mb}M > max ${_max_mb}M" >&2
exit 1
