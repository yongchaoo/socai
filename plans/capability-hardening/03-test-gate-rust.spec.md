# Batch 03 — FAIL_TO_PASS 认 Rust 模块

risk: low
tags: socai,gates,rust

## Spec（行为契约）

- 输入：`check-test-gate.sh "<cmd>"`，`cmd` 常为 `cargo test --manifest-path desktop/Cargo.toml`；diff 含新 `*.rs` 模块。
- 输出：不再把「revert 后旧测仍绿」误报成「假先行」；`cd <dir> && cargo test` 被拒绝或改写。
- 失败模式：JS 假先行（`expect(true)`）仍须红。

### desktop-slim 现场

revert `main.rs` 后 `mod power` / 新测所在文件变成孤儿，`cargo test` 跑旧的 17/22 条仍 exit 0，gate 报 `WEAK_VERIFY`。编排者靠数测试条数和 reviewer 判真。

### 行为

1. **禁止 cd 进 crate**：`cmd` 匹配 `cd[[:space:]]+\S+[[:space:]]*&&[[:space:]]*cargo test` → 非 0，提示改用 `cargo test --manifest-path <crate>/Cargo.toml`。现有 fixture 若用 cd，一并改。
2. **Rust 孤儿检测**（`cmd` 含 `cargo test` 且 diff 含 `*.rs`）：
   - revert **前** 记 `cargo test -- --list`（或等价）的测试名集合 `HEAD_TESTS`
   - revert impl 后跑原 `cmd`
   - 若 exit 0 **且** `HEAD_TESTS` 比 revert 后能列出的测试多（新测消失）→ **不得**打印「假先行 / WEAK_VERIFY」
   - **必须方案 A**（禁止 orphan-skip 当通过）：对每个仅存在于 HEAD 的测试名跑 `cargo test <name> -- --exact`，要求非 0。若因未编译匹配 0 条且 exit 0 → 保留新 `.rs`、只 revert `mod` 声明，或删除新 `.rs` 后要求 compile-fail / 过滤失败。**新测必须被观察到没过**，FAIL_TO_PASS 才算过。
   - 本机无 rustc：本批 Test 标 N/A 并在报告写明，**不得**用「检出 orphan 后 exit 0」代替 A。不占总纲债预算。
3. JS/ts 的 FAIL_TO_PASS 行为不变（`test-fixtures/fail-to-pass-gate.test.mjs` 仍绿）。

## Invariants

- FAIL_TO_PASS：Rust 新模块 orphan 时新测必须被观察到没过；不得报假先行，也不得 skip 当通过。
- 不得把 `cd <crate> && cargo test` 当默认/推荐验收命令。

## Test（先行）

- 扩展 `test-fixtures/fail-to-pass-gate.test.mjs` 或新建 `test-fixtures/fail-to-pass-rust.test.mjs`
  - fixture：`main.rs` + 新 `power.rs`（`#[cfg(test)]` 里真断言）+ `Cargo.toml` 最小 crate
  - 当前 gate + `cd crate && cargo test`：应表现为「假先行」或路径错（红，确认在测目标）
  - 改完：`--manifest-path` + 新逻辑 → 不报假先行；JS fake-green fixture 仍拒
- 一条：`cmd='cd desktop && cargo test'` → gate 非 0

## 验收点

- `node --test test-fixtures/fail-to-pass-gate.test.mjs test-fixtures/fail-to-pass-rust.test.mjs` 绿
- `rg -n "cd .+ && cargo test" .claude/skills/socai/SKILL.md` 的全局验收命令改为 `--manifest-path`（若 SKILL 仍写 `cd desktop && cargo test`）

## Spec 同步

- 更新：`specs/socai/gates.spec.md`（FAIL_TO_PASS / Rust orphan / 禁止 cd）
- 依据：编排工具行为，同批同步

## 涉及文件白名单

- `.claude/skills/lt-execute/references/gates/check-test-gate.sh`
- `.claude/skills/lt-execute/references/gates/README.md`
- `test-fixtures/fail-to-pass-gate.test.mjs`
- `test-fixtures/fail-to-pass-rust.test.mjs`
- `test-fixtures/fail-to-pass-rust/`（最小 crate fixture，若需要）
- `specs/socai/gates.spec.md`
- `.claude/skills/socai/SKILL.md`（全局验收命令里 cargo 那一行）

## 回滚影响

- 回滚本批：系统仍可运行 ✅

## 不做什么

- 不在目标仓装 rustup；fixture 用最小 crate。无 rustc → **停、不 commit**，报告缺 rustc，不得 skip 当过。
- 不改 desktop-lexi
- 禁止方案 B（orphan 检出后 exit 0 当 FAIL_TO_PASS 通过）

## 否决方案

- 关掉 Rust 批的 FAIL_TO_PASS：否决，JS 假先行仍要拦。
- orphan-skip（方案 B）当完成：否决，与「gate 绿 ≈ 目标绿」冲突。
- 只在 SKILL 写「编排者用人判断」：否决。
