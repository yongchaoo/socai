# SoCai 配置地图

下次直接点链接跳转。改「用哪个模型」走 **A**；改「怎么干活」走 **B**。

手册：[`socai-guide.md`](socai-guide.md) · 契约：[`../specs/ma-v3-architecture.spec.md`](../specs/ma-v3-architecture.spec.md)

---

## A. 模型 / backend 路由

| 层级 | 链接 | 说明 |
|------|------|------|
| **个人全局（改这里）** | [`~/.config/socai/config.json`](file:///Users/dufa/.config/socai/config.json) | `roles.planner` / `executor` / `reviewer`；可选 `executor_high_risk`；chmod 600，不入 repo |
| 内置默认 | [`../socai-backends.mjs`](../socai-backends.mjs) → `DEFAULT_ROUTING` / `CN_ROUTING` | 未配全局时的家底 |
| 合并与解析 | [`../socai-backends.mjs`](../socai-backends.mjs) → `resolveRouting` / `runAgent` | 四层合并入口；`risk: high` 时才吃 `executor_high_risk` |
| 多模型薄壳 | [`../socai-call.mjs`](../socai-call.mjs) | `plan-review` / `diff-review` / `exec`（`exec` 可 `--risk=high`） |
| 项目层（非 roles） | `.agents/socai.config.json` | 仅 timeout 等；**禁放** backend/model/roles（I10） |

**`roles.executor_high_risk`（可选）**：子 plan `risk: high` 时本批写手改用该 backend/model。**没配不封场**——仍用 `roles.executor`，progress 记 `HIGH_RISK_WEAK_EXECUTOR=1`。审稿仍走 `is-high-risk.sh`（与派工分离）。

**`socai-call` 默认超时**（无 `--timeout` 时）：`exec` = **3600s**；`plan-review` / `diff-review` = **600s**。项目层 timeout 配置若存在，只应作用于 exec 路径，不要把审稿一并拉长。

**合并优先级（低 → 高）**：内置默认 → 全局 `config.json` → 项目 `.agents/socai.config.json` → env / flag

**常用 env**（覆盖全局）：

| 变量 | 作用 |
|------|------|
| `SOCAI_EXECUTOR_BACKEND` / `SOCAI_EXECUTOR_MODEL` | 执行者 |
| `SOCAI_REVIEWER_BACKEND` / `SOCAI_REVIEWER_MODEL` | 审查者 |
| `SOCAI_CONFIG_HOME` | 改全局配置目录（测试隔离用） |
| `SOCAI_DEEPSEEK_KEY` / `SOCAI_GLM_KEY` | 外部 backend 密钥（放 `~/.zshenv`） |

当前本机全局示例（以你机器为准，点开上面 `config.json`）：

```json
{
  "roles": {
    "planner":  { "backend": "claude-glm", "model": "glm-5.2" },
    "executor": { "backend": "cursor", "model": "composer-2.5-fast" },
    "reviewer": { "backend": "claude-glm", "model": "glm-5.2" }
  }
}
```

`executor.backend=cursor`：在 Cursor IDE → **cursor-host**（Task spawn）；在 Claude Code/CI → **cursor-cli**（`socai-call exec`）。

---

## B. 角色行为定义

| 角色 | 链接 | 触发 |
|------|------|------|
| **编排者** | [`.claude/skills/socai/SKILL.md`](../.claude/skills/socai/SKILL.md) | `/socai <目标>` |
| **计划者** | [`.claude/skills/lt-plan/SKILL.md`](../.claude/skills/lt-plan/SKILL.md) | `/lt-plan`（拆总纲 + 子 plan） |
| **执行者** | [`.claude/agents/socai-executor.md`](../.claude/agents/socai-executor.md) | 每批 spawn；唯一可改源码 |
| **审查者** | [`.claude/agents/socai-reviewer.md`](../.claude/agents/socai-reviewer.md) | 高风险 / 交互 UI → plan 或 diff review |

v3 里计划常由编排者写 [`.socai/<slug>/00-master.md`](../.socai/)（gitignore）；`config.json` 的 `roles.planner` 主要给 `socai-call` / 旧路由用。

---

## C. 相关决策与入口

| 文档 | 链接 |
|------|------|
| Agent 入口 | [`../AGENTS.md`](../AGENTS.md) |
| 使用手册 | [`socai-guide.md`](socai-guide.md) |
| ADR：subagent + 铁律 | [`decisions/0002-v3-subagent-prototype.md`](decisions/0002-v3-subagent-prototype.md) |
| 安装脚本 | [`../install.sh`](../install.sh)（`--host=cursor\|trae\|workbuddy\|all`） |

---

## 一句话

- 换模型 → [`config.json`](file:///Users/dufa/.config/socai/config.json)
- 换纪律 / prompt → [agents](../.claude/agents/) / [skills](../.claude/skills/)
