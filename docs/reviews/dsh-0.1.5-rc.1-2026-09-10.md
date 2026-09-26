# DSH 0.1.5-rc.1 compatibility audit — 2026-09-10

官方目标为 `deepseek-ai/deepseek-harness` tag `dsh-v0.1.5-rc.1`，Commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`。npm `@deepseek-ai/dsh` 的 `latest` 与 `next` 均已发布 `0.1.5-rc.1`；官方最新三个版本窗口为 `0.1.5-alpha.1`、`0.1.5-alpha.2`、`0.1.5-rc.1`。

DSH STORE 使用公开的 `webServer` 注入、`settings.section`、`settings.plugins.tab`、`shell.overlay`、runtime 状态和官方 CLI seam。RC.1 的 Session V3、SessionHandle、Inbox 类型化、移除 `ctx.agent` 以及 `main` / `sidebar.panellist` 面板注册变更不经过本 Bundle 的实现路径；商城自身没有读取 Session persistence、Inbox 或 Agent API，也没有使用旧的 `conversation` Slot。RC.1 的 Web 入口和客户端 UI 包已通过包名、Patch、入口 ID、静态契约与版本范围复核。

本次源代码升级将商城包提升到 `0.8.17`，明确声明 `0.1.5-rc.1` 兼容，并将已发布的 `dsh-client-ui-primitives`、`dsh-client-ui-settings`、`dsh-client-ui-slots` peer 范围固定到 RC.1。`dsh-client-runtime` 没有发布同名 RC.1 包，继续使用其现有的 `0.1.x` 兼容范围，没有声明不存在的版本。Node.js 要求与官方 RC.1 的 `^22.19.0 || >=24.0.0` 保持一致。

验证范围为源码和自动化契约；未执行真实 DSH Profile 安装、`~/.dsh` 写入、重启、浏览器 UI 回读或生产站点刷新。Catalog 自身条目将在源 PR 合并后通过固定 Commit 的自动 Catalog 事务更新，不能把源 PR 视为已经完成自 pin。
