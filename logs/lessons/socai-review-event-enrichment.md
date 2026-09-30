---
paradigm_class: socai-orchestration
trigger_keywords: [review, CONCERNS, recall, 事件字段, 摘要, 命中率, jsonl, 蒸馏, 日志]
---
症状：① 0911 的 review CONCERNS→fixer×2→PASS 全程，jsonl 只有 verdict 没有 concerns 主题，事后蒸馏看不到「哪里弱」；② recall 事件仅 1/13 run 有记录，记忆命中率无法计算。
根因：run-log 事件字段从最小集起步，review / recall 两类关键事件缺摘要字段；executor 是否遵守召回教训完全无记录。
修复：review 事件必带 concerns 主题词（≤5 个关键词）；recall 事件必带 status(ok/degraded/no-hit) + hits 数；executor 回摘要时带「bug-memory 命中教训是否涉及本批」（recall_hit/recall_ignored）。
防回归断言：蒸馏时能从 jsonl 直接抽出 CONCERNS 主题词；recall 覆盖率（有 recall 事件的 run / 总 run）须 → 100%，evolve-report 报出。
