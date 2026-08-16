# 研究结论

研究日期：2026-08-16。

## 已确认的 DSH 扩展机制

- Profile 位于 `$DSH_HOME/profiles/<name>`，`package.json` 的
  `dsh.profile.bundles` 决定 Bundle 层顺序；
- 外部 Bundle 在包 manifest 中声明 `dsh.bundle.patch`；
- 官方 `dsh plugin --profile <name> ...` 把包管理操作转发给 Profile 中的 pnpm，
  并在成功后协调 Bundle 列表；
- Host 插件可使用 `ctx.inject(['webServer'], ...)` 等待可选 Web 服务；
- Client 插件通过 `window.__ModuleLoader__.load()` 注册，通过 Slot 扩展设置页面；
- 官方 Plugin Inventory 是 Loader 树的只读运行态投影，不提供来源、历史或变更能力。

这些结论已与本机 DeepSeek Harness 源码
`47f943859bef60e4160492346772ded9b24f765a` 及当前运行的 `web` Profile 结构核对。

## 参考项目取舍

### AI-Scarlett/dsh-chat-import

采用薄 `index.mjs`、Bundle Patch、可选 Web 路由和 Client ModuleLoader，证明纯插件形态
可以在不修改 DSH 源码的前提下增加 Host 与 Web 能力。本项目采用同类扩展边界，
但不复用其会话读写功能。

### LX2000WASD/dsh-web-plugin-manager

功能覆盖查看、启停、安装、更新、健康检查和市场，设置 Slot 与路由结构有参考价值。
其 Bundle 会禁用官方只读插件清单，并包含 Loader 实时应用、文件写入和命令执行等
高权限路径；这些行为不进入本项目首版。

### MAXeaglet/dsh-plugin-manager

Profile 发现、Bundle/依赖归并和来源分类值得参考，但产品是桌面 GUI + CLI + 独立
Web UI，并直接读写 Profile；桌面端、进程管理和外置恢复不符合本项目范围。

## 产品决策

1. 只做标准 DSH 插件，不做桌面端、CLI 或独立服务；
2. 首版只读，并保留官方只读清单；
3. Bundle、Host、Client 三层分离，Host 入口保持薄；
4. 声明态与运行态分开，不把 Bundle 记录当成“正在运行”；
5. 更新检测与写入引擎分里程碑开发；
6. 写入能力必须另行批准，默认关闭，并具备事务与回滚。

