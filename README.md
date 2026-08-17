# DSH第三方插件商城
<img width="900" height="383" alt="cover_dsh_plugin_market_900x383" src="https://github.com/user-attachments/assets/2b03ff48-a39b-427d-87c1-62190560a496" />

DSH Safe Plugin Manager 是一个运行在 DeepSeek Harness（DSH）设置页中的第三方
插件商城与安全生命周期管理器。它使用标准 DSH Bundle + Host Plugin + Client Bundle
结构，不开发独立桌面端，不修改 DSH 源码，也不替换任何 `@deepseek-ai/*` 官方包。


[打开在线插件商城](https://ai-scarlett.github.io/dsh-safe-plugin-manager/marketplace/) ·
[提交插件上架申请](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/issues/new?template=plugin-submission.yml) ·
[查看机器目录](registry/catalog.json) ·
[目录准入规则](registry/README.md) ·
[安全说明](SECURITY.md)

## 安装插件商城

### 前置条件

- DeepSeek Harness `0.1.0-rc.5` 或更高版本，并且官方 `dsh` CLI 已加入 `PATH`；
- Node.js `22.13.0` 或更高版本；
- 一个启用了 Web 客户端的目标 Profile。下面以 `web` 为例，如果你的 Profile 名称不同，
  请替换命令中的 `web`。

首次安装发生在本管理器尚未运行之前，因此还没有计划确认、自动备份、健康检查和失败
回滚保护。运行命令前，请先备份目标 Profile 的 `package.json`、`pnpm-lock.yaml`、
`pnpm-workspace.yaml` 和 `cordis.patch.yml`（文件存在时）。

### 使用固定 GitHub Commit 安装

通过 DSH 官方 CLI 安装经过目录固定的 GitHub Commit：

```bash
dsh plugin --profile web add 'git+https://github.com/AI-Scarlett/dsh-safe-plugin-manager.git#ca297cc6f68cbe007b07b30815a9811d09f9ffcc'
```

这条命令会修改目标 Profile 的依赖、锁文件、工作区文件、`node_modules` 和 Bundle 列表。
不要把 Commit 换成 `main` 等浮动分支，也不要绕过 DSH CLI 直接运行 pnpm 或手工编辑
Profile。命令失败时请保留完整错误和安装前备份，不要连续重复执行。

### 重启与验收

1. 运行 `dsh --profile web --dump-config`，确认配置可以成功合成；
2. 在商城中用独立计划安装随包提供的 DSH Guardian；它由 macOS launchd 在 DSH 进程外运行，
   不是另一个普通 DSH 插件；
3. 包操作完成后，商城会明确标记“待重启”。只有 Guardian 心跳正常时才允许生成一次性的
   `RESTART DSH <profile>` 计划；
4. Guardian 负责有界重启、30 秒稳定性观察和熔断；5 分钟内最多自动启动 3 次，不会无限循环；
5. 页面检测到新的 Boot ID 后重新读取插件清单与健康报告，只有通过才显示“已重启并生效”；
5. 如果安装、重启或页面显示异常，请在
   [GitHub Issues](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/issues) 提交原始错误，
   不要提交凭据、完整 Profile 文件或环境变量。

安装完成后，从商城发起的安装、更新、迁移、停用、启用和卸载才会进入一次性计划、
精确确认、Profile 前置哈希、备份、健康检查和失败回滚流程。

## 当前概况

| 项目 | 当前状态 |
| --- | --- |
| 商城版本 | `0.4.5` |
| 收录条目 | 32 个 |
| 可安装 | 27 个 |
| 商城不可安装 | 5 个，保留 GitHub 手动安装入口和风险原因 |
| 分类 | 22 个 |
| 推荐 | 5 个：自研四件套 + DSH Web UI All |
| 目录来源 | GitHub 仓库 + 不可变 Commit |

商城已经在真实 DSH `web` Profile 中完成只读扫描、GitHub 在线目录刷新、配置合成、
Host API 和设置页显示验证。单元、契约和事务测试已通过；真实生产 Profile 的完整
“安装—重启—停用—启用—更新—卸载—回滚”闭环仍是独立验收项，不能由测试结果替代。
<img width="1200" height="1103" alt="01_DSH插件商城总览" src="https://github.com/user-attachments/assets/2070b56a-fa3a-4fc1-b7fd-5926015887e4" />
<img width="1200" height="1323" alt="02_DSH插件权限详情" src="https://github.com/user-attachments/assets/dff94448-5dcd-4542-b5d5-39b040b8cd41" />
<img width="1200" height="1098" alt="03_DSH操作预览与确认" src="https://github.com/user-attachments/assets/5eb4f589-21c5-4ced-8133-a22bc6baeb49" />

## 功能介绍

### 插件发现与分类

- 从 GitHub 在线目录读取插件，网络失败时只回退到随包发布的已知快照；
- 按名称、包名、分类或 GitHub 仓库搜索；
- 支持 22 个分类筛选、推荐置顶、上架、商城不可安装和下架；
- 目录中的安装目标固定到 40 位 Git Commit，不接受 npm-only、任意下载地址或浮动分支；
- 商城页面和 DSH 内置界面共享同一个 `registry/catalog.json` 数据源。

### 安装与生命周期管理

- 安装 GitHub 目录中的标准 DSH Bundle；
- 检测固定 Commit 或版本变化并生成更新计划；
- 停用、启用和卸载第三方插件；
- 识别 `link:`、`file:`、`workspace:` 等本地开发来源，并单独提供“迁移到商城版”；
- 识别并标记不是通过本商城安装、来源漂移或与目录 Commit 不一致的插件；
- 商城自身仅允许更新，禁止停用和卸载。

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
- 安装 Guardian 仍需一次性计划、精确确认和文件哈希预条件，并明确展示将替换的启动任务；
- 使用固定参数数组启动 DSH，不使用 `bash -c`，记录心跳、启动状态、失败次数和熔断状态；
- 重启前扫描 Profile Patch 与所有已安装 Bundle Patch 的入口 ID；发现重复入口时将包操作
  判为不健康并立即恢复事务备份，不关闭当前 Host；
- Guardian 连续失败会打开熔断并保留故障摘要，不会把“端口暂时出现”误报成插件已健康。

### 健康检查与来源识别

- 检查 Profile 清单、依赖、管理器托管 Patch、DSH 配置合成与冷启动入口 ID 冲突；
- 合并 Bundle 和依赖信息，显示已安装版本、声明来源和官方/第三方属性；
- 区分“已验证”“部分验证”“商城不可安装”和“尚未验证”，不把声明态当成运行态；
- 运行态 Loader/Fiber 状态继续以 DSH 官方清单为权威，商城不直接控制官方运行时。

### 插件详情与权限画像

- 每张商城卡片可打开详情弹窗，集中显示插件类型、安装来源和许可证；
- 展示权限等级，以及文件、网络、命令和凭据访问范围；
- 展示外部依赖、审核状态、DSH/Node.js 版本、系统和 Profile 兼容性；
- 字段来自 GitHub 目录固定 Commit 的 manifest、README 与代码信号；无法确认时显示
  “未知”或“未声明”，不会用本地猜测覆盖目录数据；
- 自动扫描、人工检查和作者认证只表示元数据核验层级，均不等于安全审计。

### 上下架、推荐与安装计数

- `approved`：正常上架并允许生成安装计划；
- `blocked`：商城中继续展示并提供 GitHub 手动安装入口，但不提供商城安装操作；
- `unlisted`：公共商城隐藏，已安装用户仍可停用或卸载；
- `featured: true`：在全部视图和所属分类中优先显示；当前推荐自研四件套和用户精选的
  DSH Web UI All；
- 可选安装回执只发送插件 ID 和版本，不发送设备、Profile 或用户标识；默认关闭；
- GitHub Pages 不能直接写回 `catalog.json`，真实计数需要独立匿名聚合服务。

## 使用方式

安装并启动管理器后，在 DSH 中打开：

```text
设置 → 插件 → 插件商城
```

界面包含三个视图：

1. **插件市场**：搜索、分类筛选、查看推荐、安装、更新或迁移；
2. **已安装**：查看来源、版本、商城托管状态，并停用、启用或卸载；
3. **健康检查**：检查 Profile、依赖、托管 Patch 和配置合成状态。

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
| Agent Reach 适配接入 | [`d37fb46`](https://github.com/AI-Scarlett/dsh-agent-reach/commit/d37fb46edf783446b430d324c68ac911b84a14b0) | 将原生 Python/MCP/Skill 项目封装为无安装脚本的 DSH Skill 适配插件，并明确外部运行时与高权限边界。 |

完整的验证边界与发布证据见 [验证记录](docs/VERIFICATION.md)，产品与架构决策见
[产品需求](docs/PRODUCT_REQUIREMENTS.md) 和 [技术架构](docs/ARCHITECTURE.md)。

## 已收录插件

`★` 表示推荐。当前推荐 `AI-Scarlett` 自研四件套，以及用户精选的社区插件
DSH Web UI All；推荐不会绕过固定 Commit、来源和风险校验。以下列表与当前
`registry/catalog.json` 一致。

| 插件 | 分类 | 状态 | 介绍 |
| --- | --- | --- | --- |
| ★ [DSH Safe Plugin Manager](https://github.com/AI-Scarlett/dsh-safe-plugin-manager) | 插件市场、管理工具 | 可安装 | 本插件商城与安全生命周期管理器；自身仅允许更新，禁止停用和卸载。 |
| ★ [DSH Chat Import](https://github.com/AI-Scarlett/dsh-chat-import) | 会话与消息、导入迁移 | 可安装 | 将 Claude Code、Codex、ChatGPT、Cursor 等会话导入 DeepSeek Harness。 |
| ★ [DSH CLIAPI](https://github.com/AI-Scarlett/DSH_CLIAPI) | 模型与账号、模型路由 | 可安装 | DSH 的授权中心与自动本地模型路由器。 |
| ★ [DSHLLM API](https://github.com/AI-Scarlett/DSHLLM_API) | 模型与账号、模型路由 | 可安装 | 面向 DSH 的多模态感知模型路由器，需要 DSH CLIAPI。 |
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
| ★ [DSH Web UI All](https://github.com/zhu1090093659/dsh-web-ui) | 综合套件、界面增强、工具能力 | 可安装 | 聚合任务板、Git 图、宠物、远程界面、实时统计、SSH、视觉工具与多款皮肤。 |
| [DSH Shortcuts](https://github.com/Ricketts-Guo/dsh-shortcuts) | 界面增强、工具能力、新锐实验 | 可安装 | 提供可录制、可配置的键盘快捷键与权限切换反馈。 |
| [DSH Diagram](https://github.com/hanzhangzzz/dsh-diagram) | 可视化、设计与原型、新锐实验 | 可安装 | 将文章转换为可编辑的 Excalidraw 画布并在会话中持续管理。 |
| [DSH Egress Guard](https://github.com/tancheng33/dsh-egress-guard) | 安全与隐私、工具能力、新锐实验 | 可安装 | 提供出站域名策略、工具结果密钥脱敏和追加式审计日志，默认监控模式。 |
| [DSH Achievements](https://github.com/WJNCT55555/dsh-achievements) | 娱乐、界面增强、新锐实验 | 可安装 | 添加成就引擎、图鉴、提示、奖杯与进度持久化。 |
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
目录外插件则需决定是否接受未知权限边界。选择仅用于形成个人健康审核结论，不会修改
Profile，也不会限制插件进程的真实能力；真正的权限隔离仍由 DSH 宿主和沙箱负责。

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

如果你开发或发现了值得收录的 DSH 插件，可以通过
[插件上架申请表](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/issues/new?template=plugin-submission.yml)
留言提交。申请需要提供公开 GitHub 仓库、完整 40 位 Commit、包名和版本、DSH 入口 ID，
并如实声明安装生命周期脚本。

联合审核任务每天北京时间 06:00 和 18:00 依次处理 GitHub 主动发现项目与用户提交，
统一去重后按照“热门、有用、有趣”三个维度筛选，并复核许可证、来源、权限、兼容性、
Bundle Patch、受保护条目和固定 Commit。审核通过只会生成候选目录草案与一次性变更计划；
实际写入商城目录、提交 Pull Request 或合并仍需要逐次人工确认。

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
