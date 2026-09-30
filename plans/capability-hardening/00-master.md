# capability-hardening 总纲

来源：desktop-lexi `/socai auto desktop-slim` dogfood（2026-08-22）。
目标仓是 **SoCai**（编排 / gate / 记忆），不是 desktop-lexi 产品代码。

## 目标

做完之后：编排者只串场；gate 绿 ≈ 目标绿；脏仓和错误测量点不再靠人临场发明。
下一场同等复杂度任务，编排者不必改 `plans/*.spec.md` 过门、不必亲自解释「257M 为什么是假绿」。

## 现状架构拓扑

```
用户 /socai
  → 编排者（SKILL.md：切支 / spawn / Bash gate / progress）
       → socai-executor（改目标仓源码 + commit）
       → socai-reviewer（跨模型看 $batch_base..HEAD）
       → lt-execute gates（whitelist / test-gate / spec-sync / hack / invariant）
       → socai/_runtime（is-high-risk / bug-memory → life-kb）
```

数据流：子 plan 白名单 + `LT_DIFF_BASE=$batch_base` 喂 gate；life-kb 是跨任务 procedure 记忆。
契约：`specs/ma-v3-architecture.spec.md`（隔离 / spine / gate）。desktop-slim 证明契约有洞。

## 目标架构拓扑

同一拓扑，三处变硬：

1. **协议层（SKILL）**：开工必须钉死 baseline + merge target；auto = 跳 y/n，只在 BLOCKER / 产物验收失败停；治理文档 commit 不得污染本批 `batch_base`。
2. **门禁层（gates + is-high-risk）**：白名单认测试/lockfile；FAIL_TO_PASS 认 Rust 模块；spec-sync 用显式字段；高风险关键词带词边界。
3. **验收层**：子 plan 可声明 `acceptance.artifact`；收尾 bash 量安装产物（`.app`），不把 staging/`--check` 当目标数字。

bug-memory 路径 + FTS fallback 已在工作区起了头，本任务用测试钉死并收口，不另起记忆产品。

## 用户本能 vs 实际（编排者 / 操作者）

| 本能操作 | 实际结果（desktop-slim） |
|----------|--------------------------|
| 脏树上 `/socai auto`，默认能切干净支并在收尾 squash 回 main | skill 假定干净树 + main 是集成分支；main 只是 init 锚点时整支 squash 会灌入无关 WIP |
| gate 绿 = 本批目标达成（体积 ≤250M、test-first） | 体积量的是 resources；Rust FAIL_TO_PASS 因模块孤儿假阴；白名单把合法测试当越权 |
| 开工 recall 能读到历史教训 | 脚本找 `/Users/life`；node CLI 被 Ollama fetch 整段打死；stdout 重定向污染 `bug-memory.md` |

## 症状清单（按严重度）

1. **高**：gate 绿、安装 `.app` 超目标（测量点错）。
2. **高**：Rust FAIL_TO_PASS 假阴 → 编排者用人判断覆盖机械保证。
3. **中**：白名单不认 colocated 测试 / lockfile → 编排者改 plan 过关（治理演戏）。
4. **中**：skill 默认 squash main、auto「高风险 pause」与实际跑法两套。
5. **中**：bug-memory 整场降级（路径 + CLI + 吞 stderr）。
6. **低**：spec-sync 吃段落关键词；`sse ⊂ PASSED` 假阳；`HIGH_RISK_WEAK_EXECUTOR` 只记账不强约束。

## 根因分析

用户问题是否指向同一架构根因？

- **根因**：机械件和协议量的是「脚本方便量的东西」（staging、`cd && cargo`、段落里有没有「基础设施」、裸 grep 关键词），不是「目标定义的东西」（安装产物、新测是否在实现前红、豁免字段、词边界）。环境假设写死（干净树、skill 住在 SoCai 仓旁、`../life`、main 可 squash）。
- **一批修不了**：协议（SKILL 文本 + 编排者行为）和门禁脚本（独立 test fixture）是两层；记忆是第三条腿。能合并的症状已合并进各批，不按「B08 体积 / B07 cargo」拆产品症状批。
- **不修的根因**：life-kb 的 embedding/Ollama 稳定性（life 仓）；desktop-lexi 的 Windows SEA / postject alpha（产品债）。

## 否决方案（ADR-lite）

- 考虑过「加长 SKILL checklist、靠编排者更小心」，否决：desktop-slim 已证明软约束挡不住临场判断，context 会再厚。
- 考虑过「关掉 FAIL_TO_PASS / 白名单」，否决：JS 假先行和 `git add -A` 仍要拦；要修测量，不要拆栏。
- 考虑过「编排者继续改 plan 过 gate」，否决：法官补卷，白名单失去意义。
- 考虑过「另建 SoCai 自有向量库」，否决：life-kb 库里有数据，坏的是解析和降级。

## 架构债预算

本任务最多 **2** 处 `TODO(arch-debt)`：

| 债 | 理由 | 何时还 | 谁还 |
|----|------|--------|------|
| life search.ts 遇 embedding fetch 仍非 0 | 属 life 仓，本任务用 FTS fallback 兜 | 下次碰 life CLI | life 维护者 |
| 产物验收不进目标仓 pre-commit | 测量命令随项目变，只能 socai 收尾跑 | 若出现第三场量错再升 gate | SoCai |

## Invariants（红线，必须可机器验证）

- 白名单：`foo.ts` 在名单内时，同茎 `foo.test.ts` / 同目录 `Cargo.lock`/`pnpm-lock.yaml`、以及 `plans/**` `.socai/**` 不得判越权。
- FAIL_TO_PASS：Rust 新模块在 `mod` 被 revert 后，**新测必须被观察到没过**（compile-fail / 断言红 / `cargo test <name> -- --exact` 非 0）。只跑旧测 exit 0 **不得**报假先行，也**不得** skip 后当通过。`cd <crate> && cargo test` 不得作为推荐/默认验收命令。
- **共享文件串行**：`SKILL.md`、`specs/socai/gates.spec.md`、`specs/socai/orchestration.spec.md` 后批只追加一句/一节，**不得重写**前批已钉 GWT。B02 不碰 `SKILL.md`。
- spec-sync：豁免只认段内显式 `spec-sync: exempt=<token>`（或等价字段），不靠「基础设施」散落字。
- is-high-risk：`PASSED` 不得因子串 `sse` 命中。
- 开工：`bug-memory.sh doctor` 在 life 仓 + db 存在时不得因默认路径写成「life-kb 不可用」。
- 协议：SKILL 不得再写「auto = 高风险默认 pause」且同时写「默认 squash 回 main」而不提 merge target。

## 非目标

- 不改 desktop-lexi 产品（SEA / tray / 体积数字本身）。
- 不修 life embedding / 不上 CJK 分词器。
- 不把 file-whitelist 从 socai「可选」升「总跑」（另立项；B02 不碰 SKILL）。
- 不自动合任何目标仓的 main。
- 不批量改 desktop-lexi 已有 `plans/`（B04 字段落地后那些旧 plan 会红，由使用方补 `spec-sync: exempt=`）。

## 批次清单

| 批次 | 主题 | 类型 | 架构层 | 依赖 | 半完成态可发布 | 复杂度 |
|------|------|------|--------|------|----------------|--------|
| B01 | 开工 baseline / merge target / auto 语义 / 治理 commit 不污染 batch_base | root-cause | contract | 无 | ✅ | 中 |
| B02 | 白名单自动豁免（测试 / lockfile / plans / .socai） | root-cause | infra | 无 | ✅ | 小 |
| B03 | FAIL_TO_PASS 认 Rust 模块（必须方案 A）；禁止 cd 进 crate | root-cause | infra | 无 | ✅ | 中 |
| B04 | spec-sync 显式豁免字段；is-high-risk 词边界 | root-cause | infra | 无 | ✅ | 小 |
| B05 | `acceptance.artifact` + 收尾测量安装产物 | root-cause | contract | B01 | ✅ | 小 |
| B06 | bug-memory 解析 / doctor / FTS fallback / ingest / 测试钉死 | root-cause | infra | 无 | ✅ | 中 |

symptom + scaffold = 0%。**必须串行** B01 → B02 → B03 → B04 → B05 → B06（共享 `gates.spec.md` / `SKILL.md`；B06 收口 bug-memory WIP）。禁止并行改同一契约文件。

## 批次依赖图

```
B01 ──→ B05
B02
B03
B04
B06
```
