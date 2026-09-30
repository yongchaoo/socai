---
paradigm_class: remote-access
trigger_keywords:
  - ZNTPT
  - sshpass
  - Permission denied
  - BatchMode
  - 10.60.0.11
---

# ZNTPT 公钥登录失败不是主机挂了

## 症状

BatchMode 公钥 SSH 只在 `10.60.0.11` 成功。`10.60.0.25`、`.28`、`.37`、`.15`、`.39` 等返回 Permission denied。审查据此判数据面 BLOCKER，铺开停住。用户指出这些机器以前用密码单独部署都通。

## 根因

除试用机外，ZNTPT 主机不接受这把公钥。密码在 `sites/edu/.res/wireguard/wireguard-deploy/password-reset/全部服务器密码.csv` 的「隧道访问地址 / root密码」列。用公钥探测会把「认证方式不对」看成「机器不可用」。

## 修复

验收和安装走 `sshpass -f` 模式 600 的临时密码文件，选项 `PreferredAuthentications=password`、`PubkeyAuthentication=no`、`NumberOfPasswordPrompts=1`。密码只试 CSV 里那一条，失败不换密码重试（faillock）。不登录 `10.60.0.53`。不把密码写进文档、提交或对话。

## 防回归断言

禁止把 BatchMode 公钥的 Permission denied 当成主机宕机或数据面失败。对 `10.60.0.11` 以外的 ZNTPT 主机，验收命令必须是密码登录；公钥失败不得单独作为 BLOCKER。
