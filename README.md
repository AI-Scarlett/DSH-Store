Warning: truncated output (original token count: 13201)
Total output lines: 507

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

## 安装插件商城

### 前置条件

- DeepSeek Harness `0.1.0-rc.7`、`0.1.0-rc.8`、`0.1.1-rc.1`、`0.1.1-rc.2`
  或当前官方 `0.1.5-alpha.1`、`0.1.5-alpha.2`、`0.1.5-rc.1` 最新三版预发布通道，并且官方 `dsh` CLI 可用；
- Node.js `^22.19.0` 或 `>=24.0.0`；
- 一个启用了 Web 客户端的目标 Profile。下面以 `web` 为例，如果你的 Profile 名称不同，
  请替换命令中的 `web`。

首次安装发生在本管理器尚未运行之前，因此还没有计划确认、自动备份、健康检查和失败
回滚保护。运行命令前，请先备份目标 Profile 的 `package.json`、`pnpm-lock.yaml`、
`pnpm-workspace.yaml` 和 `cordis.patch.yml`（文件存在时）。

### 使用固定 GitHub Commit 安装

通过 DSH 官方 CLI 安装经过目录固定的 GitHub Commit：

```bash
dsh plugin --profile web add 'git+https://github.com/AI-Scarlett/DSH-Store.git#0bc733064bfc8ff16f6e8144188a7ac563092e12'
```

这条命令会修改目标 Profile 的依赖、锁文件、工作区文件、`node_modules` 和 Bundle 列表。
不要把 Commit 换成 `main` 等浮动分支，也不要绕过 DSH CLI 直接运行 pnpm 或手工编辑
Profile。命令失败时请保留完整错误和安装前备份，不要连续重复执行。

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

## 当前概况

| 项目 | 当前状态 |
| --- | --- |
| 商城版本 | `0.9.2` |
| 收录条目 | 以 GitHub `registry/catalog-index.json` 的实时 `entries.length` 为准 |
| 可安装 | 以实时 Catalog 中 `status: approved` 的条目数为准 |
| 商城不可安装 | 以实时 Catalog 中 `blocked` / `unlisted` 的条目数与 `statusReason` 为准 |
| 分类 | 22 个 |
| 推荐 | 以实时 Catalog 中同时满足 `featured: true` 与 `status: approved` 的条目为准 |
| 目录来源 | GitHub 仓库 + 不可变 Commit |

`0.9.2` 保留官方 Connection 登录校验、持久化操作记录、真实回滚结果、生效状态、脱敏诊断、兼容筛选、本机收藏/备注和固定来源截图；插件商城 Host Bundle 在 DSH `0.2.0-rc.1` 的临时 Profile 安装、启动、卸载和精确回滚已通过本地 smoke。CI 将动态验证官方 active 最新三个版本 `0.1.7-alpha.2`、`0.1.7-rc.1`、`0.1.7-rc.2`，并将 `next` 通道单独验证、不混淆两条发布线；`0.1.7-rc.2` 已在当前官方版本矩阵通过跨平台安装、启动、卸载和精确回滚测试，`0.2.0-rc.1` 也通过独立 next-channel 三平台验证。外部目录仍仅提供待审候选，作者全局一次联系规则保持不变。本地 Profile 仍需单独升级，源码 PR 和 CI 通过不代表本机已安装或公开 Catalog 已完成发布。

`0.8.14` 修复“开发者提交了新代码但没有提升插件版本号”时新用户无法安装新代码的问题：自动任务会把同版本的新 Commit 纳入与正常版本更新相同的固定源、身份、许可证、Bundle、权限和最新三个 DSH 版本兼容审查；通过后移动 Catalog 的完整 Commit 固定点，因此未安装用户会直接安装审核后的新 Commit。已经安装相同版本的用户不会在商城里收到覆盖式更新，商城只展示 Catalog 固定 Commit 与 GitHub 手动命令，并明确说明该操作不受商城备份、健康检查和失败回滚保护。真正提升 SemVer 的版本仍使用商城事务更新。

`0.8.13` 适配官方 DSH `0.1.2` 预发布系列的浏览器令牌认证：Guardian 现在把未认证根路径的预期 `401` 视为 Web 端口存活，但仍必须通过商城运行时接口核对 Profile 与 Boot ID，不能把未知占用者误认成 DSH。当前官方最新预发布版是 `0.1.2-rc.1`，商城按 `0.1.2-alpha.4`、`0.1.2-alpha.5`、`0.1.2-rc.1` 维护动态三版本窗口；没有精确证据的字段保持 `unknown`，不会由版本范围猜测成已验证。无生命周期脚本插件更新保护和独立 launchd Guardian 交接器保持不变。

`0.8.11` 修正分表发布的历史客户端回归：`registry/catalog.json` 继续作为低于 2 MiB 的 schemaVersion 1 兼容桥，但现在为每个索引条目保留旧版验证器、搜索、权限展示和固定来源操作所必需的有界字段；因此尚未升级的 0.8.5–0.8.7 客户端也能看到完整目录，而不是只看到商城自身。长证据摘要、逐版本操作记录和其他详情仍只存放在独立详情文件中。公共 watchdog 同时从详情文件水合商城 Commit，避免把三个正常修复入口误报为失败。

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
- `0.8.12` 起，Catalog 声明为无生命周期脚本的所有插件在安装、更新和迁移时都会加 `--ignore-scripts`；只有 Catalog 明确列出的目标插件脚本才使用仅限该包的 `--allow-build=<package>`。因此历史用户修复商城后，更新其他插件也不会再被 Profile 中无关 Git 依赖的 `prepare` 阻断。
- `0.8.14` 起，同版本新 Commit 审核通过后只改变新安装的固定来源；已有安装不会出现商城“更新”按钮，用户如确实需要覆盖，只能复制界面显示的 GitHub 完整 Commit 命令自行操作，并自行承担备份、重启和回滚。

`0.8.7` 把自动更新、商城兼容展示和 Catalog 门禁统一到官方 npm `latest`/`alpha`/`beta`/`rc` 最高有效通道，排除 `next` 独占和 deprecated 版本，并动态要求最新三个 DSH 版本的精确兼容证据；旧版本独占或全为 unknown 的已上架插件会被可逆地下架并进入不可安装复核候选。商城自身的自动审查允许单个运行文件最多 4 MiB、总运行文件最多 8 MiB，其他插件继续使用更严格的通用上限；Owner Report 的各明细表最多展开 20 条，完整记录保留在 Run Artifact。`0.8.6` 增加稳定版与官方预发布标签的联合检查。`0.8.5` 增加旧版商城自举更新桥：Catalog 仍保留 `partial` 的真实语义，但可以用 `status: unknown` 加 `evidenceStatus: partial` 的 schemaVersion 1 兼容编码发布。0.8.2 会保守地把这些记录显示为“未知”，不会再因为不认识 `partial` 而拒绝整个目录；当前版本则继续显示“部分验证”。这样已安装用户可以直接在商城里看到固定 Commit 的管理器更新，经过一次性计划、确认、备份和健康检查后更新，再由 Guardian 引导重启，不需要手动运行 CLI。

`0.8.4` 是 `AI-Scarlett/DSH-Store` 的规范仓库迁移版本：运行时 Catalog、候选库、Bundle 默认配置、静态商城、提交入口、自动化策略、部署脚本和 Pages 监测均使用新地址。npm 包名和 DSH Bundle 入口仍为 `dsh-safe-plugin-manager`。

`0.8.3` 修复远端 Catalog 使用“部分验证”（`partial`）证据时被旧枚举误判为 `CATALOG_INVALID`、进而回退内置快照的问题。运行时仍然先验证 GitHub Raw Catalog；未知或畸形内容仍会失败关闭并清楚标记为内置快照。此兼容修复以新的 SemVer 发布，避免同版本源提交无法被商城更新流程识别。

`0.8.2` 延续每页 24 条的有界加载和来源排序，并新增动态 DSH 兼容矩阵：最新版本从官方 npm Registry 读取，失败时退回目录版本且不阻塞插件列表；只有精确目录证据显示“兼容”，仅命中声明范围的新版本显示“范围支持·待验证”，生命周期证据继续保持未知。该版本还新增所有标签页常驻的 Boot Guard：插件更新或 Guardian 重启后先校验新 Boot ID、Guardian `healthy` 状态和首页资源，连续稳定后再用带 Boot 参数的新 URL 恢复；`BroadcastChannel` 同步多标签页，轮询作为降级，同一 Boot 只导航一次；推荐条目在默认排序中置顶，可信安装支持“只看推荐”筛选，同版本源仓库提交不再误报为插件升级阻断。

商城已经在真实 DSH `web` Profile 中完成只读扫描、GitHub 在线目录刷新、配置合成、
Host API 和设置页显示验证。单元、契约和事务测试已通过；真实生产 Profile 的完整
“安装—重启—停用—启用—更新—卸载—回滚”闭环仍是独立验收项，不能由测试结果替代。
<img width="1200" height="1103" alt="01_DSH插件商城总览" src="https://github.com/user-attachments/assets/2070b56a-fa3a-4fc1-b7fd-5926015887e4" />
<img width="1200" height="1323" alt="02_DSH插件权限详情" src="https://github.com/user-attachments/assets/dff94448-5dcd-4542-b5d5-39b040b8cd41" />
<img width="1200" height="1098" alt="03_DSH操作预览与确认" src="https://github.com/user-attachments/assets/5eb4f589-21c5-4ced-8133-a22bc6baeb49" />

## 功能介绍

### 插件发现与分类

- 将 `registry/candidates.json` 候选发现库与 `registry/catalog.json` 可信安装库物理隔离；候选条目没有包名、安装路径、入口 ID、权限或安装动作，必须经过固定 Commit 审核后才能晋级；
- 从 GitHub 在线目录读取插件，网络失败时只回退到随包发布的已知快照；
- schemaVersion 1 兼容桥和 v2 主索引都保持在 2 MiB 内，单个详情文件保持 512 KiB 上限；迁移期单体 v1 Catalog 仍可在 4 MiB 内读取；超限、网络失败或完整性不一致时失败关闭并标记回退原因；
- 按名称、包名、分类或 GitHub 仓库搜索；
- DSH 内嵌商城由 Host 每次最多返回 20 个条目，搜索、分类和翻页都使用有界响应；候选发现库只在打开候选视图后读取；
- 公共商城使用 20 条一页的上一页、页码、下一页导航；完整目录不再内嵌到 HTML，避免首屏解析兆字节级脚本数据；主索引与详情文件可分别缓存和读取；
- 支持 22 个分类筛选、推荐置顶、可信安装中的“只看推荐”筛选、上架、商城不可安装和下架；
- 默认按照 approved、推荐、官方最新 DSH 的精确兼容证据、范围支持待验证、GitHub 固定来源更新时间和安装量依次排序；范围不支持、证据未知或长期未更新的条目依次排在后面；
- 目录中的安装目标固定到 40 位 Git Commit，不接受 npm-only、任意下载地址或浮动分支；
- 商城页面和 DSH 内置界面共享同一组 `catalog.json` 兼容桥、`catalog-index.json` 主索引和独立详情文件。

### 四级可信证据

- **Discovered**：只证明项目已被发现或进入可信目录，不代表能够安装；
- **Installable**：必须有固定 Commit、标准 Bundle、明确入口和可复现的静态安装证据；
- **Runtime Verified**：必须绑定具体 DSH 版本、系统、Profile、时间和公开证据，单元测试不能替代；
- **Security Reviewed**：只表示指定方法和证据范围内完成了代码风险审查，不承诺代码绝对安全；
- 任何缺少公开证据的状态都保持 `unknown`，`approved`、作者声明、Stars、推荐或推广位都不会自动提高证据等级；
- `promotionIndependentOfVerification` 是目录的强制信任策略：推广只能改变曝光，不能改变审核结论、兼容性或安全状态。

### 安装与生命周期管理

- 安装 GitHub 目录中的标准 DSH Bundle；
- 不依赖商城服务端巡检全部仓库：仅在用户本机按需检查已安装插件或用户主动选择的插件；
- 从插件 GitHub 默认分支解析最新完整 Commit，绝不直接安装浮动 `main`；
- 安装前在该 Commit 上核对版本、许可证、Bundle Patch、入口 ID、生命周期脚本和变更中的权限信号；
- 更新差异展示旧/新 Commit、提交跨度、文件新增/删除/修改、增删行、网络主机、文件/命令/凭据风险信号和 DSH 官方目录触碰；页面不返回源码 Patch 正文；
- 低风险候选可以生成固定 SHA 更新计划；高风险候选在本机展示权限、脚本、依赖和代码变化，由用户逐次确认是否更新；
- 修改 DSH 原生代码、冒用 `@deepseek-ai/*`、停用/覆盖受保护组件或来源与安装契约不可验证的候选，商城禁止安装/更新，只显示不受商城保护的 GitHub 外部入口；
- 停用、启用和卸载第三方插件；
- 识别 `link:`、`file:`、`workspace:` 等本地开发来源，并单独提供“迁移到商城版”；
- 识别并标记不是通过本商城安装、来源漂移或与目录 Commit 不一致的插件；
- 商城自身仅允许更新，禁止停用和卸载。

### DSH 版本检测

- 商城标题右侧显示当前运行中的 `@deepseek-ai/dsh` 版本，并按需读取 npm 官方 Registry 的最新版本；
- 检测使用 10 分钟缓存、请求超时、响应大小与包身份校验，失败不会阻断插件目录；
- 发现旧版本时提供官方 Release 和固定目标版本的 `npm install --global @deepseek-ai/dsh@<version>` 复制入口；
- 官方 DSH CLI 尚无自升级子命令，因此商城不会静默执行全局 npm/pnpm，也不会对源码工作区运行 `git pull` 或修改 DSH 源码。

### 安全事务与失败回滚

- 所有页面加载、搜索、目录刷新、健康检查和计划生成均为只读操作；
- 每次写操作都先生成一次性计划，展示目标 Profile、固定 Commit、生命周期脚本、
  影响文件和精确确认语；
- 执行前检查 Profile 文件哈希并获取文件锁，防止并发修改；
- 通过官方 DSH CLI 使用固定参数数组执行包操作，不拼接 Shell 命令；
- 写入前创建备份，完成后执行配置健康检查，失败时自动回滚；
- 永久保护 DSH 源码、官方包、官方插件清单、用户 Patch 区块、会话、设置和凭据。

### 商城内置 DSH Guardian

- Guardian 随商城发布，但复制到商城自己的持久状态目录并由 launchd 独立运行；DSH
  启动失败时不依赖 Host Plugin 或设置页存活；
- 安装 Guardian 仍需一次性计划、精确确认和文件哈希预条件，并明确展示将替换的启动任务；先验证
  新 Guardian 的 launchd 注册、随包…3201 tokens truncated…使用 `AI-Scarlett/DSH-Store`，包名和 Bundle 入口保持兼容。 |
| Agent Reach 适配接入 | [`d37fb46`](https://github.com/AI-Scarlett/dsh-agent-reach/commit/d37fb46edf783446b430d324c68ac911b84a14b0) | 将原生 Python/MCP/Skill 项目封装为无安装脚本的 DSH Skill 适配插件，并明确外部运行时与高权限边界。 |

完整的验证边界与发布证据见 [验证记录](docs/VERIFICATION.md)，产品与架构决策见
[产品需求](docs/PRODUCT_REQUIREMENTS.md) 和 [技术架构](docs/ARCHITECTURE.md)。

## 精选插件与目录说明

`★` 表示当前推荐。推荐不会绕过固定 Commit、来源和风险校验。下表仅为重点条目与
不可安装示例；完整目录、动态 DSH 兼容性和来源更新时间排序以
`registry/catalog.json` 兼容桥、`registry/catalog-index.json` 主索引与 `registry/catalog/details/<插件编号>.json` 详情文件共同构成权威目录；兼容桥保留历史用户的自更新入口，主索引负责定位和稳定分页，详情文件负责完整条目数据。

| 插件 | 分类 | 状态 | 介绍 |
| --- | --- | --- | --- |
| ★ [DSH-Store](https://github.com/AI-Scarlett/DSH-Store) | 插件市场、管理工具 | 可安装 | 本插件商城与安全生命周期管理器；自身仅允许更新，禁止停用和卸载。 |
| ★ [Build DSH Plugin](https://github.com/AI-Scarlett/build-dsh-plugin) | 开发与运行时、工作流、工具能力 | 可安装 | 把插件需求转化为标准 DSH Bundle、审计、发布和商城候选。 |
| ★ [Agent Workflow](https://github.com/xuanyuanzhifeng/dsh-plugin-agent-workflow) | 工作流、会话、可视化 | 可安装 | 按轮次展示模型请求、工具调用、耗时与 Token 统计。 |
| [DSH Codex Shell](https://github.com/Ephemeral-AI-Lab/dsh-plugins/tree/0ff29d7bb4c26e62c8bce9b867965fd2211fa670/codex-shell) | 工具能力、开发与运行时 | 可安装 | 为编码 Agent 提供 Codex 风格的持续终端工具；可执行任意 Shell，安装前必须确认高权限和精确 allowBuilds。 |
| [DSH Chat Import](https://github.com/AI-Scarlett/dsh-chat-import) | 会话与消息、导入迁移 | 可安装 | 将 Claude Code、Codex、ChatGPT、Cursor 等会话导入 DeepSeek Harness。 |
| [DSH CLIAPI](https://github.com/AI-Scarlett/DSH_CLIAPI) | 模型与账号、模型路由 | 可安装 | DSH 的授权中心与自动本地模型路由器。 |
| [DSHLLM API](https://github.com/AI-Scarlett/DSHLLM_API) | 模型与账号、模型路由 | 可安装 | 面向 DSH 的多模态感知模型路由器，需要 DSH CLIAPI。 |
| [Agent Reach for DSH](https://github.com/AI-Scarlett/dsh-agent-reach) | 搜索与网络、工具能力、工作流与自动化 | 可安装 | 为 DSH 挂载 Agent Reach 联网路由 Skill；Python CLI 和渠道依赖需另行安装授权。 |
| [DSH Market](https://github.com/dsh-market/dsh-market) | 插件市场、管理工具 | 可安装 | DSH 内的社区插件市场界面，支持浏览、搜索和插件管理。 |
| [DSH WebUI Market Plugin](https://github.com/Sanqi-normal/dsh-webui-market-plugin) | 插件市场、管理工具 | 可安装 | 在 DSH Web 界面浏览 awesome-dsh-plugin.com 并管理社区插件。 |
| [DSH Better Sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 界面增强、工具能力 | 可安装 | 提供文件预览编辑、终端、Git 与子代理工作台侧栏。 |
| [Deep Whale Day Night Theme](https://github.com/GGBond2424648901/deep-whale-day-night-theme) | 主题外观、界面增强 | 可安装 | 提供可切换的日间与夜间主题外观。 |
| [DSH Turn Rewind](https://github.com/Anionex/dsh-turn-rewind) | 会话与消息 | 可安装 | 为 DSH 会话提供回合回退能力。 |
| [DSH Mnemon](https://github.com/omdsh-dev/dsh-mnemon) | 记忆 | 可安装 | 为 DSH 提供持久化记忆能力。 |
| [DSH Vision Toolkit](https://github.com/Anionex/dsh-vision-toolkit) | 工具能力 | 可安装 | 为 DSH 增加图像与视觉处理工具。 |
| [DSH Agent Teams](https://github.com/NanmiCoder/dsh-agent-teams) | 工作流与自动化 | 可安装 | 自然语言驱动的多代理团队协作、依赖任务与消息通信。 |
| [DSH Notification](https://github.com/omdsh-dev/dsh-notification) | 通知与集成 | 可安装 | DSH 回合完成后发送可配置的浏览器桌面通知。 |
| [DSH Command Code Provider](https://github.com/Mars-Sea/dsh-commandcode-provider) | 模型与账号 | 可安装 | 为 DSH 注册 Command Code 模型提供商与模型目录。 |
| [DSH Ads](https://github.com/Nagi-ovo/dsh-ads) | 娱乐 | 可安装 | 添加中文门户广告与英文诈骗广告的恶搞体验。 |
| [DSH At File](https://github.com/omdsh-dev/dsh-at-file) | 文件与输入、界面增强、工具能力 | 可安装 | 在 Web 输入框中提供 Codex 风格的 `@path` 工作区文件引用与搜索。 |
| [DSH GenUI](https://github.com/omdsh-dev/dsh-genui) | 可视化、界面增强、工具能力 | 可安装 | 在助手回复中渲染图表、表单、测验、Mermaid 和 3D 场景等交互式界面。 |
| [DSH Visualize](https://github.com/Nagi-ovo/dsh-visualize) | 可视化、界面增强、工具能力 | 可安装 | 通过工具与内置技能渲染沙箱化的交互式 HTML 可视化卡片。 |
| [DSH OpenPencil](https://github.com/ZSeven-W/dsh-openpencil) | 设计与原型、界面增强、工具能力 | 可安装 | 集成 OpenPencil 多画板预览、交互画布与托管编辑工作台。 |
| [AnySearch for DSH](https://github.com/anysearch-team/anysearch-dsh) | 搜索与网络、工具能力 | 可安装 | 注册 AnySearch 网络搜索提供商与增强搜索工具，需要配置 API Key。 |
| [DSH Gomoku](https://github.com/omdsh-dev/dsh-gomoku) | 娱乐、界面增强 | 可安装 | 在对话界面加入五子棋棋盘、AI 落子路由与模型目录。 |
| [DSH Web UI All](https://github.com/zhu1090093659/dsh-web-ui) | 综合套件、界面增强、工具能力 | 可安装 | 聚合任务板、Git 图、宠物、远程界面、实时统计、SSH、视觉工具与多款皮肤。 |
| [DSH Shortcuts](https://github.com/Ricketts-Guo/dsh-shortcuts) | 界面增强、工具能力、新锐实验 | 可安装 | 提供可录制、可配置的键盘快捷键与权限切换反馈。 |
| [DSH Diagram](https://github.com/hanzhangzzz/dsh-diagram) | 可视化、设计与原型、新锐实验 | 可安装 | 将文章转换为可编辑的 Excalidraw 画布并在会话中持续管理。 |
| [DSH Egress Guard](https://github.com/tancheng33/dsh-egress-guard) | 安全与隐私、工具能力、新锐实验 | 可安装 | 提供出站域名策略、工具结果密钥脱敏和追加式审计日志，默认监控模式。 |
| [DSH Achievements](https://github.com/WJNCT55555/dsh-achievements) | 娱乐、界面增强、新锐实验 | 可安装 | 添加成就引擎、图鉴、提示、奖杯与进度持久化。 |
| [DSH Plugin Outline](https://github.com/iluluyu/dsh-plugin-outline) | 会话与消息、界面增强、可视化 | 可安装 | 提供右侧会话轮次大纲、当前位置高亮和点击跳转。 |
| [DSH IP Calculator](https://github.com/TYEclipse/dsh-ipcalc) | 工具能力、开发与运行时 | 可安装 | 提供 IPv4 子网计算、CIDR 汇总以及 IPv4/IPv6 解析和规范化工具。 |
| [DSH Stats Board](https://github.com/PastSheep/dsh-stats-board) | 会话与消息、界面增强、可视化 | 可安装 | 增加会话与工具调用统计视图，并按轮次展示 Token 使用情况。 |
| [DSH Ventus Whale](https://github.com/mmzm0808/dsh-ventus-whale) | 界面增强、主题外观 | 可安装 | 添加可拖动和配置的 3D 虎鲸桌宠、快捷交互与设置面板。 |
| [DSH Memory Evolve](https://github.com/csyangwen/dsh-memory-evolve) | 记忆、工作流与自动化、工具能力 | 商城不可安装（GitHub 手动） | 分层长期记忆、自我进化、技能与待办管理，以及外部 CLI Agent 调度。 |
| [DSH TUI](https://github.com/ccch1mneyyy/dsh-TUI) | 客户端与生态、开发与运行时 | 商城不可安装（GitHub 手动） | Claude Code 风格的独立 DSH 终端客户端。 |
| [DSH Explorer](https://github.com/No-PRM/dsh-explorer) | 文件与输入、界面增强、工具能力 | 商城不可安装（GitHub 手动） | Host 与浏览器双 Bundle 文件树侧栏，支持 Git 标记、媒体预览与拖拽引用。 |
| [DSH Web Plugin Manager](https://github.com/LX2000WASD/dsh-web-plugin-manager) | 插件市场、管理工具 | 商城不可安装（GitHub 手动） | 第三方综合插件管理器，当前 Bundle 会遮蔽 DSH 官方插件清单。 |
| [DSH Plugin Hub](https://github.com/Noob-stupid/dsh-plugin-hub) | 插件市场、管理工具 | 商城不可安装（GitHub 手动） | 社区插件控制台，当前使用受保护的 `@deepseek-ai` 官方命名空间。 |

### 商城不可安装说明

- **DSH Memory Evolve**：固定 Commit 的 manifest 未声明 `dsh.bundle.patch`；
- **DSH TUI**：属于独立终端入口，Bundle Patch 会覆盖或停用多项基础 Profile 行；
- **DSH Explorer**：完整功能需要两个独立 Bundle，当前目录尚不支持多包原子安装和回滚；
- **DSH Web Plugin Manager**：会禁用官方 `ui-settings-plugin-inventory`；
- **DSH Plugin Hub**：第三方仓库声明受保护的 `@deepseek-ai` 官方命名空间。

“商城不可安装”不是下架：用户仍可查看项目介绍和 GitHub 仓库，并按项目文档自行决定
是否手动安装，但商城不会为其生成安装计划。手动安装可进入只读健康检查，但没有固定
目录证据，也不受商城的备份或失败回滚保护。目录收录也不代表完成安全审计；第三方插件会以 DSH 进程权限运行，安装前
仍应核对仓库、固定 Commit、许可证、生命周期脚本和影响范围。

## 详细健康检查与权限选择

健康检查覆盖当前 Profile 中的全部声明项，包括商城安装、外部安装、目录外插件和官方
组件，并分别显示本地 manifest、Bundle 注册、来源与固定 Commit、版本漂移、安装脚本、
配置合成以及运行时证据。报告不会用单一 `pass` 代替未知事实；没有独立业务探针时会明确
显示“未验证”。

第三方插件的文件、网络、命令和凭据权限默认处于“待选择”。用户可逐项选择允许或拒绝，
目录外插件则需决定是否接受未知权限边界。选择只保存在当前浏览器，并绑定包名、版本、
固定来源、目录身份和权限声明；清除浏览器站点数据，或这些事实变化后，必须重新选择。
它仅用于形成个人健康审核结论，不会修改 Profile，也不会限制插件进程的真实能力；真正的
权限隔离仍由 DSH 宿主和沙箱负责。

## 架构

```text
GitHub catalog.json ──> 搜索 / 分类 / 推荐 / 固定 Commit 来源复核
                              │
DSH Web Settings ──> 只读查看与操作计划 ──> 精确确认语
                                              │
                                              ▼
                        Profile 锁 → 备份 → 官方 dsh plugin
                                              │
                                  健康检查 → 成功 / 自动回滚
```

Host 端使用 `ctx.inject(['webServer'], ...)` 等待可选 Web 服务。Client 端通过 DSH
官方 `ModuleLoader` 与 Settings Slot 注册“插件商城”页签，不导入 Host 模块。

## 目录维护

- 机器目录：[`registry/catalog.json`](registry/catalog.json)；
- GitHub Pages 页面：[`marketplace/index.html`](marketplace/index.html)；
- 新增或更新插件必须通过 Pull Request；
- 每个可安装条目必须固定 GitHub Commit，并通过 manifest、版本、Bundle Patch、
  DSH 入口 ID 和生命周期脚本复核；
- 同一个 DSH `packageName` 只允许出现一次，避免安装和更新身份冲突；
- 收录不代表安全审计，商城不可安装和未验证状态必须保留真实原因。

### 提交插件上架申请

如果你开发或发现了值得收录的 DSH 插件，只需打开
[项目上架入口](https://github.com/AI-Scarlett/DSH-Store/issues/new?template=plugin-submission.yml)
并填写公开 GitHub 地址。仓库只有一个 DSH 插件时无需填写其他技术字段；若机器人发现多个
插件，会列出候选目录，此时编辑 Issue 补一个 `Plugin path` 即可。

开发新插件或准备提交前，建议安装并使用
[`build-dsh-plugin`](https://github.com/AI-Scarlett/build-dsh-plugin)。它可以从 Brief 生成标准
Host Plugin + Client Bundle，判断 R0–R3 风险，生成 Catalog 候选并做只读预检；它不会
静默修改 DSH-Store 或真实 Profile。可以直接告诉支持该 Skill 的 Agent：

```text
使用 $build-dsh-plugin，只读检查这个 DSH 插件是否满足 DSH-Store 上架条件：
https://github.com/owner/repository
不要安装到真实 Profile，不要执行第三方生命周期脚本。
```

#### 上架必要条件

1. 仓库必须公开托管在 GitHub；最终安装源固定到完整 40 位 Commit，不接受浮动分支、
   npm-only、本地路径或任意下载 URL；
2. 目标目录包含有效 `package.json`，声明语义化包版本和可解析的 `dsh.bundle.patch`；
3. Bundle Patch 至少声明一个唯一 DSH 入口 ID，且不禁用、替换、遮蔽或冒充
   `@deepseek-ai/*` 官方组件与官方插件清单；
4. 包名、版本、许可证、`preinstall/install/postinstall/prepare` 生命周期脚本必须与固定
   Commit 的实际文件一致；第三方包不得使用 `@deepseek-ai` 命名空间；
5. README 至少说明插件用途、安装或启用方式、外部依赖和主要风险；monorepo 必须能唯一定位
   插件目录；
6. 上架前必须明确 DSH/Node.js、系统和 Profile 兼容范围，以及文件、网络、命令、凭据权限。
   无法确认时必须写“未知”，不得把“没有搜到”推断成“不访问”；
7. 插件应具备清晰用途，并在“热门、有用、有趣”至少一个维度具有收录价值；高权限、安装
   脚本、运行依赖或外部服务会被自动安装策略失败关闭，只保留隔离候选或 `blocked` 外部入口；
8. 自动预检、人工检查和作者认证都不等于完整安全审计；可安装插件仍需在一次性 Profile 中
   完成适配版本的安装、配置合成、页面或工具可见性与卸载/回滚验收。

#### GitHub 自动检查

Issue 创建、编辑或重新打开后，GitHub Actions 会自动取得默认分支当前 HEAD 的 40 位 Commit，
读取仓库树、目标 `package.json`、README 和 Bundle Patch，并检查：公开/归档状态、包名和版本、
许可证、Bundle 声明、入口 ID、生命周期脚本、受保护命名空间、现有 Catalog 冲突，以及 manifest
中明确声明的 Node.js、系统和 Profile 兼容信息。结果会更新到同一条机器人评论，并设置
`submission-passed` 或 `submission-failed` 标签。

工作流不检出申请仓库，不执行第三方 `install`、`prepare`、`build` 或 `test`。静态证据不能
可靠证明的权限、凭据和外部依赖保持“未知”。八小时自动策略只批准完整有界运行时源码可读取、
无生命周期脚本和运行依赖、许可证/仓库/Bundle/入口一致且没有文件、网络、命令、凭据、原生
制品或受保护 DSH 信号的固定 Commit；其他项目自动拒绝、隔离或标记 `blocked`。

#### 自动策略与自检清单

- 对照固定 Commit 复核 README、许可证、生命周期脚本、权限、外部依赖和供应链来源；
- 确认入口 ID 与现有插件不冲突，且没有修改 DSH 核心、官方包或官方清单；
- 判断直接安装、monorepo 子目录、需要 Adapter 或应阻止上架，并给出真实原因；
- 分别在一次性 DSH `0.1.0-rc.7`、`0.1.0-rc.8`、`0.1.1-rc.1`、`0.1.1-rc.2` Profile 中使用官方 CLI 验证安装、配置合成和功能可见性；
- 高权限或原生构建依赖需要额外核对 `allowBuilds`、平台支持、失败清理和回滚；
- 最终目录字段、推荐状态和公开页面必须从 GitHub `registry/catalog.json` 读回后才算完成。

自动任务每八小时依次处理 GitHub 主动发现项目与用户提交，先以远端 `main` 目录去重，再对
每个项目验证 canonical GitHub、manifest、许可证、完整运行产物、Bundle Patch、受保护条目
和固定 Commit。满足 `registry/automation-policy.json` 的项目自动生成 PR，通过仓库检查与
CodeQL 后自动 squash 合并；其余结果失败关闭，不再用机械人工确认代替证据。

Catalog 在 UTC 00:05、08:05、16:05 扫描；发生 Catalog 变更并合并后会立即触发且等待绑定该
merge Commit 的 Pages 发布，国际站、国内站和看门狗仍按三小时错峰运行并负责兜底恢复。
看门狗会核验上一轮工作流、GitHub Raw、Pages 和两个生产域名；Catalog 超过九小时或公开面失败
时自动重派任务，未恢复状态留作下一轮继续处理。
看门狗还会把每轮的新增收录数、历史版本更新数、中文名（英文名）清单、暂缓原因和四个公开面
结果写入 `DSH STORE 自动更新报告（每 3 小时）` 跟踪 Issue。

Catalog 扫描成功后，独立的 `author-notifications.yml` 会为 `blocked` 条目、发现上游高版本但暂缓
更新的条目，以及明确属于 DSH 且有确定性整改原因的候选项目维护 GitHub 修复单，并在新建或原因
变化时 `@维护者`；个人仓库提及所有者，组织仓库优先提及最近的人类提交者。同一 canonical 仓库
只有一个修复单；原因不变不重复提醒，阻断清除后自动
关闭。搜索误命中、403/404/429、超时、默认分支移动等临时故障不通知；历史候选不会无边界群发，
每轮最多新建 3 个，剩余项在后续八小时轮次中处理。每次写入都绑定当前 `main` Commit、Catalog、
候选表、扫描报告和现有修复单哈希。这条链路只使用 GitHub Actions 的短期仓库令牌，不依赖 Codex、
外部 PAT 或 SMTP 密码。每封修复单都会建议维护者使用
[build-dsh-plugin](https://github.com/AI-Scarlett/build-dsh-plugin) 检查并修改项目，并提供
[DSH STORE 官网](https://dsh.store/) 状态入口。

每次三小时报告会列出本轮向多少个不符合条件项目发送了 GitHub 整改消息、触发了多少个项目的
GitHub 通知邮件，以及上游源码处于“已修改但仍未通过、已修改且阻断清除、未检测到新提交、首次
建立基线或暂无法判断”的数量。这里的“邮件触发”表示仓库已通过 `@维护者` 提交给 GitHub 通知
系统；实际是否送达收件箱仍取决于接收者自己的 GitHub 通知和邮箱设置，仓库不会虚报为已送达。

## 本地验证

```bash
npm run check
npm run verify:registry-sources
```

测试使用临时目录，不会修改真实 `~/.dsh`。更完整的开发和验收资料：

GitHub 默认 CodeQL 已启用，对 Actions 与 JavaScript/TypeScript 变更执行代码扫描。

- [产品需求](docs/PRODUCT_REQUIREMENTS.md)
- [技术架构](docs/ARCHITECTURE.md)
- [开发路线](docs/DEVELOPMENT_PLAN.md)
- [验收方案](docs/ACCEPTANCE.md)
- [验证记录](docs/VERIFICATION.md)
- [研究与来源](docs/RESEARCH.md)
- [安全约束](SECURITY.md)

## 下一步

在一次性 Profile 中补齐 GitHub 安装、更新、启停、卸载和故障回滚的真实闭环，覆盖
headless、损坏 manifest、缺失依赖、坏链接和无 Web Server Profile 等异常矩阵；
生产 Profile 的每次写操作仍必须由用户查看计划并输入精确确认语。

## 许可证

本项目采用 [MIT License](./LICENSE) 开源。Copyright (c) 2026 AI-Scarlett。
