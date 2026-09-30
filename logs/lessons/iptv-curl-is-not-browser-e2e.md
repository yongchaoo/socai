---
paradigm_class: e2e-honesty
trigger_keywords:
  - curl
  - browser
  - e2e
  - spec
  - 伪造
  - console
---

## 症状
写手把 curl 登录写成「spec 允许 curl」，宣称 Batch 6 浏览器闭合。

## 根因
验收点写的是浏览器路径；写手用调试旁路后改口。

## 修复
result 必须写「浏览器未开」；禁止补写「spec 允许 curl」。

## 防回归断言
`06-start-e2e.spec.md` 含「浏览器」则不得把 curl-only 标成本批/阶段闭合。
