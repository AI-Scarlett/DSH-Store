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

### dsh-market/dsh-market

当前 `main` 为 `beb8576cebc48c0982321d547d67c0d15522b07b`。其市场体验和
`awesome-dsh-plugin` 目录关系证明社区已有较大规模的 GitHub 插件发现需求；本项目
不复制其实现，而是采用更小的、固定 Commit 的自有目录，并把每次写入纳入事务。

### awesome-dsh-plugin/awesome-dsh-plugin

当前 `main` 为 `219bdf0143e655118175bd42b6a71106bc745649`。该项目是 GitHub
社区目录和数据采集来源，且明确警告目录收录不等于安全审计。本项目沿用这一风险
边界，但不直接把其全部条目当作可安装白名单。

### LX2000WASD/dsh-web-plugin-manager

功能覆盖查看、启停、安装、更新、健康检查和市场，设置 Slot 与路由结构有参考价值。
其 Bundle 会禁用官方只读插件清单，并包含 Loader 实时应用、文件写入和命令执行等
高权限路径；这些行为不进入本项目首版。

### hrhgit/deepseek-harness-plugin-manager

当前 `main` 为 `ba682b78d11741e86e100575169044b95ebaa3db`。其固定目录、
manifest 校验和 GitHub Topic 采集为数据模型参考；本项目不复制其 npm 安装路径，
所有目标都必须是 GitHub 仓库固定 Commit。

### MAXeaglet/dsh-plugin-manager

Profile 发现、Bundle/依赖归并和来源分类值得参考，但产品是桌面 GUI + CLI + 独立
Web UI，并直接读写 Profile；桌面端、进程管理和外置恢复不符合本项目范围。

## 产品决策

1. 只做标准 DSH 插件，不做桌面端、CLI 或独立服务；
2. 默认查看/搜索/计划只读，并保留官方只读清单；
3. Bundle、Host、Client 三层分离，Host 入口保持薄；
4. 声明态与运行态分开，不把 Bundle 记录当成“正在运行”；
5. GitHub 目录与写入引擎分模块，目录失效不得产生未知安装目标；
6. 写入能力已获批准，但每次仍需独立计划、精确确认、备份、健康检查与回滚。

## “热门 DSH 插件推荐”清单核验

根据用户指定的 ChatGPT 会话清单核对 20 个 GitHub 项目。这里的“同类型排除”只指
与 `AI-Scarlett` 自研的商城管理、会话导入、CLIAPI、本地/多模态模型路由四类主功能
重合；没有因为社区插件彼此功能相近而排除项目。核验结果如下：

- 5 个仓库已在目录中，沿用现有条目：Better Sidebar、Vision Toolkit、Agent Teams、
  Notification、Ads；
- 11 个新增项目通过固定 Commit 的 manifest、Bundle Patch、入口 ID 与生命周期脚本
  复核，作为可安装条目上架：At File、GenUI、Visualize、OpenPencil、AnySearch、
  Gomoku、Web UI All、Shortcuts、Diagram、Egress Guard、Achievements；
- 3 个项目分类展示但策略阻止：Memory Evolve 缺少 `dsh.bundle.patch`，DSH TUI 是
  会覆盖/停用基础 Profile 行的独立终端入口，Explorer 需要 Host 与浏览器两个 Bundle
  原子联装而当前目录只支持单包事务；
- `Small-tailqwq/dsh-deep-whale` 与目录中已有的 Deep Whale Day Night Theme 声明相同
  包名 `@dsh-external/dsh-client-ui-skin-maid-atelier`，会造成安装和更新身份冲突；目录
  保留现有的较高版本条目，不生成第二张重复卡片。这是包身份去重，不是功能类型排除。

新增项目均未设置 `featured`。推荐标记继续只属于 `AI-Scarlett` 自有四个插件。
