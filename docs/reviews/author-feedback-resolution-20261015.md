# GitHub 作者反馈处理记录（2026-10-15）

本次处理用户明确授权的“该回复的回复，该修复的修复，该关闭的关闭”。所有修复、目录更新及联系计划均为**本地结果**。尚未创建 PR、推送、合并、部署、发送回复、预约联系名额或关闭 Issue。

基线：`9f0da97f2a8f4feda8f050616199f97cb37a3582`；分支：`codex/resolve-author-feedback-20261015`。最新只读预检仍须在实际发送前重新执行；每次发送以中央 ledger CAS 和 main 上精确计划为准。

## 已完成的本地修复

- 扫描引擎升级为 bounded-source-v3：声明模块扩展替换、缺失运行模块导致覆盖不完整、JSONL 有界扫描、NOTICE/UPSTREAM_LICENSE 按潜在源码扫描。
- 支持合法的 indentless YAML 插入序列；继续拒绝标签、选择器、歧义操作及未获支持的多 Patch。
- 身份迁移绑定原身份哈希和精确 Commit 对；跨仓库迁移核对不变仓库 ID 和相同 owner ID；排除仓库不再被后续自动扫描重新启用。
- 新增只关闭 Issue 的专用发送器和 main-only 工作流；继续使用同一个全局联系 ledger，先预约后单次 PATCH，未知投递不重试。回复发送器增加原请求更新时间校验。

## 目录更新

18 个既有条目刷新，其中 5 项身份迁移；2 个候选移除；Vision Bridge 另作永久下架。共有 28 个反馈目标，其中 25 个进行了固定源码有界审查，并分别记录完整或不完整覆盖。安装、Profile、宿主启动、安全运行验收均未执行。

| Issue | 条目 / 版本 | 本地决定 | 后续联系 | 证据与剩余条件 |
| --- | --- | --- | --- | --- |
| [#1411](https://github.com/AI-Scarlett/DSH-Store/issues/1411) | `dsh-dream-skin` 10.15.0 | blocked | 已准备一次定向回复 | 类型声明、locale/NOTICE 覆盖已修正；仍需 files/network 与动态 require 的能力审阅。 |
| [#1390](https://github.com/AI-Scarlett/DSH-Store/issues/1390) | `dsh-qwen-paint` 0.17.1 | blocked | 已准备一次定向回复 | 记录精确拒绝结论：可配置 comfyUrl 未强制 localhost 边界，hipfire 子进程继承宿主环境。 |
| [#487](https://github.com/AI-Scarlett/DSH-Store/issues/487) | `dsh-blender` 0.2.3 | blocked | 无新联系计划 | 完整覆盖当前打包源码；命令执行、文件和外部程序能力仍需审阅。 |
| [#636](https://github.com/AI-Scarlett/DSH-Store/issues/636) | `dsh-memory-gate` 0.13.2 | blocked | 已准备一次定向回复 | 已刷新固定 Commit；Patch 中的 JS 标签及运行依赖仍阻塞。 |
| [#1336](https://github.com/AI-Scarlett/DSH-Store/issues/1336) | `dsh-pdf-reader` 0.1.3 | blocked | 已准备一次定向回复 | 确认参数数组、shell:false、超时/输出限制、临时目录清理和环境白名单；本机处理器及动态链接信任仍未知。 |
| [#1354](https://github.com/AI-Scarlett/DSH-Store/issues/1354) | `dsh-prompt-zh` 1.3.0 | blocked | 无新联系计划 | 已刷新源码；缺少明确 DSH 兼容声明，文件/网络能力待审。 |
| [#1173](https://github.com/AI-Scarlett/DSH-Store/issues/1173) | `dsh-cc-studio` 0.8.2 | blocked；身份迁移 | 已准备一次定向回复 | 迁移 scoped 包名；多 Patch 数组尚不符合当前单 Patch 契约。 |
| [#934](https://github.com/AI-Scarlett/DSH-Store/issues/934) | `dsh-auto-paste` 0.2.4 | blocked | 已准备一次定向回复 | 更正虚构的凭据/外部依赖字段；保留真实文件写入，运行依赖 zod 仍需审阅。 |
| [#1016](https://github.com/AI-Scarlett/DSH-Store/issues/1016) | `tonydua-dsh-web-search-exa` 0.2.3 | blocked | 无新联系计划 | 已刷新源码；运行依赖与网络/凭据能力仍需审阅。 |
| [#1071](https://github.com/AI-Scarlett/DSH-Store/issues/1071) | `dsh-portable-tavern` 0.4.1 | blocked；身份迁移 | 无新联系计划 | 许可证身份迁移为实际 MIT；能力审阅尚未完成。 |
| [#1185](https://github.com/AI-Scarlett/DSH-Store/issues/1185) | `math-research-dsh` 2.0.3 | blocked | 无新联系计划 | 已刷新源码；部分打包格式未获扫描器支持，覆盖不完整。 |
| [#1321](https://github.com/AI-Scarlett/DSH-Store/issues/1321) | `dsh-wechat` 0.1.41 | blocked | 已准备一次定向回复 | 源码覆盖完整；分发脚本及能力待审，未验证真实宿主启动。 |
| [#998](https://github.com/AI-Scarlett/DSH-Store/issues/998) | `dsh-keys-setting` 0.2.6 | approved | 无新联系计划 | 固定源码能力审阅通过，user-reviewed；服务端拒绝请求检查与枚举字段边界已读；未验证运行。 |
| [#1296](https://github.com/AI-Scarlett/DSH-Store/issues/1296) | `dsh-connection-card-host` 1.0.76 | blocked；身份迁移 | 已准备一次定向回复 | 迁移到 stable 仓库并保留条目历史；能力与动态加载审阅待完成。 |
| [#1227](https://github.com/AI-Scarlett/DSH-Store/issues/1227) | `dsh-message-recall` 0.2.1 | blocked | 已准备一次定向回复 | 精确拒绝：已读路由本身未建立调用者对传入 sessionId 的授权边界；未复现整机漏洞。 |
| [#1013](https://github.com/AI-Scarlett/DSH-Store/issues/1013) | `dsh-client-ui-skin-air` 0.2.6 | approved；身份迁移 | 已准备一次定向回复 | 迁移 canonical 仓库及 CC-BY-SA-4.0 许可，固定源码准入通过，source-verified。 |
| [#1195](https://github.com/AI-Scarlett/DSH-Store/issues/1195) | `dsh-asuka-school-theme` 3.2.2 | blocked | 已准备一次定向回复 | 已刷新完整源码；运行依赖供应链与文件/资源路由能力仍待审。 |
| [#1279](https://github.com/AI-Scarlett/DSH-Store/issues/1279) | `moguiyu-dsh-tool-tavily-search` 0.3.6 | blocked；身份迁移 | 无新联系计划 | 迁移包路径、包名和入口 ID；合法 indentless YAML 已支持，能力仍待审。 |

## 其他目标与关闭请求

| Issue | 本地处理 | 联系边界 |
| --- | --- | --- |
| [#1415](https://github.com/AI-Scarlett/DSH-Store/issues/1415) | 已修正插入入口/覆盖目标分类；无既有目录记录。当前源码仍缺声明的 lib 产物并有运行依赖 | 准备一次针对原请求的回复 |
| [#1374](https://github.com/AI-Scarlett/DSH-Store/issues/1374) | 当前源码覆盖不完整；不增加整目录测试豁免或合成密钥自动豁免 | 无新联系授权 |
| #1364 / #1365 / #1367 / #1368 | Akasha 四个包分别检查，未新增可安装条目 | 同一作者按不变用户 ID 去重，不重复联系 |
| [#1345](https://github.com/AI-Scarlett/DSH-Store/issues/1345) | 已读取 packages/service；生成运行产物/声明缺失，保持待定 | 不变用户 ID 59874469 未见于已导入 ledger；禁止联系 |
| [#574](https://github.com/AI-Scarlett/DSH-Store/issues/574) | Vision Bridge 按作者 EOL 请求永久 unlisted / external-only，加入排除策略 | 不发送额外通知 |
| [#709](https://github.com/AI-Scarlett/DSH-Store/issues/709) | Agent_Extensions 移出候选；作者明确要求排除并关闭本整改通知 | 准备 close-only，not_planned，无评论 |
| [#1338](https://github.com/AI-Scarlett/DSH-Store/issues/1338) | 作者明确请求 close | 准备 close-only，not_planned，无评论 |

[PR #1427](https://github.com/AI-Scarlett/DSH-Store/pull/1427) 的候选排除改动已纳入本地变更；该 PR 仍开放，未产生任何合并或关闭通知。

12 条回复位于 `registry/author-replies/feedback-*-20261015.json`；2 条关闭计划位于 `registry/author-closures/`。每条计划绑定请求用户 ID、comment ID、原文哈希、更新时间和具体请求引文。回复描述合并后的目录结果，因此必须先发布源码与目录，再发送。感谢、表情、代码已修改、新提交等不产生继续联系授权。

## 验证与发布边界

- 完整 `npm run check`：432 项通过，0 失败；联系与关闭专项：24 项通过。
- Registry：805 条；bridge 2,081,178 bytes，index 615,021 bytes，805 个详情。
- 静态商店构建通过：805 条。最初将输出写到仓库外，被构建器路径限制拒绝；改为仓库内临时路径构建后已通过，产物另存于临时证据目录。
- 所有 8 个 approved 条目的固定源码检查通过；无第三方代码执行。
- 联系只读预检：14/14 通过，核验时间 `2026-10-15T13:19:49.521Z`，完整 ledger 共 843 人，blob SHA `ae52edc4e1793fadf39090ff5334eb96f6849bc5`；预约/发送均为 0。发送前仍须复核。
- 真实 DSH 安装、Profile 修改、宿主重启和 UI 验收：未执行。
- GitHub/Pages/两站生产读回：未执行，因为本地变更尚未发布。

当前 gh 有效凭据类型为 OAuth，服务端未报告到期时间，无法确认是短期令牌；本机已知授权入口未配置 GitHub App 的短期写入绑定。仓库 AGENTS.md 第 1 条要求 “use a short-lived GitHub token”，所以停在远端写入之前。用户的执行授权已记录，无须重复请求批准。

取得符合规则的短期写入凭据后，剩余顺序为：刷新 main 并重建任何失效的计划；创建审计 PR；等待 CI 并合并精确受检头；验证 Raw、Pages 及两站；按 main-reviewed 计划逐条调度回复/关闭流程，执行前重新核验请求并中央 CAS 预约；逐条读回。任何投递不确定性都永久消耗该次预约，不重试消息。

机器记录：`docs/reviews/author-feedback-resolution-20261015.json`。精确文件计划：`docs/ops/author-feedback-resolution-20261015.json`。回滚源码通过新 PR；联系 ledger 永远不恢复旧版或删除预约。
