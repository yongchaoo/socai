# socai 编排协议 — 开工 baseline / merge target / auto 停点 / batch_base 收口（行为契约）

> 协议层 SSOT：`.claude/skills/socai/SKILL.md` 条文的行为锚点。
> 机械校验：`node --test test-fixtures/protocol-baseline.test.mjs`（字符串锚点，验条文不验模型遵守）。

## 开工 baseline（三选一，必须写入 progress）

```GWT
Given 用户 /socai 且工作区可能脏（git status --porcelain 非空）
When 编排者切 socai/<slug> 之前
Then 必须钉死 baseline 三选一并写入 progress.md：baseline=clean-cut / baseline=wip-anchor-then-branch / baseline=reuse-head
And 脏工作区且用户未指定 → 不进 executor，先问；禁止默默 git add -A
And 用户已在对话里选定的 → 直接记录，不重问
```

## merge target（三选一，必须写入 progress）

```GWT
Given 开工钉 baseline 的同时
When 编排者写 progress.md
Then 必须钉死 merge target 三选一：merge=main / merge=integration:<branch> / merge=keep-branch
And git merge-base --is-ancestor main HEAD 为假，或 progress 有 WIP 锚点 / 用户声明 main 非集成支 → 禁止默认 squash 回 main
And 收尾只按已选 target 收口（squash 到 target，或 keep-branch 留支交人）
```

## auto 停点

```GWT
Given 闸门模式 auto（非 attended）
When 批循环自跑
Then 跳过每批 y/n；gate+fixer 自跑；review CONCERNS 自动修一轮再审
And 停点仅四：review BLOCKER / 本批或收尾产物验收失败 / fixer 满 3 / infra_fails≥2
And 不停：仅因 is-high-risk 命中或 risk: high
And attended 仍每批问 y/n
```

## auto 无人值守（默认推荐路线，禁问）

```GWT
Given 闸门模式 auto（长时间挂起，人不在）
When 遇到任何非四停点的决策点
Then 禁止任何形式提问/等确认（不问 commit / 进下一批 / baseline 选择 / 合支 / 审计划还是审结果）
And 一律走默认推荐路线，假设记 progress.md：
  | 决策点 | auto 默认 |
  |---|---|
  | baseline 歧义（脏树未指定） | wip-anchor-then-branch |
  | merge target 未指定 | keep-branch |
  | 「用户本能 vs 实际」表填不出 2 行 | 目标原文+bug-memory 推 2 行，记 AUTO_ASSUMED=1 继续 |
  | 批间过渡 / review 通过 / 收尾最终确认 | 不停不问，直接进下一批 / 按 merge target 收口 |
  | 目标不清楚 | 按最合理解释前进并记假设；仅完全无法形成可执行目标时停（等同 BLOCKER） |
```

## batch_base 收口（治理 commit 不污染本批 diff）

```GWT
Given 本批功能 commit 已落且标题不是 wip(batch):
When 编排者之后自己提交 plans/ .socai/ 治理 commit
Then 先清 progress 里 batch_base=；治理 commit 不得再用旧 batch_base 跑 whitelist / spec-sync（会把治理文档算进本批 diff）
And 用新 base，或依赖 whitelist / spec-sync 对 plans/ .socai/ 的豁免
```

## 高风险写手（打包 / SEA / 权限 / sidecar 类）

```GWT
Given 子 plan risk: high 且属打包 / SEA / 权限 / sidecar 类
When 编排者派写手
Then 须满足其一：配了 roles.executor_high_risk，或子 plan 声明了产物验收字段（完整语义见 B05）
And 只记账 HIGH_RISK_WEAK_EXECUTOR=1 不算完成
```

## 收尾产物测量（acceptance.artifact，B05）

```GWT
Given 任一子 plan 含独占行 acceptance.artifact: kind=app-size max=<N>M measure=du-app [path=<dir>]
When 全批 done 收尾（或该批 gate 后）
Then 编排者必须对每份声明了字段的子 plan 跑 bash .claude/skills/socai/_runtime/check-artifact.sh <子plan>
And 量的是 mount 后安装 .app 的 du -sm，≤ max 才过；--check / staging / du resources 数字不得顶替
And 脚本非 0（超标或找不到 .app/.dmg）→ 停，回 fixer 或喊人（auto 停点「产物验收失败」即此命令非 0）
```

```GWT
Given 子 plan 无 acceptance.artifact 字段
When 收尾跑 check-artifact.sh
Then exit 0（跳过），不阻塞收口
```

## 执行日志（$SOCAI_LOG_ROOT，默认 ~/.local/share/socai/logs）

```GWT
Given /socai 开工且 run-log.sh 可用
When 编排者钉死 slug / baseline / merge / executor / reviewer
Then 必须 `run-log.sh start`，JSONL 落到 `$SOCAI_LOG_ROOT/runs/<run_id>.jsonl`（默认 `$SOCAI_HOME/logs`，SOCAI_HOME 默认 `$HOME/.local/share/socai`）
And 计划落盘后 `snapshot-plans --from .socai/<slug>` 拷贝 goal/00-master/NN-*.spec.md
And 每批 gate/review/fixer/infra 各 append 一条 event（含 batch、exit、模型）
And 开工 recall 后 append 一条 recall event（status: ok|degraded|no-hit + hits 数）
And review 事件必带 concerns_topics（≤5 个关键词），否则蒸馏只能看到 verdict 看不到哪里弱
And 收尾 `finish --status done|blocked|aborted`；任何中断路径（blocked/放弃/被取代/会话将断）都必须 finish 清 current/ 指针
And 开工 start 前 current/<slug> 已存在 → 报有烂尾 run，先 finish 或续跑
And 日志不得 commit 进目标仓
```

## 收尾蒸馏（distill，自进化闭环）

```GWT
Given 本 run jsonl 含 gate 红（fail>0 / result=fail）/ fixer 事件 / review CONCERNS / infra 事件 / 假绿标 任一
When 收尾（run_finish 前评估）
Then 编排者必须蒸馏 ≥1 条四元组 lesson（症状/根因/修复/防回归断言 + frontmatter paradigm_class/trigger_keywords），落 logs/lessons/ 并 bug-memory.sh ingest
And 四段非空、防回归断言含可执行命令或明确禁止句式、trigger_keywords ≥3 且含 run 中实际出现过的词，否则不得 ingest
And 根因未核实 → 根因段标「待核 + 可能方向」，禁止把猜测写成事实
And run jsonl >200 行时可 spawn subagent 按 _runtime/distill.prompt.md 蒸馏
And finish --json 必带 distill=ingested:<N>|skipped_clean
```

```GWT
Given 本 run 全绿无波折（无上述任一触发）
When 收尾
Then 豁免蒸馏，finish --json 记 distill=skipped_clean
```

```GWT
Given 目标仓没有 vendored bug-memory.sh
When 开工 recall
Then 改用 $HOME/.claude/skills/socai/_runtime/bug-memory.sh，不得因仓内路径缺失直接标降级
```

```GWT
Given socai 已 commit 本批
When 跑 check-file-whitelist / check-spec-sync / check-hack-count
Then 必须用实现了 LT_DIFF_BASE..HEAD 的 gate（SoCai 全局副本，或已对齐的仓内副本）
And 目标仓旧脚本只看工作区时，clean tree 会假绿——不得当通过
And check-test-gate.sh 的参数是测试命令字符串，不是 spec.md 路径
```
