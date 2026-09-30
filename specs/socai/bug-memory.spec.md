# socai bug-memory — life-kb 路径解析 / doctor / FTS fallback / ingest（行为契约）

> 记忆层 SSOT：`.claude/skills/socai/_runtime/bug-memory.sh` + `life-fts-fallback.py` 的行为锚点。
> 机械校验：`node --test test-fixtures/bug-memory.test.mjs`（临时 mock life 仓，hermetic，不依赖本机真实 life）。
> 上游契约（召回产物 / 降级标 / frontmatter 范式）见 `specs/ma-v3-architecture.spec.md` 的 bug-memory 节。

## 路径解析（LIFE_DIR）

```GWT
Given 编排者跑 bug-memory.sh（recall / ingest / doctor）
When 解析 life-kb 仓库目录
Then 顺序为：MA_LIFE_DIR → ~/.config/socai/config.json 的 paths.life/life_dir →
  仓旁 ../life → cwd/../life
And 不得把 $HOME/www/life 或 /Volumes/... 当默认候选（个人路径只允许经 env / config 显式指定）
And 首个含 src/cli/search.ts 的目录胜出
```

```GWT
Given MA_LIFE_DIR 被显式设置但指向的目录无 src/cli/search.ts
When 解析 LIFE_DIR
Then 不得静默 fall-through 到 config / 候选目录（否则「无 life」场景被本机另一份真库掩盖，降级原因失真）
And 降级原因必须含该显式路径（如「MA_LIFE_DIR=<path> 无 src/cli/search.ts」）
```

## doctor（开工自检）

```GWT
Given life 仓可解析且 data/life.db 存在（即使缺 node_modules/tsx）
When 跑 bug-memory.sh doctor
Then exit 0，输出 LIFE_DIR / LIFE_AVAILABLE=true / LIFE_VIA / 各依赖有无 / probe=ok
And 不得因默认路径假设写成「life-kb 不可用 / 未找到」
```

```GWT
Given life 仓真不存在（所有候选均无 search.ts）
When 跑 doctor
Then exit 非 0，REASON 含具体指引（设 MA_LIFE_DIR 或 config paths.life）
```

## FTS fallback（向量侧失败 ≠ 没有记忆）

```GWT
Given life 仓可解析但 node CLI 不可用（缺 tsx/better-sqlite3）或 CLI 跑挂（如 embedding fetch failed）
When recall / ingest 执行
Then 降到 life-fts-fallback.py 直接查 data/life.db 的 knowledge_fts（FTS5 MATCH，失败再退 LIKE）
And 有命中时 bug-memory.md 不得含 ⚠️ 降级标
And 真无命中 / 无 db 时才降级，且原因具体（路径 / 缺 db / CLI 错误摘要），禁止只写「不可用」
```

## ingest（写入与去重）

```GWT
Given life-kb 可用（node-cli 或 fts-fallback）
When bug-memory.sh ingest <bug-md-path>
Then 写入 knowledge（category=procedure, source=ai-inferred）并同步 knowledge_fts
And node CLI 失败后 fallback 必须用文件路径（禁止再用已读空的 stdin）
And 同一内容第二次 ingest 按 (owner, content_hash) 去重，stdout JSON 报 inserted=false
And ingest 后 recall 同关键词能搜回该条目
```

## recall 输出通道（零渗漏 + 防污染）

```GWT
Given recall 跑完（无论命中或降级）
When 脚本写 .socai/<slug>/bug-memory.md
Then 「bug-memory: wrote …」状态行只打 stderr，stdout 不混状态行
And 禁止 `recall … > bug-memory.md` 用法（stdout 重定向会把状态行/错误摘要写进记忆文件）
```

## 已知边界（不解决，文档化）

- life 仓 `search.ts` 遇 embedding fetch 仍可能非 0：属 life 仓债（见总纲架构债预算），本侧用 FTS fallback 兜。
- FTS5 unicode61 对连续 CJK 整段成单 token：中文检索靠 trigger_keywords 英文词或整段匹配，不上 CJK 分词器（非目标）。
