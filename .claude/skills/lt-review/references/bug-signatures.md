# Bug 签名速查（项目自填）

按项目/模块分章追加。每条：**症状 → 根因 → 验证手段**。审核时遇到匹配症状直接定位根因，
不必从头排查。这是项目专属的累积资产——每修一个难定位的 bug，就回填一条。

## 模板

```
## <项目 / 模块 / commit>

| 症状 | 根因 | 验证手段 |
|------|------|----------|
| <现象：报错/行为异常/性能问题> | <真实根因，非症状> | <怎么验证根因已消：命令/用例/检查> |
```

## 收录标准

- **难定位的**才收（一眼能看出的不收）。
- 写**根因**不写症状（"SSE 进程崩"是症状，"`enqueue` 未 guard 客户端断开"是根因）。
- 验证手段要**可复现**（一条命令 / 一个用例），不是"看着对了"。

<!-- 项目自填：在下方追加自己的 bug 签名表。 -->

## desktop-lexi / tauri

| 症状 | 根因 | 验证手段 |
|------|------|----------|
| 菜单缺 App/Edit 系统键位，⌘Q 等失效 | `set_menu` 须整表换；只挂 File 子集不够 | 真机点菜单 / 查 menu 表是否含 App+Edit；本阶段仅 prompt 签名弱补 |
| 选文件/目录时窗挂死 | rfd/dialog 不可在主线程 blocking pick | 查 handler 是否把 pick 丢到非阻塞路径；本阶段仅签名弱补 |
| JS `invoke('X')` 与 Rust `fn Y` 对不上，测还绿 | Tauri command 名须两端全等；目标仓自测可包庇 | SoCai `check-source-contract.sh` kind=tauri-command |

## socai / protocol

| 症状 | 根因 | 验证手段 |
|------|------|----------|
| 脏树 `/socai auto` 收尾把无关 WIP squash 灌进 main | 开工未钉 baseline / merge target，默认 squash 回 main 且 auto 旧语义「高风险才 pause」 | `node --test test-fixtures/protocol-baseline.test.mjs`；progress.md 须有 `baseline=` + `merge=` |
