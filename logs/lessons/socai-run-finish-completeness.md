---
paradigm_class: socai-orchestration
trigger_keywords: [run_finish, current, stale, 烂尾, aborted, blocked, 指针, finish, 中断]
---
症状：3/13 run 无 run_finish（084155 停在 review CONCERNS、0909 停在 synthesis 后、090057 被新 run 取代）；logs/current/ 残留 2 个 stale 指针，完成率统计失真。
根因：finish 靠编排者自觉；中断 / 被取代 / 会话断开时没有机械兜底清指针。
修复：① 任何中断路径（blocked / 放弃 / 被取代 / 会话将断）都必须跑 run-log.sh finish --status blocked|aborted 清 current/ 指针；② 开工 start 前检查 current/<slug> 已存在 → 报「有烂尾 run」，先 finish 或续跑再开新 run。
防回归断言：logs/current/ 不得存在超 48h 且无对应 run_finish 的指针；evolve-report 的 finish 率（有 finish 的 run / 总 run）必须 = 100%，否则报告自身标红。
