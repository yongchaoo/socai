#!/usr/bin/env bash
# SoCai 合同门：读子 plan 的 contract:，在目标仓抽 token 比全等。
# Usage: check-source-contract.sh <子plan.md> <目标仓根>
# Exit 0 = 全等或跳过；非 0 = 拒。
set -euo pipefail
_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$_script_dir/check-source-contract.mjs" "$@"
