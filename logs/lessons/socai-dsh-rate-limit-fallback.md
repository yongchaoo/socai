---
paradigm_class: socai-orchestration
trigger_keywords: [dsh, DeepSeek, RATE_LIMIT, 429, tpm, timeout, infra_fails, fallback, cursor-host, 限流, 退避]
---
症状：dsh(DeepSeek) executor 撞 TPM 限流/timeout（13 次 run 中 4 次命中，全部发生在 dsh 后端）；092441 同后端连续重试 → infra_fails=2 触停点，run blocked。
根因：dsh 有 TPM 限流；SKILL 只定义「infra_fails≥2 停」，未定义限流时的退避/降级路径；同后端立即重试必然再撞。
修复：infra 事件含 RATE_LIMIT/429/timeout → ① 退避 ≥60s 再试一次 ② 仍失败 → 降级 cursor-host 续批（084155 人肉验证可行）③ 降级成功不计 infra_fails。
防回归断言：run jsonl 不得出现同后端 60s 内连续两条 RATE_LIMIT；dsh 限流后同 run 应有 backoff/fallback 事件，否则视为编排违规，evolve-report 必须报出。
