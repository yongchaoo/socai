---
paradigm_class: infra-nat
trigger_keywords:
  - GRE
  - keepalive
  - first-packet
  - conntrack
  - NAT
  - DeepSeek
  - 000 timeout
---

## 症状
独立复查大机 `curl https://api.deepseek.com` 得到 000 timeout，EOS 仍 200；写手刚测过却是 401。

## 根因
云 VPC 禁直连转发，公网走 GRE；空闲约 30s 后 GRE flow conntrack 过期，新 SSH 首包被丢。

## 修复
大机 `lexi-gre-keepalive.timer` 每 10s ping 隧道对端；编排者必须自己再 curl，不信写手摘要。

## 防回归断言
禁止只凭写手「deepseek=401」合 Batch 1；须编排者新开 SSH 再跑 `curl -m8 https://api.deepseek.com` 期望 401。
