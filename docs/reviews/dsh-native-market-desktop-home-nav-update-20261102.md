# DSH Desktop 首页插件商城入口与更新结果修正

## 截图结论

截图中的操作由 DSH Desktop 自带的插件管理器执行。`pnpm add` 已结束；依赖变更显示 `dsh-safe-plugin-manager` 从 `0.9.23` 更新到了 `0.9.25`。随后 DSH 插件管理器报“无法从依赖变更中确定安装了哪一个包”。这说明包已被更改，但 DSH 没能把依赖差异映射回目标插件，属于 DSH 宿主结果识别的误报。错误字符串存在于 DSH Desktop 自带的 `@deepseek-ai/dsh-client-ui-plugin-manager`。

这条原生安装对话框不由 DSH Store 插件绘制，Store 源码不能修正它。当前 Store 页面可做的修正，是把 DSH 的精确安装清单作为结果依据：用户从商城页更新 Store 时，若 DSH 返回无变更/失败但清单已显示目标版本、仓库和完整 Commit，就显示已更新；清单不吻合或读取失败时保留失败/未知状态，不重试。不会把这个 Store 页面内的修正描述为 DSH 原生安装器已经修复。

## Desktop 首页左侧入口

DSH `0.2.2-alpha.2` 的公开 Client API 提供 root `main` keyed Slot 和 `sidebar.panellist` list Slot。侧栏项目的 `id` 与 `main` 的 `key` 相同即可成为首页左侧独立面板。

本变更只在官方 `dsh-app:` renderer 注册 `dsh-store` 面板和“插件商城”侧栏项，并保留设置中的原入口。面板复用现有 Desktop 只读商城 UI，官方“插件”面板保持原样。证据：[ui-layout 合约](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/client/ui-layout/README.md)、[ui-sidebar 合约](https://github.com/deepseek-ai/deepseek-harness/blob/ce7073d51254c26cd63b22a60835b8f948deb447/packages/client/ui-sidebar/README.md)。

## 商城发起的 GitHub 固定 Commit 更新

- 普通第三方 GitHub 插件按 DSH 官方 Plugin Manager 的流程先 `removeBundle()`，再提交 `installBundle()` 固定目标 Commit。DSH 的 `stop-profile` 特殊结果按官方管理器处理，仍继续提交安装。`applied` 和 `restart-required` 均按 DSH 成功结果处理。
- 更新 DSH Store 自身时不先移除 Store。DSH 官方 `installBundle()` 接收完整固定 Commit；如果返回无变更/失败/未知，商城等待已有请求一次，并用 DSH `listBundles()` 核对目标版本、包名、仓库和完整 Commit。只有四项完全吻合才显示目标已安装。
- 普通插件更新遇到明确失败时，商城核对原 Commit 是否仍保留；若包已移除，才经 DSH 尝试恢复原固定来源。遇到不确定结果不重提请求。
- Catalog 风险/兼容建议和 `inspect()` 只用于提示。用户确认后，由 DSH 官方管理器执行并返回最终结果。

## 范围与边界

- 新增 DSH Desktop 首页侧栏入口，保留设置入口。
- Store 自身不走卸载路径；普通插件不以 Store 的 `removable` 推断 DSH 是否允许更新，最终由 DSH 决定。
- 不修改 DSH 源码、任何 `@deepseek-ai/*` 包、官方插件清单或真实 Desktop Profile；不调用 Loader/Fiber API。
- Catalog 固定版本只在源代码合并后通过新的专用计划更新；源 PR 不代表 Catalog、Pages 或生产商城已发布。

## 评审判定

- **Host 适配：** compatible。只使用 DSH Desktop 的公开 root `main`、`sidebar.panellist` Slot 和官方 `pluginManager` Remote；不修改 Host 或官方包。
- **风险等级：** R3。商城更新会修改 Desktop Profile 包状态，因此要求用户输入完整包名与 40 位 Commit，并把事务交给 DSH 官方管理器；本次仓库修改本身不写入真实 Profile。
- **自动化证据：** E2。客户端夹具覆盖侧栏注册、普通插件更新、商城自更新、DSH 拒绝与重启待应用、精确清单确认、失败恢复和不确定结果不重试。
- **真实 Desktop：** 未验证。必须在单独授权的 Desktop Profile 操作后检查可见侧栏、固定来源和重载结果。

| decision | objective | benefit | cost | evidence | reconsider when |
| --- | --- | --- | --- | --- | --- |
| 注册首页侧栏面板并保留设置入口 | 缩短商城入口路径 | 桌面首页可直接打开商城，老入口仍可用 | 依赖 DSH Desktop 的公开 Slot | 固定官方源码合约与 Desktop 夹具 | DSH 更改 `main` 或 `sidebar.panellist` 合约 |
| 将最终安装与更新判断交给 DSH | 避免 Store 预检误挡官方安装 | DSH 官方检查包兼容性并执行 Profile 事务 | DSH 明确失败时需保留旧来源或显示未知状态 | 固定 Commit 安装/更新夹具及拒绝路径 | DSH 更改 `inspect`、`installBundle` 或 `removeBundle` 语义 |
| Store 自更新跳过卸载，失败后只做精确回读 | 避免自更新先移除正在运行的商城 | 精确版本、仓库、Commit 一致才显示成功；未知时不重提 | DSH 无法确认时需要用户检查状态 | 自更新误报夹具、未知结果夹具 | DSH 提供专用固定来源更新接口 |

## 验证状态

- 官方 latest-three：通过实时解析器确认是 `0.2.1-rc.4`、`0.2.1-rc.5`、`0.2.2-alpha.2`。
- Desktop 夹具：通过，36/36；全量 `npm run check` 通过，Registry 为 874 条，测试为 583/583。
- 语法、`git diff --check`：通过。`npm pack --dry-run --json` 通过，预览包为 `dsh-safe-plugin-manager@0.9.26`、1,074 个文件、8,517,353 bytes。
- typed plan 哈希：已绑定本次 base 与 10 个精确文件，`DSH_UPGRADE_PLAN_OK`；PR CI 待远端 exact-head 检查。
- Catalog pin、Pages、`dsh.store`、`dsh-store.cn`：待源码 PR 合并后通过独立 Catalog 计划发布和逐面回读。
- 真实 DSH Desktop 侧栏、Profile 安装及重载后 UI：未验证；本计划不改真实 Profile。
- DSH 原生插件安装对话框的 `reasonAmbiguousInstall`：本仓库无法修改；截图显示 DSH 命令已更改到 `0.9.25`。商城页面可以用 DSH 安装清单核验商城发起的更新，但不会修复原生对话框本身。

## 回滚

通过 CI 检查的 PR 回退 Store 源码。本变更不触碰本机 Desktop Profile。真实 Desktop 更新仍由 DSH 官方管理器执行；不确定的请求不自动重试。
