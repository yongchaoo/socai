# Batch 06 — bug-memory 可用：路径 / doctor / FTS / 测试

risk: low
tags: socai,memory

## Spec（行为契约）

- 输入：`bug-memory.sh recall|ingest|doctor`；life 仓可能不在 `脚本ROOT/../life`。
- 输出：找得到 `src/cli/search.ts` + `data/life.db` 时，**不得**因默认路径或 embedding fetch 写成「life-kb 不可用」。
- 边界：真没有 life、真没有 db → 仍降级，但原因必须具体（路径 / 缺 db / CLI 错误摘要）。

### 已在工作区、本批必须收口并测试钉死

2026-08-22 已改未作为 SoCai 批次提交的内容（execute 以 HEAD 为准，缺什么补什么，禁止假设已合 main）：

1. `LIFE_DIR` 解析：`MA_LIFE_DIR` → `~/.config/socai/config.json` 的 `paths.life`/`life_dir` → `$HOME/www/life` → `/Volumes/dufa-mac/www/life` → SoCai `../life` → `cwd/../life`
2. `doctor` 子命令
3. `life-fts-fallback.py`：node 缺依赖或 CLI `fetch failed` 时查 FTS
4. ingest：node 失败后用**文件路径**走 fallback（禁止再用已读空的 stdin）
5. `recall` 的 `wrote` 打 stderr
6. `install.sh --verify` 跑 doctor（warn 即可）
7. SKILL 写明路径与「禁止 recall > bug-memory.md」

### 本批补齐

- 扩展 `test-fixtures/bug-memory.test.mjs`（现有只验「无 life → 降级」）：
  - `doctor` 在 `MA_LIFE_DIR` 指向含 `search.ts` + 假 `data/life.db`（可用 sqlite 建最小 knowledge + knowledge_fts）时 exit 0 或至少不报「未找到」
  - recall 对上述假库有 procedure 行 → `bug-memory.md` **无** `⚠️ 降级`，且含命中行
  - node CLI 被 stub 成失败（或不提供 tsx）时仍走 FTS 命中
  - ingest 文件后 search 能捞回（content_hash 去重第二次 inserted=false）
  - `wrote` 不在 stdout（stdout 空或仅 JSON；stderr 含 wrote）
- 降级文案含具体路径/原因，禁止只写「不可用/无命中」且不解释。

life 仓 `search.ts` 遇 embedding fetch 仍非 0：本批 **不改 life**，记入总纲债。

## Invariants

- `doctor` 在 life 仓 + db 存在时不得因默认路径报「life-kb 不可用」。
- 向量侧失败不得等于没有记忆。

## Test（先行）

- 先扩 `test-fixtures/bug-memory.test.mjs` 的「假库 recall 应成功」——若当前已实现则先确认绿/红，未实现则红。
- 保留原测试：无 life → 有 `⚠️` 且无范式保底头行。

## 验收点

- `node --test test-fixtures/bug-memory.test.mjs` 绿
- `bash .claude/skills/socai/_runtime/bug-memory.sh doctor` 在开发机（已配 `paths.life` 或外接盘 life）exit 0
- `install.sh --verify` 对 bug-memory 打 ✓ 或明确 ⚠

## Spec 同步

- 新增/更新：`specs/socai/bug-memory.spec.md`（GWT：解析顺序、降级原因、FTS fallback、stderr wrote）
- 可在 `specs/ma-v3-architecture.spec.md` 加一句指向该 spec

## 涉及文件白名单

- `.claude/skills/socai/_runtime/bug-memory.sh`
- `.claude/skills/socai/_runtime/life-fts-fallback.py`
- `.claude/skills/socai/SKILL.md`
- `install.sh`
- `test-fixtures/bug-memory.test.mjs`
- `specs/socai/bug-memory.spec.md`
- `specs/ma-v3-architecture.spec.md`

## 回滚影响

- 回滚本批：系统仍可运行 ✅（记忆再降级，socai 主流程不堵）

## 不做什么

- 不改 `/Volumes/dufa-mac/www/life` 的 search.ts / embedding
- 不提交 desktop-lexi `.socai/desktop-slim/lessons/*`（教训已 ingest 进 life db，不是本仓源码）
- 不配 Ollama 作为本批验收

## 否决方案

- 只设 `MA_LIFE_DIR` 环境变量、不改解析：否决，编排者会话经常不带这个 env。
- 再造一套 SoCai 本地 markdown 记忆：否决，life db 已有 procedure，重复 SSOT。
