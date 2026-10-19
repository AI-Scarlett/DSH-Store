# 2026-10-19 外部动态固定源复核（续）

基于最新 `main` `590dbd6e22366e3dbe12b39a21b773ff5b85f939`，复核 2026-10-18T01:05:14Z 之后的三条新动态。每个不可变提交均按 `bounded-source-v3` 完整有界扫描；未运行第三方插件、依赖、安装、构建或测试脚本，也未改真实 DSH Profile。

当前 DSH 官方最新三版窗口：`0.2.1-alpha.5`、`0.2.1-rc.1`、`0.2.1-rc.2`。作者提供的运行验收不作为 Store 自己的安装或运行通过。

## #1445 — RZRZ-Q / dsh-more-details 0.3.14

请求：[评论 6248864932](https://github.com/AI-Scarlett/DSH-Store/issues/1445#issuecomment-6248864932)，正文 SHA-256 `dc1cd9968639b31d1f3d22a88ac9a7e76d7d5ebfcd9c395ffd92ccb7f728c38f`。固定 Commit：[`374b66c5ddd295e410bc216c17223df3a6fa1e08`](https://github.com/RZRZ-Q/dsh-more-details/commit/374b66c5ddd295e410bc216c17223df3a6fa1e08)。完整扫描 129/129 个文件、661,327 字节，source digest `bfd22e1e917eef81a146c667a5cad44b69d9781d9d35abd2421f4597868d0018`；静态安全规则通过，无 findings。与 0.3.13 比较 19 个文件，`src/` 与 `lib/` 未变；本次仍按 0.3.14 固定树审阅。

**准入通过，目录草案为 `approved` + `user-reviewed`。** manifest 明示的 `0.2.0-rc.2`、`0.2.1-alpha.4`、`0.2.1-rc.2` 为 compatible。当前最新三版中只有 `0.2.1-rc.2` compatible；`alpha.5` 与 `rc.1` 保持 unknown。MIT 在固定 manifest 和 LICENSE 中核实。

凭据扫描信号是真实能力，不是误报。固定源 [credential store](https://github.com/RZRZ-Q/dsh-more-details/blob/374b66c5ddd295e410bc216c17223df3a6fa1e08/lib/host/webchat-login-store.js) 只通过 `credentialKey('dsh-more-details','webchat')` 读取、保存和删除本插件自己的 DSH 凭据记录。记录可包含官网 `userToken`、userInfo、设备 ID 与可选语言偏好。[登录 helper](https://github.com/RZRZ-Q/dsh-more-details/blob/374b66c5ddd295e410bc216c17223df3a6fa1e08/lib/client/webchat/login-page.js) 检查精确 `https://chat.deepseek.com` origin，再读取或恢复这些官网存储值。已披露的 `webview.executeJavaScript` 页面脚本能力保留。引用快照通过 DSH attachments 保存和读取，且有大小限制；用户触发发送网页消息或选中文字时，相关内容才会交给官网或用户选择的模型服务。

Catalog 声明 high 权限、文件 write、specified-services 网络、无命令、credentials `web-session-token`。作者提供的多版本测试与 macOS arm64 Desktop 行为仍是作者证据；Store installability、runtime、独立安全审计保持 unknown。

## #1489 — aikunx / dsh-mt-mcp 0.1.0

新投稿：[Issue #1489](https://github.com/AI-Scarlett/DSH-Store/issues/1489)。自动评论[固定源码读取通过](https://github.com/AI-Scarlett/DSH-Store/issues/1489#issuecomment-6251965919)只表示扫过 4/4 个文件且没有启发式 findings，不是最终准入。固定 Commit：[`ef902623eb1cd1811be60a6d6130d8c6ed9f4c40`](https://github.com/aikunx/dsh-mt-mcp/commit/ef902623eb1cd1811be60a6d6130d8c6ed9f4c40)。完整扫描 4/4、32,936 字节，source digest `76bc18bbc35030e09477c640ebc16cd2e05cdb51914402eb43ce2d5762b4f9eb`；静态安全规则通过，无 findings。

**拒绝准入，不建 Catalog 条目。** 原因与最低修复：

- `COMPAT001` — [package.json:29-53](https://github.com/aikunx/dsh-mt-mcp/blob/ef902623eb1cd1811be60a6d6130d8c6ed9f4c40/package.json#L29-L53) 没有 DSH 兼容声明。补充精确的 DSH manifest/peer 版本；验收至少一个当前最新三版有精确 compatible 声明与有界临时宿主证据，未测版本保持 unknown。
- `DEPENDENCY001` — [package.json:51-53](https://github.com/aikunx/dsh-mt-mcp/blob/ef902623eb1cd1811be60a6d6130d8c6ed9f4c40/package.json#L51-L53) 声明浮动运行依赖 `@modelcontextprotocol/sdk@^1.12.0`，固定树没有唯一 lockfile。锁定完整依赖闭包，并提供不可变包完整性、许可、传递依赖和生命周期证据。
- `AUTH001` — [lib/index.js:182-186](https://github.com/aikunx/dsh-mt-mcp/blob/ef902623eb1cd1811be60a6d6130d8c6ed9f4c40/lib/index.js#L182-L186) 只验证 HTTP(S) 和 `/mcp` 后缀，允许任意 host；[lib/index.js:335-338](https://github.com/aikunx/dsh-mt-mcp/blob/ef902623eb1cd1811be60a6d6130d8c6ed9f4c40/lib/index.js#L335-L338) 把配置的 Bearer token 发往该 host。应将 token 绑定到单独明确批准的 exact origin，拒绝 origin 变化和跨域 redirect，或移除 token 能力。验收用隔离传输夹具证明未批准 host、origin 切换、redirect/DNS 变化及格式错误都不会收到 token。

## #1490 — dsh-ledger-memory 1.2.8 更新 PR

[PR #1490](https://github.com/AI-Scarlett/DSH-Store/pull/1490) 当前只改 `registry/catalog/details/dsh-ledger-memory.json` 两个字段（+2/-2），没有 review、评论或 checks。固定源码提交：[`51e5b2bfad2e9fb6455e9432b2dbecc9c7082c24`](https://github.com/18477514055/dsh-ledger-memory/commit/51e5b2bfad2e9fb6455e9432b2dbecc9c7082c24)。完整扫描 11/11、1,481,050 字节，source digest `a991938e2ef451600a3f15971a26e3ce4a36d44a1aa320a566e2bc90ce7a694e`；两个 child-process findings 是静态警告，代码路径已另行审阅。

**拒绝 1.2.8 更新，Catalog 保留 1.2.7 / `cb397a780f0cab4838ce5b3baf17abb08f1c3c78`。** [lib/part2.js:2084](https://github.com/18477514055/dsh-ledger-memory/blob/51e5b2bfad2e9fb6455e9432b2dbecc9c7082c24/lib/part2.js#L2084) 以默认 mode 建立临时文件；[2095](https://github.com/18477514055/dsh-ledger-memory/blob/51e5b2bfad2e9fb6455e9432b2dbecc9c7082c24/lib/part2.js#L2095) 先 rename 覆盖目标；[2104-2109](https://github.com/18477514055/dsh-ledger-memory/blob/51e5b2bfad2e9fb6455e9432b2dbecc9c7082c24/lib/part2.js#L2104-L2109) 只在之后可选 chmod 并吞掉错误。umask 022 下新文件可能为 0644；替换原 0600 私有文件也会换成权限更宽的 inode。

最低修复：敏感新文件默认 0600；替换已有文件时按需保留已有 mode；rename 前给临时 inode 设置并核验 mode；mode 设置失败时拒绝替换并保留旧目标。验收在 disposable 夹具和 umask 022 下覆盖新建、替换 0600、显式 mode、write/rename/chmod 错误、无宽松权限窗口、临时文件清理，以及失败时旧内容不变。

凭据扫描信号在 `lib/index.js:773` 对应 `LEDGER_DIAG_D115` 诊断环境开关，已用该固定文件 SHA 记录为 false-positive disposition，不影响拒绝决定。

## 联系与发布门

中央 ledger 历史完整，当前 `ai-scarlett/dsh-store` 有仓库级禁止联系规则（branch blob SHA `5e1583501625ccc2b470d77254d39a0016adb0d5`）。#1489 与 #1490 作者已有保留记录；#1445 作者不在账本中，仓库级阻断同样适用。因此本轮不发 Issue/PR 回复或 review、不加 reaction、不关闭任何 Issue/PR；四条暂缓计划保持 untouched。仅通过一个有 CI 的审计 PR 提交 Store 自身记录与目录变更。合并后只核 GitHub 与 Pages，不连接 `dsh.store`、`dsh-store.cn` 或生产刷新单元。
