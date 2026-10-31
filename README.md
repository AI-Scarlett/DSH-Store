# DSH STORE | DeepSeek Harness Plugin Marketplace
<img width="900" height="383" alt="cover_dsh_plugin_market_900x383" src="https://github.com/user-attachments/assets/2b03ff48-a39b-427d-87c1-62190560a496" />

DSH STORE is a third-party DeepSeek Harness (DSH) plugin marketplace and guarded lifecycle manager. It is the canonical project behind [dsh.store](https://dsh.store/), where users discover plugins, inspect pinned sources and permissions, and follow a recoverable access path.

DSH STORE 是一个运行在 DeepSeek Harness（DSH）设置页中的第三方
插件商城与安全生命周期管理器。它使用标准 DSH Bundle + Host Plugin + Client Bundle
结构，不开发独立桌面端，不修改 DSH 源码，也不替换任何 `@deepseek-ai/*` 官方包。

> **想把插件上架到 DSH-Store？** [提交一个公开 GitHub 项目地址](https://github.com/AI-Scarlett/DSH-Store/issues/new?template=plugin-submission.yml) 即可。机器人会自动读取必要文件，不再要求手填整份 Catalog。开发或提交前，建议先用 [`build-dsh-plugin`](https://github.com/AI-Scarlett/build-dsh-plugin) 制作或执行只读商城预检。

[打开在线插件商城](https://dsh.store/) ·
[阅读项目 Wiki](https://github.com/AI-Scarlett/DSH-Store/wiki) ·
[提交项目上架](https://github.com/AI-Scarlett/DSH-Store/issues/new?template=plugin-submission.yml) ·
[使用 build-dsh-plugin](https://github.com/AI-Scarlett/build-dsh-plugin) ·
[查看机器目录](registry/catalog.json) ·
[目录准入规则](registry/README.md) ·
[安全说明](SECURITY.md)

> **旧版更新安全修复：** 如果商城或其他插件更新出现
> `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`，不要放开整个 Profile 的 `prepare` 权限，也不要手改
> Profile。请通过[国内站](https://dsh-store.cn/repair/)或
> [GitHub Pages](https://ai-scarlett.github.io/DSH-Store/marketplace/repair/)
> 查看官方修复/升级方案；修复页只有在 Catalog 固定到包含修复器的完整 Commit 后才会生成命令。

## 在 DSH 原生「发现」中添加商城

DSH `0.2.1-alpha.4` 新增实验性「自定义插件市场」。在 **插件 → 实验性插件 → 更多** 中打开它，再进入 **发现 → 添加索引源**，填入：

- 国际站：`https://dsh.store/plugin-market.json`
- 国内站：`https://dsh-store.cn/plugin-market.json`
- GitHub Pages：`https://ai-scarlett.github.io/DSH-Store/marketplace/plugin-market.json`

原生索引按官方 `format: 1` 生成，仅包含已批准条目，来源锁定完整 Git Commit；兼容范围只包含 Catalog 明确声明兼容的版本。未知版本不会自动扩大支持范围。发布时间取该固定 Commit 的公开时间。索引会随正式站点每三小时刷新；添加索引源属于当前 Profile，安装仍需核对 DSH 确认框中的来源。关闭实验性市场或删除索引源可撤销接入。

DSH 从此版本优先读取插件的 `engines.dsh`，缺少它时才检查所有 DSH peer。Store 保留逐版本声明与隔离运行证据；范围声明、源码检查和真实 Desktop 验收分别记录。

## 安装插件商城

### 前置条件

- 已有对应版本的安装、启动和卸载证据；只有版本范围或 Peer 声明时仍视为待验证。卸载后的 Profile 还原与版本降级回滚分别验收，`unknown` 不等于通过。Web Profile 的包操作需要官方 `dsh` CLI；
- Node.js `^22.19.0` 或 `>=24.0.0`；
- 一个启用了 Web 客户端的目标 Profile。下面以 `web` 为例，如果你的 Profile 名称不同，
  请替换命令中的 `web`。

首次安装发生在本管理器尚未运行之前，因此还没有计划确认、自动备份、健康检查和失败
回滚保护。运行命令前，请先备份目标 Profile 的 `package.json`、`pnpm-lock.yaml`、
`pnpm-workspace.yaml` 和 `cordis.patch.yml`（文件存在时）。

### 使用固定 GitHub Commit 安装

优先使用上方的原生索引，或从[当前修复入口](https://dsh.store/repair/)核对受审的固定源码。
当前源码版本为 Store `0.9.19`、Commit `81f5d9f708c62595c0907e9978efef7e5278e817`，适配官方 DSH `0.2.1-rc.4`、`0.2.1-rc.5`、`0.2.2-alpha.2`。`0.9.19` 将安装、启动/关闭和卸载入口放在 DSH Desktop 插件详情正文中；兼容性或来源门禁未满足时仍显示禁用状态和原因，实际操作继续由 DSH 官方插件管理器执行。Catalog 仍只声明 `web` Profile，直到真实 Desktop Profile 安装验收完成。
通过 DSH 官方 CLI 安装 Catalog 固定的 `0.9.19` Commit：

```bash
dsh plugin --profile web add --ignore-scripts --config.auto-install-peers=false 'git+https://github.com/AI-Scarlett/DSH-Store.git#81f5d9f708c62595c0907e9978efef7e5278e817'
```

这条命令会修改目标 Profile 的依赖、锁文件、工作区文件、`node_modules` 和 Bundle 列表。
不要把 Commit 换成 `main` 等浮动分支，也不要绕过 DSH CLI 直接运行 pnpm 或手工编辑
Profile。命令失败时请保留完整错误和安装前备份，不要连续重复执行。

历史引导固定点 `git+https://github.com/AI-Scarlett/DSH-Store.git#0bc733064bfc8ff16f6e8144188a7ac563092e12`
对应 `0.8.5`，仅供历史审计；它不是当前安装入口，不能用于 RC.1 / RC.2。

### 重启与验收

1. 运行 `dsh --profile web --dump-config`，确认配置可以成功合成；
2. 在商城中用独立计划安装随包提供的 DSH Guardian；它由 macOS launchd 在 DSH 进程外运行，
   不是另一个普通 DSH 插件。安装器会先验证新 Guardian 的独立心跳，再在 HTTP 响应返回后交接旧
   Host；验证失败会恢复 Guardian 文件且不关闭当前 Host；
3. 包操作完成后，商城会明确标记“待重启”。只有 Guardian 心跳正常时才允许生成一次性的
   `RESTART DSH <profile>` 计划；
4. Guardian 是 DSH web Profile 的唯一启动所有者。启用后不要再手工运行 `pnpm dsh web` 或
   `dsh web`，否则第二个实例会因争抢 `127.0.0.1:3080` 而以 `EADDRINUSE` 退出；
5. Guardian 同时验证首页 HTTP、商城 runtime API、Profile 和 Boot ID；只有身份一致并持续稳定
   30 秒才判定健康。连续探测失败才执行有界重启，5 分钟内最多失败 3 次；
6. 页面检测到新的 Boot ID 后重新读取插件清单与健康报告，只有通过才显示“已重启并生效”；
7. 如果安装、重启或页面显示异常，请在
   [GitHub Issues](https://github.com/AI-Scarlett/DSH-Store/issues) 提交原始错误，
   不要提交凭据、完整 Profile 文件或环境变量。

安装完成后，从商城发起的安装、更新、迁移、停用、启用和卸载才会进入一次性计划、
精确确认、Profile 前置哈希、备份、健康检查和失败回滚流程。

### 官方 Desktop

官方 Desktop 使用独立的 `desktop` Profile 与应用自身的插件管理器。Store `0.9.19` 把入口注册为
设置左侧独立的 `插件商城` 分区；页面标题为 `插件商城（DSH-Store）`，并通过本地化插件元数据显示
`DSH-Store`，保留内部包 ID `dsh-safe-plugin-manager`。商城有界读取公开 Catalog，并通过官方
`pluginManager` Remote 读取 Desktop 已安装清单和当前 DSH 版本。详情、搜索和分类筛选都在商城内提供；
安装要求条目明确声明支持 Desktop Profile，并对当前 DSH 版本声明 `compatible`。安装、卸载和
Bundle 启停通过 DSH 官方 `inspect`、`installBundle`、`removeBundle`、`setBundleEnabled` 执行；每次操作
都显示 Catalog 包名与完整固定 Commit 并要求确认。卸载还要求 DSH 标记该 Bundle 可移除，且本机已安装
来源与 Catalog 仓库一致。启停只使用官方 Bundle Profile Patch 管理接口，不调用 Loader/Fiber API。
超时或结果不确定时商城刷新清单且不会自动重试。所有操作仅针对 DSH 自己的 Desktop Profile，不会误写
`web` Profile，也不会让固定 `3080` 端口的 Guardian 接管 Desktop。实机检查曾在 0.9.18 复现详情页没有操作按钮；0.9.19 已把操作区移入详情正文并通过桌面端内容树测试。0.9.19 尚未在本机 Desktop Profile 安装验收，因此 Catalog 仍只声明 `web` Profile。

## 当前概况

| 项目 | 当前状态 |
| --- | --- |
| 商城版本 | `0.9.19`（本次 Catalog 固定点；真实 Desktop Profile 安装尚未验收） |
| 收录条目 | 以 GitHub `registry/catalog-index.json` 的实时 `entries.length` 为准 |
| 可安装 | 以实时 Catalog 中 `status: approved` 的条目数为准 |
| 商城不可安装 | 以实时 Catalog 中 `blocked` / `unlisted` 的条目数与 `statusReason` 为准 |
| 分类 | 22 个 |
| 推荐 | 商城“只看推荐”与官网推荐榜共享公开作者互动名单，完整分页；推荐不改变审核或安装资格 |
| 目录来源 | GitHub 仓库 + 不可变 Commit |

桌面端目录中的“客户端适配”标识独立展示插件是否声明支持 DSH Desktop；收录不强制要求该声明。标识为已适配不代表当前 DSH 版本兼容，也不代表真实 Desktop Profile 安装已验收。

`0.9.15` 延续官方 DSH 最新三版 `0.2.1-rc.4`、`0.2.1-rc.5`、`0.2.2-alpha.2` 的精确兼容记录。`0.2.1-rc.5` 于 2026-10-29 发布到 npm 的 `next` 和 `latest` 标签，官方 `dsh-v0.2.1-rc.5` GitHub Release 于 2026-10-30 发布。三个注入 UI 客户端包均发布了 `0.2.1-rc.5`，而独立 `@deepseek-ai/dsh-client-runtime` 仍停在 `0.1.1-rc.2`，因此只更新确有发布的三个 UI peer。`0.2.2-alpha.2` 仍是语义版本最高项并要求 Node `>=24.9.0`。隔离 CLI/CI 对已覆盖版本完成安装、启动、卸载和 Profile 还原；降级回滚保持 `unknown`。

官方 DSH `0.2.2-alpha.2` 提供供 Client 使用的 `settings.section`、`pluginManager.listBundles`、`inspect`、`installBundle` 和 `waitForInstall` Remote 契约。Store `0.9.13` 使用独立设置分区、精确版本门控和 DSH 官方安装器；商城仍不接管 Desktop 生命周期，也不把 Web Profile 操作送入桌面环境。真实 DSH `0.2.1-rc.5` 只读验收已确认左侧 `DSH-Store` 独立入口可见；`0.9.14` 未声明 `remote.pluginManager` 模块依赖，导致目录显示 `DESKTOP_PLUGIN_MANAGER_UNAVAILABLE`。`0.9.15` 已补上该依赖声明并通过隔离 Desktop 契约测试，但真实桌面端更新与重启验收仍待完成。Catalog 当前仅声明 `web` Profile。

`0.9.3` 将官方 Desktop 绑定到其实际 Profile，并在服务端拒绝不受支持的商城写入、Guardian 与重启操作；商城界面明确展示只读模式。版本面板从 Desktop 内置的官方 DSH 包读取当前版本，不提供修改桌面应用运行时的 npm 命令。`0.2.0-rc.2`、`0.2.1-alpha.1`、`0.2.1-alpha.2` 已在 PR 的一次性 Web Profile 中完成安装、启动、卸载和精确回滚验证。`@deepseek-ai/dsh-client-runtime` 的 0.2.x 尚无独立 npm 包，但其精确 Peer 版本声明是官方 Host 安装前检查的契约；移除后一次性 Profile 安装在最新三版均失败。源码、Catalog、生产站点和真实 Desktop 界面各自需要独立验收。

`0.8.14` 修复“开发者提交了新代码但没有提升插件版本号”时新用户无法安装新代码的问题：自动任务会把同版本的新 Commit 纳入与正常版本更新相同的固定源、身份、许可证、Bundle、权限和最新三个 DSH 版本兼容审查；通过后移动 Catalog 的完整 Commit 固定点，因此未安装用户会直接安装审核后的新 Commit。已经安装相同版本的用户不会在商城里收到覆盖式更新，商城只展示 Catalog 固定 Commit 与 GitHub 手动命令，并明确说明该操作不受商城备份、健康检查和失败回滚保护。真正提升 SemVer 的版本仍使用商城事务更新。

`0.8.13` 适配官方 DSH `0.1.2` 预发布系列的浏览器令牌认证：Guardian 现在把未认证根路径的预期 `401` 视为 Web 端口存活，但仍必须通过商城运行时接口核对 Profile 与 Boot ID，不能把未知占用者误认成 DSH。当前官方最新预发布版是 `0.1.2-rc.1`，商城按 `0.1.2-alpha.4`、`0.1.2-alpha.5`、`0.1.2-rc.1` 维护动态三版本窗口；没有精确证据的字段保持 `unknown`，不会由版本范围猜测成已验证。无生命周期脚本插件更新保护和独立 launchd Guardian 交接器保持不变。

`0.8.11` 修正分表发布的历史客户端回归：`registry/catalog.json` 继续作为低于 2 MiB 的 schemaVersion 1 兼容桥，但现在为每个索引条目保留旧版验证器、搜索、权限展示和固定来源操作所必需的有界字段；因此尚未升级的 0.8.5–0.8.7 客户端也能看到完整目录，而不是只看到商城自身。长证据摘要、逐版本操作记录和其他详情仍只存放在独立详情文件中。公共 watchdog 同时从详情文件水合商城 Commit，避免把三个正常修复入口误报为失败。

兼容桥会省略旧版验证器可准确还原的空 `unknown` 证据记录；仅当完整目录逼近 2 MiB 上限时，按固定级数减少旧客户端的搜索别名。每条插件的身份、状态、原因、兼容性、权限和固定 Commit 仍保留，v2 索引与详情继续保存完整搜索词及证据。超出上限且无法安全压缩时自动化仍会停止，不发布截断目录。

`0.8.9` 把 Catalog 分成三层：`registry/catalog.json` 是旧版兼容桥，并用 `indexPath`、SHA-256、字节数和条目数固定下一层；`registry/catalog-index.json` 是完整轻量主索引，只承载插件编号、中英文名称、版本、推荐标记、顺序、GitHub 地址及有界分页辅助字段；`registry/catalog/details/<插件编号>.json` 保存权限、兼容性、完整证据和安装信息。新商城验证桥接摘要后读取索引，并且每页只懒加载 20 个详情；桥、索引或详情身份不一致时失败关闭，不会混用远程索引与本地详情。兼容桥和主索引上限均为 2 MiB，单详情上限为 512 KiB。`0.8.8` 先把旧的单体 Catalog 读取上限有界提高到 4 MiB，作为迁移过渡。

`0.8.10` 为历史安装增加 Catalog 固定的官方安全修复器和双站 `/repair/` 页面。修复器只接受
完整 Git Commit 和交互式确认，备份 Profile 后通过官方 DSH CLI 使用
`--ignore-scripts` 更新，不执行任何第三方生命周期脚本；配置合成失败会恢复 Profile 和依赖。
Guardian 可用时，修复器会写入可回滚冷启动记录、请求重启并等待新的 Boot ID 稳定；没有
Guardian 时明确停在“等待安全重启”，不把包更新误称为运行验收。修复页只有在 Catalog Pin
完成后才显示命令，避免源码 PR 与目录固定之间出现可执行的浮动窗口。

### 历史用户保留与更新路径

- 已安装 `0.8.5`、`0.8.6` 或 `0.8.7` 的用户仍可读取低于 2 MiB 的 `registry/catalog.json` 完整兼容目录，正常看到全部条目，并从商城自身条目发现固定 Commit 的最新修复版本；三个历史版本的原始 Catalog 验证器、搜索和更新卡片逻辑均有回归测试覆盖。
- 更新到 `0.8.8` 后，商城仍可读取兼容目录；更新到 `0.8.9` 及之后版本后，则验证并使用轻量主索引和按页详情懒加载。无论从哪个历史版本升级，都不依赖浮动分支或未知生命周期脚本。
- `0.8.9` 验证 `indexPath` 与 SHA-256 后读取完整索引，后续 Catalog 增长不会再次堵住商城自身的更新入口。
- 所有真实 Profile 更新仍使用商城已有的一次性计划、精确确认、官方 DSH CLI 固定参数、前置哈希、备份、健康检查和失败回滚；GitHub 发布不会自动修改任何已安装 Profile，也不要求执行未知修复脚本。
- `0.8.12` 起，Catalog 声明为无生命周期脚本的所有插件在安�