# SoCai — Agent Entry

> **SoCai** 多 agent 编排。家 = 本 repo（`~/www/SoCai`）。
> 结构：`AGENTS.md`（本文件）+ `specs/`（行为契约）+ `docs/decisions/`（ADR）+ `plans/`（临时脚手架）。

## 现行：`/socai`

薄编排 = **subagent 执行 + spine + 机械 gate**。

| 入口 | 说明 |
|------|------|
| `/socai <目标>` | 编排 skill（`.claude/skills/socai/`） |
| `socai-executor` / `socai-reviewer` | subagent（`.claude/agents/`） |
| `socai-call` | 多模型薄壳：`plan-review` / `diff-review` / `exec` |
| `socai-backends.mjs` | `runAgent` / `resolveRouting` spawn 单点 |

手册：`docs/socai-guide.md` · 契约：`specs/ma-v3-architecture.spec.md` · 决策：`docs/decisions/0001` + `0002`。

**价值**：不是「想得更深」，是「**坏得更慢、能续命**」——弱模型 + 短有效 context + 会话会断时，靠 durable 产物 + 每批 commit + 可跨窗口续。

## 三层

1. **执行** — 每批 spawn 隔离 context 的 executor，干完回摘要。
2. **spine** — `plans/<slug>/` + 每批 commit；subagent 丢 context → spine 强制。
3. **机械 gate** — test / spec-sync / lint；fixer 封顶 3；高风险 escalation。

## 已删除（勿复活）

| 旧物 | 为何删 |
|------|--------|
| v1 `socai.mjs` / `ma.mjs` 自治 CLI | 死在「用代码复刻永不犯错的人」 |
| v2 `/ma` skill（`.claude/skills/ma/`） | role-play 层跟 direct 打平；spine 已并入 `/socai` |
| `plans/multi-agent-ecosystem/`、`plans/ma-v2-simple/` | 临时脚手架，易误导 |

## 约定

- `specs/` — 行为契约（GWT），**SSOT**。
- `docs/decisions/` — WHY / ADR。
- `plans/<slug>/` — 单次任务临时脚手架，结束人工删。

## 安装

```bash
cd ~/www/SoCai && ./install.sh && ./install.sh --verify
```
