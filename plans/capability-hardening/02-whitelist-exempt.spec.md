# Batch 02 — 白名单自动豁免

risk: low
tags: socai,gates

## Spec（行为契约）

- 输入：`check-file-whitelist.sh <spec.md>` + `LT_DIFF_BASE` 下的 diff。
- 输出：下列路径即使未写入「涉及文件白名单」也不判越权。
- 边界：豁免不得变成「任意新文件都过」。

### 豁免规则（须全实现）

1. **同茎测试**：白名单有 `path/foo.ts`（或 `.js/.mjs/.rs`）→ `path/foo.test.ts` / `foo.spec.ts` / `foo.test.mjs` 等同茎测试文件豁免。
2. **lockfile**：diff 含 `Cargo.toml` 且白名单命中该 `Cargo.toml` 或其目录 → 同目录 `Cargo.lock` 豁免；`package.json` / `pnpm-workspace` 同理豁免 `pnpm-lock.yaml` / `package-lock.json`。
3. **脚手架**：`plans/**`、`.socai/**` 豁免（编排者治理文档，不是产品扩围）。
4. **非豁免**：白名单外的业务源码（如多出来的 `apps/foo/bar.ts`）仍拒。

desktop-slim 现场：`top-nav-config.test.ts`、`Cargo.lock`、`packaging.test.mjs`、四份 `plans/desktop-slim/*.spec.md` 被当越权，编排者改 plan 过关。本批之后那种改法应变成不必要。

## Invariants（本批继承）

- 白名单：同茎测试 / 同目录 lockfile / `plans/**` `.socai/**` 不得判越权。
- 白名单外业务源码仍拒。

## Test（先行）

- `test-fixtures/file-whitelist-exempt.test.mjs`（新建）+ 小型 git fixture（可放 `test-fixtures/whitelist-exempt/`）
  - 名单仅 `src/foo.ts`，diff 加 `src/foo.ts` + `src/foo.test.ts` → gate exit 0
  - 名单仅 `desktop/Cargo.toml`，diff 加 `desktop/Cargo.lock` → exit 0
  - 名单仅 `src/foo.ts`，diff 加 `src/bar.ts` → exit 1
  - 名单仅 `src/foo.ts`，diff 加 `plans/x/01.spec.md` 与 `.socai/s/progress.md` → exit 0
- 先写测试（当前脚本应对同茎测试 / lockfile / plans 红），再改 `check-file-whitelist.sh`。

## 验收点

- `node --test test-fixtures/file-whitelist-exempt.test.mjs` 绿
- 现有 `test-fixtures/gate-base.test.mjs` 仍绿（`LT_DIFF_BASE` 行为不回退）

## Spec 同步

- 新增/更新：`specs/socai/gates.spec.md`（白名单豁免 GWT）
- 豁免：无用户产品 UI；此为编排工具契约，仍落 `specs/socai/`（操作者可见行为）

## 涉及文件白名单

- `.claude/skills/lt-execute/references/gates/check-file-whitelist.sh`
- `.claude/skills/lt-execute/references/gates/README.md`（补豁免表）
- `test-fixtures/file-whitelist-exempt.test.mjs`
- `test-fixtures/whitelist-exempt/`（若用目录 fixture）
- `specs/socai/gates.spec.md`

## 回滚影响

- 回滚本批：系统仍可运行 ✅（回到严白名单，编排者又要改 plan）

## 不做什么

- 不解析「逗号合并多 path 一行」（编排者应一行一个文件；可选 warn，不本批必做）
- 不豁免任意 `*.test.ts`（必须同茎或明确测试目录且对应源在名单——同茎即可，勿做模糊「任何 test 目录」）

## 否决方案

- 继续让编排者扩 spec 白名单：否决，法官补卷。
- 豁免整个 `tests/`：否决，写手可以往测试目录塞无关实现。
