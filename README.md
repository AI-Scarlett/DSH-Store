# DSH-Store｜DSH 第三方插件商城
<img width="900" height="383" alt="cover_dsh_plugin_market_900x383" src="https://github.com/user-attachments/assets/2b03ff48-a39b-427d-87c1-62190560a496" />

DSH-Store 是一个运行在 DeepSeek Harness（DSH）设置页中的第三方
插件商城与安全生命周期管理器。它使用标准 DSH Bundle + Host Plugin + Client Bundle
结构，不开发独立桌面端，不修改 DSH 源码，也不替换任何 `@deepseek-ai/*` 官方包。

> **想把插件上架到 DSH-Store？** [提交一个公开 GitHub 项目地址](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/issues/new?template=plugin-submission.yml) 即可。机器人会自动读取必要文件，不再要求手填整份 Catalog。开发或提交前，建议先用 [`build-dsh-plugin`](https://github.com/AI-Scarlett/build-dsh-plugin) 制作或执行只读商城预检。

[打开在线插件商城](https://dsh.store/) ·
[提交项目上架](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/issues/new?template=plugin-submission.yml) ·
[使用 build-dsh-plugin](https://github.com/AI-Scarlett/build-dsh-plugin) ·
[查看机器目录](registry/catalog.json) ·
[目录准入规则](registry/README.md) ·
[安全说明](SECURITY.md)

## 安装插件商城

### 前置条件

- DeepSeek Harness `0.1.0-rc.7`、`0.1.0-rc.8`、`0.1.1-rc.1` 或 `0.1.1-rc.2`，并且官方 `dsh` CLI 可用；
- Node.js `22.13.0` 或更高版本；
- 一个启用了 Web 客户端的目标 Profile。下面以 `web` 为例，如果你的 Profile 名称不同，
  请替换命令中的 `web`。

首次安装发生在本管理器尚未运行之前，因此还没有计划确认、自动备份、健康检查和失败
回滚保护。运行命令前，请先备份目标 Profile 的 `package.json`、`pnpm-lock.yaml`、
`pnpm-workspace.yaml` 和 `cordis.patch.yml`（文件存在时）。

### 使用固定 GitHub Commit 安装

通过 DSH 官方 CLI 安装经过目录固定的 GitHub Commit：

```bash
dsh plugin --profile web add 'git+https://github.com/AI-Scarlett/dsh-safe-plugin-manager.git#b63118fc20d315fb484f40a92e43c3ab59121904'
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
   [GitHub Issues](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/issues) 提交原始错误，
   不要提交凭据、完整 Profile 文件或环境变量。

安装完成后，从商城发起的安装、更新、迁移、停用、启用和卸载才会进入一次性计划、
精确确认、Profile 前置哈希、备份、健康检查和失败回滚流程。

## 当前概况

| 项目 | 当前状态 |
| --- | --- |
| 商城版本 | `0.8.2` |
| 收录条目 | 400 个 |
| 可安装 | 393 个 |
| 商城不可安装 | 5 个，保留 GitHub 手动安装入口和风险原因；另有 2 个 unlisted 条目不公开展示 |
| 分类 | 22 个 |
| 推荐 | 3 个：DSH-Store、Build DSH Plugin、Agent Workflow |
| 目录来源 | GitHub 仓库 + 不可变 Commit |

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
- 按名称、包名、分类或 GitHub 仓库搜索；
- DSH 内嵌商城由 Host 每次最多返回 24 个条目，搜索、分类和翻页都使用有界响应；候选发现库只在打开候选视图后读取；
- 公共商城使用 24 条一页的上一页、页码、下一页导航；完整目录不再内嵌到 HTML，避免首屏解析兆字节级脚本数据；
- 支持 22 个分类筛选、推荐置顶、可信安装中的“只看推荐”筛选、上架、商城不可安装和下架；
- 默认按照 approved、推荐、官方最新 DSH 的精确兼容证据、范围支持待验证、GitHub 固定来源更新时间和安装量依次排序；范围不支持、证据未知或长期未更新的条目依次排在后面；
- 目录中的安装目标固定到 40 位 Git Commit，不接受 npm-only、任意下载地址或浮动分支；
- 商城页面和 DSH 内置界面共享同一个 `registry/catalog.json` 数据源。

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
  新 Guardian 的 launchd 注册、随包文件哈希和新鲜心跳，HTTP 响应成功后才延迟交接旧 Host；
  验证失败会恢复原 Guardian 文件且不关闭当前 Host；
- 使用固定参数数组启动 DSH，不使用 `bash -c`，记录心跳、启动状态、失败次数和熔断状态；
- 将管理器验证过的命令 PATH 固化到 Guardian 配置；即使 launchd 与 Node 运行时 PATH 中没有
  Homebrew，启动与离线依赖恢复仍能从全局 DSH CLI 安装位置找到可执行的 `pnpm`；
- Guardian 是 DSH web Profile 的唯一启动所有者；商城不再提供会启动第二个实例的复制命令；
- 健康判定要求首页 HTTP 和 `/api2/dsh-safe-plugin-manager/runtime` 同时成功，并核对 Profile 与
  Boot ID。单纯能连接 3080 端口不再代表 DSH 健康；
- 端口若由外部 DSH 或未知进程占用，Guardian 会明确报告未持有所有权并停止启动，不会杀死、
  冒充接管或再启动一个 DSH；
- 重启前扫描 Profile Patch 与所有已安装 Bundle Patch 的入口 ID；发现重复入口时将包操作
  判为不健康并立即恢复事务备份，不关闭当前 Host；
- Guardian 连续失败会打开熔断并保留脱敏故障摘要，不会把“端口暂时出现”误报成插件已健康。
- Guardian 将端口、首页 HTTP、runtime 身份、耗时、响应字节数和重启判断写入商城自己的
  `probe-log.jsonl`。失败探测逐次记录，健康探测每分钟采样；不保存响应正文、Profile 内容或
  凭据。日志仅保留 24 小时，并额外限制为 4 MiB，清理失败不会中断 Host 监督。
- 商城会比较随包 Guardian 与已部署守护文件的 SHA-256；版本漂移时禁用一键重启，并要求
  用户通过新的单次计划和精确确认升级 Guardian。

### 健康检查与来源识别

- 检查 Profile 清单、依赖、管理器托管 Patch、DSH 配置合成与冷启动入口 ID 冲突；
- 合并 Bundle 和依赖信息，显示已安装版本、声明来源和官方/第三方属性；
- 区分“已验证”“部分验证”“商城不可安装”和“尚未验证”，不把声明态当成运行态；
- 运行态 Loader/Fiber 状态继续以 DSH 官方清单为权威，商城不直接控制官方运行时。

### 插件详情与权限画像

- DSH rc.7–`0.1.1-rc.2` 中使用同一套官方 `ModuleLoader`、`settings.plugins.tab`、Slots 和 Modal 契约；历史 rc.7/rc.8 使用别名，新版本使用完整版本键避免歧义；
- 使用紧凑的响应式卡片、状态圆点、清晰的操作区、无障碍列表语义和每页 24 条的分页导航；
- 每张商城卡片可打开详情弹窗，集中显示插件类型、安装来源和许可证；
- 列表与详情均显示由 GitHub 仓库链接可靠派生的发布者账号；组织仓库显示组织账号，
  不把它误写成具体个人开发者；
- 展示权限等级，以及文件、网络、命令和凭据访问范围；
- 展示外部依赖、审核状态、DSH/Node.js 版本、系统和 Profile 兼容性；
- 公开矩阵只保留仍有公开发行物的 rc.7、rc.8 历史别名，后续发布使用完整 SemVer；卡片实时展示最近三个完整版本，详情展示目录已知版本及安装、启动、卸载、回滚证据；缺少精确真实验收时显示未知；
- 字段来自 GitHub 目录固定 Commit 的 manifest、README 与代码信号；无法确认时显示
  “未知”或“未声明”，不会用本地猜测覆盖目录数据；
- 自动扫描、人工检查和作者认证只表示元数据核验层级，均不等于安全审计。

### 上下架、推荐与安装计数

- `approved`：正常上架并允许生成安装计划；
- `blocked`：商城中继续展示并提供 GitHub 手动安装入口，但不提供商城安装操作；
- `unlisted`：公共商城隐藏，已安装用户仍可停用或卸载；
- `featured: true`：在全部视图和所属分类中优先显示；可信安装还可以切换“只看推荐”，但不会提高任何可信证据；当前推荐 DSH-Store、
  Build DSH Plugin、Agent Workflow 和 Settings Hub；
- 可选安装回执只发送插件 ID 和版本，不发送设备、Profile 或用户标识；默认关闭；
- GitHub Pages 不能直接写回 `catalog.json`，真实计数需要独立匿名聚合服务。
- `0.4.7` 内置幂等安装回执与 Cloudflare Worker + D1 聚合器；只在商城安装、健康检查通过后提交插件 ID、版本和随机事务 ID，不提交账号、设备或 Profile。计数服务未部署或未配置时保持关闭，不显示虚假安装量。

## 使用方式

安装并启动管理器后，在 DSH 中打开：

```text
设置 → 插件 → 插件商城
```

界面包含三个视图：

1. **插件市场**：搜索、分类筛选、查看推荐、安装、更新或迁移；
2. **已安装**：查看来源、版本、商城托管状态，并停用、启用或卸载；
3. **健康检查**：检查 Profile、依赖、托管 Patch 和配置合成状态。

健康检查不会自动替用户批准权限。有待选项时，顶部操作会定位到逐插件权限列表；只有
所有声明权限均明确选择“允许”或“拒绝”后，底部重新检查按钮才会启用，并显示检查中、
完成时间或失败原因。审核选择只保存在当前浏览器，并绑定包名、已安装版本、固定来源、
目录身份和权限声明；版本、固定 Commit 或权限声明变化后会自动失效并要求重新确认。

刷新按钮会重新读取 GitHub `main` 分支上的在线目录。以本地开发链接安装的管理器或
插件不会被普通“更新”静默覆盖；需要先生成并确认“迁移到商城版”计划。迁移只切换
目标 Profile 的依赖来源，不删除或修改原本地项目。

## 开发历程

| 阶段 | 关键提交 | 完成内容 |
| --- | --- | --- |
| 只读原型 | [`5df2f80`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/5df2f80) | 建立标准 DSH Bundle、Profile 只读扫描、Host API 和设置页入口。 |
| 客户端接入修复 | [`e579c18`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/e579c18) | 修复 Client ModuleLoader 初始化并完成真实 DSH 页面验收。 |
| 受控生命周期 | [`ba168e3`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/ba168e3) | 加入安装、更新、启停、卸载的计划/确认/备份/健康检查/回滚事务。 |
| GitHub 目录发布 | [`60f97d8`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/60f97d8) | 建立 GitHub-only 注册表、固定 Commit 来源校验和 GitHub Pages 商城。 |
| 分类商城 `0.3.0` | [`64949b8`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/64949b8) | 加入分类筛选、推荐排序、上下架、安装来源标记和自研四件套。 |
| 推荐规则完善 | [`3c2b9f2`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/3c2b9f2) | 将推荐严格限制为 `AI-Scarlett` 自研的四个插件。 |
| 本地来源迁移 `0.3.1` | [`80fefec`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/80fefec) | 将本地开发安装从普通更新中隔离，新增显式“迁移到商城版”流程。 |
| 热门插件扩充 | [`7aaba17`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/7aaba17) | 按推荐清单扩充到 31 个条目和 22 个分类，并为不兼容项目保留展示型阻止。 |
| 插件详情与更新修复 `0.4.0` | [`f3a93c2`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/f3a93c2) | 补齐 31 个插件的权限、许可证、审核与兼容性详情；为商城不可安装项目提供 GitHub 手动入口，并修复 DSH 运行环境中的 pnpm PATH。 |
| 内置 Guardian `0.4.4` | [`ca297cc`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/ca297cc6f68cbe007b07b30815a9811d09f9ffcc) | 将重启切换为商城自带的进程外 launchd Guardian，加入冷启动入口冲突检查、有界重启、熔断和事务回滚隔离。 |
| Guardian 心跳修复 `0.4.5` | [`3f0d117`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/3f0d1177f024bf159532370fa2a3861dc1b4ba83) | 稳定期只执行一次；进入健康状态后持续刷新心跳与稳定时长，避免商城误报守护进程离线。 |
| 健康权限交互修复 `0.4.6` | [`e645ede`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/e645edefe8ece8972d3fd723875b0f49ffeb272b) | 将权限定位与重新检查拆分，补充未选择数量、按钮禁用、检查中和完成/失败反馈。 |
| Guardian 单一所有者 `0.4.8` | [`ed8722b`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/ed8722b20073cb61c7041e3e8eab6e5e10ed6d6d) | 以首页 HTTP 与 runtime Profile/Boot ID 共同判定健康；拒绝接管外部或未知端口进程，连续失败才有界重启，并移除会启动第二实例的 UI 命令。 |
| DSH-Store 与目录扩充 `0.4.9` | [`8a76190`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/8a76190b516258e37ba0604891058c87d979295e) | 英文品牌统一为 DSH-Store，技术支持入口切换到 dsh.store，并将目录扩充到 42 个条目。 |
| rc.7 卡片与提交门禁 `0.5.0` | [`3ca90bf`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/3ca90bf245fe54a097c787c216ad7353d7769ebb) | 修复 Guardian/全局 DSH CLI 的 pnpm PATH，升级响应式插件卡片与发布者展示，并将上架表单简化为 GitHub 地址驱动的自动静态预检。 |
| 本机按需源更新 `0.5.1` | [`9a6e41f`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/9a6e41f7875726f7124d2cfde618df284342e5f3) | 用户本机按需读取插件源 GitHub，解析完整 Commit 并在安装前审核；低风险候选可固定 SHA 更新，高风险或契约漂移返回 Registry 复审。 |
| 本机高风险自主决策 `0.5.2` | [`5e6c2b9`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/5e6c2b9cde9c3992d55a88aa7223da76a5746b78) | 进入已安装页后由用户本机有限并发检查源 GitHub；低风险生成固定 SHA 计划，高风险展示变化并逐次确认，触碰 DSH 原生代码或受保护组件则仅保留不受商城保护的外部入口。 |
| DSH 版本与升级提示 `0.5.3` | [`2655055`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/2655055671fa2dc23a178cc251402bc5748c7e2a) | 在商城标题右侧显示当前 DSH 版本并按需检查 npm 官方最新版；提供固定版本升级命令与官方 Release，同时折叠长说明并保持 DSH 源码不可修改。 |
| 安装诊断与构建许可 `0.5.4` | [`74ca4d4`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/74ca4d4c07a21ae1ac1a5e8372e98097e75565b9) | 将源更新超时映射为稳定错误码，显示脱敏 pnpm 诊断，并仅为已审核且声明安装生命周期脚本的插件传入精确包名构建许可。 |
| Guardian 探针留存 `0.5.5` | [`96590c8`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/96590c863d9c074c8f31c4fed4173f4634354d08) | 记录端口、首页、runtime 身份与耗时的脱敏探针；健康状态采样、故障逐次记录，24 小时/4 MiB 自动清理；部署 Guardian 与商城源码漂移时禁止安全重启，要求走新的确认升级流程。 |
| Guardian 安全交接与健康审核持久化 `0.5.6` | [`8bb4b17`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/8bb4b17836b593ebc29c77882503bc70f759bbc6) | 新 Guardian 先验证独立心跳再交接旧 Host；浏览器本地健康审核按版本、固定 Commit 和权限声明失效；补齐 19 个商城展示名。 |
| 分页和跨 RC 兼容 `0.7.0` | [`7cff780`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/7cff780c00c923b1ca45ceff1d7e26c3e263c969) | DSH Host 目录改为每页 24 条的有界响应，候选库按需读取；公共商城移除 HTML 内嵌完整目录，并将官方客户端契约兼容范围扩展到 rc.5–rc.8。 |
| DSH 0.1.1-rc.1 兼容 `0.8.0` | [`b9be979`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/b9be979ff42deacff5e344e2e5d36c13638c95b9) | 新增无歧义 `0.1.1-rc.1` 矩阵、最新版本排序、旧目录缺键降级和 400 条目录的保守兼容状态迁移。 |
| 动态 DSH 兼容与启动恢复 `0.8.1` | [`9ba80c2`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/commit/9ba80c2cd2456193f2805aacb08d8bb87716e92f) | 从官方 npm Registry 获取最新 DSH 版本且不阻塞目录加载；范围匹配保持待验证，补齐 rc.2 临时 Profile 证据，并让所有标签页在 Guardian 稳定后只恢复一次。 |
| Agent Reach 适配接入 | [`d37fb46`](https://github.com/AI-Scarlett/dsh-agent-reach/commit/d37fb46edf783446b430d324c68ac911b84a14b0) | 将原生 Python/MCP/Skill 项目封装为无安装脚本的 DSH Skill 适配插件，并明确外部运行时与高权限边界。 |

完整的验证边界与发布证据见 [验证记录](docs/VERIFICATION.md)，产品与架构决策见
[产品需求](docs/PRODUCT_REQUIREMENTS.md) 和 [技术架构](docs/ARCHITECTURE.md)。

## 精选插件与目录说明

`★` 表示当前推荐。推荐不会绕过固定 Commit、来源和风险校验。下表仅为重点条目与
不可安装示例；完整目录、动态 DSH 兼容性和来源更新时间排序以
`registry/catalog.json` 为准。

| 插件 | 分类 | 状态 | 介绍 |
| --- | --- | --- | --- |
| ★ [DSH-Store](https://github.com/AI-Scarlett/dsh-safe-plugin-manager) | 插件市场、管理工具 | 可安装 | 本插件商城与安全生命周期管理器；自身仅允许更新，禁止停用和卸载。 |
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
[项目上架入口](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/issues/new?template=plugin-submission.yml)
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
可靠证明的权限、凭据和外部依赖保持“未知”。三小时自动策略只批准完整有界运行时源码可读取、
无生命周期脚本和运行依赖、许可证/仓库/Bundle/入口一致且没有文件、网络、命令、凭据、原生
制品或受保护 DSH 信号的固定 Commit；其他项目自动拒绝、隔离或标记 `blocked`。

#### 自动策略与自检清单

- 对照固定 Commit 复核 README、许可证、生命周期脚本、权限、外部依赖和供应链来源；
- 确认入口 ID 与现有插件不冲突，且没有修改 DSH 核心、官方包或官方清单；
- 判断直接安装、monorepo 子目录、需要 Adapter 或应阻止上架，并给出真实原因；
- 分别在一次性 DSH `0.1.0-rc.7`、`0.1.0-rc.8`、`0.1.1-rc.1`、`0.1.1-rc.2` Profile 中使用官方 CLI 验证安装、配置合成和功能可见性；
- 高权限或原生构建依赖需要额外核对 `allowBuilds`、平台支持、失败清理和回滚；
- 最终目录字段、推荐状态和公开页面必须从 GitHub `registry/catalog.json` 读回后才算完成。

自动任务每三小时依次处理 GitHub 主动发现项目与用户提交，先以远端 `main` 目录去重，再对
每个项目验证 canonical GitHub、manifest、许可证、完整运行产物、Bundle Patch、受保护条目
和固定 Commit。满足 `registry/automation-policy.json` 的项目自动生成 PR，通过仓库检查与
CodeQL 后自动 squash 合并；其余结果失败关闭，不再用机械人工确认代替证据。

Pages、国际站和国内站在同一三小时窗口错峰更新。最后一个看门狗会核验上一轮工作流、GitHub
Raw、Pages 和两个生产域名；缺失或失败时自动重派任务，未恢复状态留作下一轮继续处理。
看门狗还会把每轮的新增收录数、历史版本更新数、中文名（英文名）清单、暂缓原因和四个公开面
结果写入 `DSH STORE 自动更新报告（每 3 小时）` 跟踪 Issue。

Catalog 扫描成功后，独立的 `author-notifications.yml` 会为 `blocked` 条目、发现上游高版本但暂缓
更新的条目，以及明确属于 DSH 且有确定性整改原因的候选项目维护 GitHub 修复单，并在新建或原因
变化时 `@维护者`；个人仓库提及所有者，组织仓库优先提及最近的人类提交者。同一 canonical 仓库
只有一个修复单；原因不变不重复提醒，阻断清除后自动
关闭。搜索误命中、403/404/429、超时、默认分支移动等临时故障不通知；历史候选不会无边界群发，
每轮最多新建 3 个，剩余项在后续三小时轮次中处理。每次写入都绑定当前 `main` Commit、Catalog、
候选表、扫描报告和现有修复单哈希。这条链路只使用 GitHub Actions 的短期仓库令牌，不依赖 Codex、
外部 PAT 或 SMTP 密码；邮件是否送达仍取决于被提及账号自己的 GitHub 通知设置。

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
