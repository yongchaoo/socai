#!/usr/bin/env bash
# Mechanical high-risk diff detection for socai orchestrator.
# Grep git diff content for keywords from high-risk-keywords.txt (project-local first).
#
# Usage: is-high-risk.sh <base> <head>
# Exit 0 = high risk (matches found, printed to stdout)
# Exit 1 = not high risk (no keyword match or empty diff)
set -euo pipefail

BASE="${1:?usage: is-high-risk.sh <base> <head>}"
HEAD="${2:?usage: is-high-risk.sh <base> <head>}"

_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Project-local keywords take priority (per-project append in .claude/skills/socai/_runtime/)
_keywords=""
if git rev-parse --show-toplevel >/dev/null 2>&1; then
  _root="$(git rev-parse --show-toplevel)"
  _local="$_root/.claude/skills/socai/_runtime/high-risk-keywords.txt"
  if [[ -f "$_local" ]]; then
    _keywords="$_local"
  fi
fi
if [[ -z "$_keywords" ]]; then
  _keywords="$_script_dir/high-risk-keywords.txt"
fi

if [[ ! -f "$_keywords" ]]; then
  echo "is-high-risk: keywords file not found: $_keywords" >&2
  exit 1
fi

# Build extended-regex alternation from non-comment, non-empty lines.
# Each line may already use | as alternation; every alternative is escaped, and
# pure-word alternatives (sse, sql, auth, ...) get portable ERE word boundaries so
# substrings like PASSED no longer false-positive. Patterns containing non-word
# chars (tauri::, foo+bar) stay literal substring matches.
escape_ere() {
  printf '%s' "$1" | sed -e 's/[][\\.*^$()+?{}|]/\\&/g'
}

wrap_keyword() {
  local _raw="$1"
  if printf '%s' "$_raw" | grep -qE '^[A-Za-z0-9_]+$'; then
    printf '(^|[^A-Za-z0-9_])(%s)([^A-Za-z0-9_]|$)' "$(escape_ere "$_raw")"
  else
    escape_ere "$_raw"
  fi
}

_pattern=""
while IFS= read -r _line || [[ -n "$_line" ]]; do
  _line="${_line%%#*}"
  _line="$(echo "$_line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  [[ -z "$_line" ]] && continue
  IFS='|' read -ra _parts <<< "$_line"
  for _part in "${_parts[@]}"; do
    _part="$(echo "$_part" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -z "$_part" ]] && continue
    _wrapped="$(wrap_keyword "$_part")"
    if [[ -n "$_pattern" ]]; then
      _pattern="${_pattern}|${_wrapped}"
    else
      _pattern="$_wrapped"
    fi
  done
done < "$_keywords"

if [[ -z "$_pattern" ]]; then
  echo "is-high-risk: empty keyword set in $_keywords" >&2
  exit 1
fi

_diff="$(git diff "$BASE..$HEAD" 2>/dev/null || true)"
if [[ -z "$_diff" ]]; then
  echo "is-high-risk: empty diff ($BASE..$HEAD)" >&2
  exit 1
fi

_matches="$(printf '%s\n' "$_diff" | grep -iE "$_pattern" || true)"
if [[ -n "$_matches" ]]; then
  printf '%s\n' "$_matches"
  exit 0
fi

exit 1
