# Gate（防 AI 越狱 / 防架构静默烂）

软约束（SKILL.md 里的文字）挡不住硬压力（test 红了想跳过、范围外代码诱惑、context 快满）。
这些脚本是**机器可验证的 gate**——接进 git pre-commit 后**任何走 git 的 AI 都越不过**
（Cursor / Codex / Claude Code / 人，tool-agnostic）；未装 hook 前需 execute 手动跑、
review 独立再跑（用报告 vs diff 互审兜底"有没有真跑"）。

## 为什么需要 gate

execute 跑到一半会合理化越狱：
- "顺手改一下这个相邻 bug 没关系" → 违反 surgical
- "范围说不做什么，但不改下批跑不了" → 违反范围
- "typecheck 不 pass 但 build pass" → 违反自测
- "这个 test 我先 skip 掉，回头补" → 假先行
- "自测跑不动，我猜它对" → 违反验证

prompt 文字挡不住这些，可执行脚本挡得住。

## 七个 gate

| 脚本 | 何时跑 | 拦什么 |
|------|--------|--------|
| `check-file-whitelist.sh <spec.md>` | commit 前（需指针） | 动子 plan 白名单外的文件（防私自扩范围） |
| `check-test-gate.sh "<test cmd>"` | commit 前（需指针） | 先行 test 未绿 / 新增 skip（防假先行） |
| `check-hack-count.sh <spec.md>` | commit 前 | hack 标记计数上升且未登记债清单（防偷偷欠债） |
| `check-invariant.sh [master.md]` | commit 前 + review | 跨层 import 等架构 invariant 违反（防架构静默烂） |
| `check-contract-change.sh` | commit 前 | 改共享契约目录（`CONTRACT_DIR`，默认 `packages/shared/contracts/`）未跑 `test:contract` 绿 |
| `check-spec-sync.sh <spec.md>` | commit 前（需指针） | 改用户可见行为但未同步 `specs/` spec；标 N/A 无独占行 `spec-sync: exempt=<token>` 字段（旧关键词仅 warn）；声明了 spec 但 diff 没改（防行为契约丢失） |
| `pre-commit.sh` | 每次 git commit | 上面 6 个的自动编排（读 `.lt-current` 指针） |

## 白名单自动豁免（check-file-whitelist.sh）

下列路径即使未写入子 plan「涉及文件白名单」也不判越权：

| 豁免 | 条件 |
|------|------|
| 同茎测试 `path/foo.test.*` / `path/foo.spec.*` | 白名单含同茎源文件 `path/foo.<ext>`（非同茎测试不豁免） |
| `dir/Cargo.lock` | 白名单命中 `dir/Cargo.toml`（或其目录前缀） |
| `dir/pnpm-lock.yaml` / `dir/package-lock.json` | 白名单命中 `dir/package.json`（或其目录前缀） |
| `plans/**`、`.socai/**` | 编排者治理文档，无条件豁免 |

豁免不得扩成「任意新文件都过」：白名单外业务源码仍拒。行为契约见 `specs/socai/gates.spec.md`。

## FAIL_TO_PASS：Rust 模块（check-test-gate.sh）

- **禁止 `cd <crate> && cargo test`**：revert 用仓库根相对路径，cd 会污染 cwd。一律 `cargo test --manifest-path <crate>/Cargo.toml`，违者 gate 非 0。
- **orphan 新测必须被观察到没过**（方案 A）：revert 实现后若旧测仍绿且仅 HEAD 有的测试名消失，gate 不报假先行、也不 skip 当通过——逐条跑 `cargo test <name> -- --exact` 要求非 0；匹配 0 条且 exit 0 时恢复 `mod` 接线（新 `.rs` 仍删）要求 compile-fail。JS/TS 假先行（`expect(true)`）仍拒。

## 装一次，所有 AI 都受约束（推荐）

在目标仓库根目录跑一次（指向本 skill 的 install 脚本）：

```bash
bash <本 skill 路径>/references/gates/install-pre-commit.sh
# 如：bash ~/.claude/skills/lt-execute/references/gates/install-pre-commit.sh
```

装完后：
- **每次 `git commit`** 自动跑 `check-invariant` + `check-hack-count` + `check-contract-change`
- 走 `/lt-execute` 流程时，commit 前写 `.lt-current` 指针文件（已自动 gitignore），额外触发白名单 + 先行 test + spec-sync gate：

```
SPEC=plans/<phase>/NN-<topic>.spec.md
MASTER=plans/<phase>/00-master.md
TEST_CMD=pnpm exec vitest run <test 文件>
```

- 紧急绕过：`git commit --no-verify`（review 报告 vs diff 互审兜底，勿常用）
- 卸载：`rm .git/hooks/pre-commit`（或恢复 `pre-commit.bak`）

## 手动跑（未装 hook 时）

```bash
# execute commit 前（按子 plan 实际内容替换路径/命令）
./check-file-whitelist.sh plans/<phase>/NN-<topic>.spec.md
./check-test-gate.sh "pnpm exec vitest run <test 文件>"
./check-hack-count.sh plans/<phase>/NN-<topic>.spec.md
./check-invariant.sh plans/<phase>/00-master.md
./check-contract-change.sh
./check-spec-sync.sh plans/<phase>/NN-<topic>.spec.md

# review 独立再跑一遍（不信 execute 报告）
./check-file-whitelist.sh plans/<phase>/NN-<topic>.spec.md   # 验报告说"白名单内"
./check-hack-count.sh plans/<phase>/NN-<topic>.spec.md        # 验报告说"无新 hack"
./check-spec-sync.sh plans/<phase>/NN-<topic>.spec.md         # 验报告说"spec 已同步"
./check-invariant.sh                                            # 验跨层 import 没破
```

## gate 红了怎么办

**不绕 gate**。绕 gate 是越狱。两个选择：
1. 修到 gate 绿（改代码 / 加 `TODO(arch-debt)` 登记 / 删 skip）
2. 回 `/lt-plan` 修订子 plan（扩白名单 / 调 invariant / 标 test N/A 写理由）

## gate 查不到的（诚实边界）

- **red→green 的"红"**：单 commit 里 test 和 impl 在同一 commit，gate 只能查"无新 skip + 当前绿"，查不出 test 是否曾经红过。靠 review 维度 1 查 test 的 assertion 是否真有断言力（删 impl 也能绿 = 假先行）。
- **运行时 invariant**：SSE 客户端断开后进程存活等无法静态扫，由 `/lt-review` 维度 6/7 + Playwright 用例覆盖，不在 pre-commit gate。
- **未脚本化的 invariant**：`check-invariant.sh` 只覆盖内置的跨层 import 检查 + 条件 schema 检查。总纲里写的新 invariant 必须翻译成检查命令追加进脚本，否则 gate 不知道。
- **spec 内容质量**：`check-spec-sync.sh` 只验「子 plan 声明 vs diff 一致」+「N/A 有独占行 `spec-sync: exempt=<token>` 字段（token ∈ infra|docs|lockfile|style|tooling|ci）」+「N/A 与行为改动不矛盾」；spec 里 GWT 是否写真行为 / 是否覆盖边界失败模式，静态扫不出，靠 `/lt-review` 维度 9 兜底。

## 项目化

`check-invariant.sh` **默认无内置规则**（项目无关）。在脚本「项目专属静态 invariant」区追加你项目的检查——
用 `check_no_import "<src>" "<forbidden>" "<label>"` 防跨层耦合，或加自定义命令（schema 列类型、禁止某 API 等）。
`check-spec-sync.sh` 的行为源码目录由 `BEHAVIOR_PATHS` 指定（默认空=不启用 N/A 矛盾检查）；
`check-contract-change.sh` 的契约目录由 `CONTRACT_DIR` 指定（默认 `packages/shared/contracts/`）。
运行时 invariant（流式进程存活）走 review，不进静态 gate。
