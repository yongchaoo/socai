# SoCai

多 agent 薄编排：给目标 → 拆批 → 每批独立 subagent 写码 → 机械 gate → 高风险跨模型 review → squash 合主干。

## 安装

```bash
git clone <repo> SoCai && cd SoCai && ./install.sh
./install.sh --verify
```

可选 deepseek 执行者：`echo 'export SOCAI_DEEPSEEK_KEY=sk-...' >> ~/.zshenv`（也认 `MA_DEEPSEEK_KEY`）。

装完开新窗口，任意项目敲：

```
/socai <你的目标>
```

详见 [`docs/socai-guide.md`](docs/socai-guide.md)。

## 仓库里有什么

| 路径 | 角色 |
|------|------|
| `.claude/skills/socai/` | `/socai` 编排 skill |
| `.claude/agents/socai-executor.md` | 批次执行 subagent |
| `.claude/agents/socai-reviewer.md` | 对抗 review subagent |
| `socai-call.mjs` | `plan-review` / `diff-review` / `exec`（`~/.local/bin/socai-call`） |
| `socai-backends.mjs` | backend 表 + `runAgent` / `resolveRouting` |
| `socai.test.mjs` | backends + call 单测 |
| `.socai/<slug>/` | 单次任务临时脚手架（相对 cwd，gitignore，结束人工删） |
| `install.sh` | 全局 symlink（幂等） |

## 测试

```bash
node --test socai.test.mjs
```
