# 验证记录

日期：2026-08-16。

## 已通过

- `npm run check`：语法检查、目录校验和 29 项单元/契约/事务测试全部通过；
- `npm pack --dry-run --json`：打包预览成功，运行包只包含 README、安全说明、
  第三方说明、manifest、Bundle Patch 与 4 个 `src` 文件；
- 真实 Profile 只读检查：扫描器读取本机现有 `web` Profile，识别 5 个条目、
  无诊断错误；
- 零写入核对：扫描前后比较 `package.json`、`cordis.patch.yml`、
  `pnpm-lock.yaml` 的 SHA-256，结果为 `LIVE_PROFILE_HASHES_UNCHANGED`；
- 敏感信息扫描：项目内没有本机绝对路径、私有聊天链接或凭据值。
- `npm run verify:registry-sources`：27 个 approved 条目的 GitHub 固定 Commit
  manifest、版本、Bundle 入口与生命周期脚本复核通过；
- 安装失败故障注入：临时 Profile 的控制文件恢复到精确前置内容，依赖恢复命令走
  官方 DSH 边界；
- 托管 Patch 测试：空数组和既有用户序列均可停用/启用，区块外字节保持不变。

## 真实 `web` Profile 集成

- 安装前备份：已保存 `package.json`、Bundle Patch 与工作区/锁文件（如存在），
  并生成 SHA-256 清单；
- 官方安装入口：通过 `dsh plugin --profile web add <local-checkout>` 安装，本项目
  以本地链接依赖和 Bundle 记录存在；
- 配置合成：`dsh --profile web --dump-config` 通过；
- 进程与端口：DSH Web 重启后持续运行，`127.0.0.1:3080` 可访问；
- Host API：同源请求 `POST /api2/dsh-safe-plugin-manager/inventory` 返回 HTTP 200，
  `mode=read-only`、`profile=web`、`plugins` 长度为 6、无诊断错误；
- Client UI：浏览器实测“设置 → 插件 → 插件商城”可见，显示只读提示、Profile
  与 6 个插件条目；
- DSH 源码：安装过程中没有修改 DSH 源码或替换任何 `@deepseek-ai/*` 包。

### `0.2.0` 升级后只读验收

- DSH 重启后管理器清单版本为 `0.2.0`，Web 首页与 5 个 Host API 均可用；
- 市场页显示 3 个种子条目：1 个已安装本地链接、1 个可安装、1 个因遮蔽官方清单
  被策略阻止；
- 发布前 GitHub Raw 目录不可用时，页面明确显示 `内置目录回退` 与
  `CATALOG_UNAVAILABLE`，没有伪装成在线目录；
- 搜索 `chat` 后浏览器只显示 1 个匹配条目；
- 健康检查显示 `healthy`，inventory、dependencies、managed-patch、
  config-composition 四项均为 `pass`；
- 浏览器生成 `dshmarket` 安装计划，固定 Commit、`prepare` 脚本、影响范围、永久
  保护范围和确认语均可见；确认语为空时执行按钮保持禁用；
- API 与浏览器只读验收前后，`package.json`、`cordis.patch.yml`、lockfile、
  workspace 文件 SHA-256 均保持不变；没有执行安装计划。

### GitHub 发布验收

- 公开仓库：`https://github.com/AI-Scarlett/dsh-safe-plugin-manager`；
- GitHub Pages 工作流完成，市场页面与 Pages 目录 JSON 均返回有效内容；
- GitHub Raw 默认目录返回 17 个目录条目，其中 15 个 approved、2 个 blocked；
- 真实 DSH 强制刷新市场后返回 `source.kind=github`、`errorCode=null`，来源 URL
  为本仓库的 `registry/catalog.json`，不再使用内置目录回退；
- 本次发布没有执行任何第三方插件安装、更新、启停或卸载操作。

### `0.3.0` 分类市场验收

- 目录声明 14 个分类、17 个在架条目和 4 个推荐条目；推荐范围仅限
  `AI-Scarlett` 自有的商城管理器、会话导入、CLIAPI 和 DSHLLM API；
- GitHub Pages 浏览器实测出现分类选择器与推荐徽标；选择“模型与账号”后仅显示
  `DSH CLIAPI`、`DSH Command Code Provider`、`DSHLLM API`；
- 推荐条目在当前分类中优先排序，未声明 `featured` 的普通条目按 `false` 处理；
- 自有 `DSH_CLIAPI` 与 `DSHLLM_API` 的 `plugin/` 子目录通过 pnpm 固定 Commit
  安装解析测试；商城自身固定到 `0.3.0` 源提交，且只允许更新；
- 真实 DSH 刷新后返回 `source.kind=github`、17 个条目、14 个分类；健康状态为
  `healthy`，本机 4 个自有插件均标记为“本地开发安装”；
- 安装来源台账、`unlisted` 下架隐藏和最小化安装回执均有自动测试；回执默认关闭，
  尚未部署统计接收服务，因此没有声称真实安装次数。

### `0.3.1` 商城命名与本地来源迁移

- Client 契约将 Settings 页签改为“插件商城”，页面标题改为
  “DSH第三方插件商城”；
- `link:`、`file:` 与 `workspace:` 来源只获得单独的 `migrate` 操作，普通
  `update` 仍以 `LOCAL_SOURCE_PROTECTED` 失败关闭；
- 迁移计划必须明示来源切换边界、固定 Commit、可能修改文件和确认语，
  执行仍经由官方 DSH CLI、事务备份、健康检查与失败回滚；
- 一次性 `DSH_HOME` 实测先安装本地链接，再使用官方
  `dsh plugin --profile migration add <fixed-git-commit>` 切换来源；Profile 依赖
  最终为 `github:AI-Scarlett/dsh-safe-plugin-manager#64949...`，安装包版本为
  `0.3.0`，项目工作树没有出现 CLI 额外改动；
- 上述测试为一次性环境的官方 CLI 来源切换证据，不等于真实 `web`
  Profile 已迁移；真实 Profile 仍留给用户在 UI 中生成计划并精确确认。
- 商城自身目录条目升级为 `0.3.1`，并固定到包版本为 `0.3.1` 的功能
  提交 `80fefeca68d9a206b1811e54edc6905f24c08269`。

### 热门插件清单扩充

- 按指定会话的 20 个项目核对，5 个既有仓库去重，新增 14 个目录卡片；另有 1 个
  仓库因声明与既有主题完全相同的包身份而不重复建卡；
- 当前目录共 31 个条目、22 个分类：26 个 `approved`、5 个 `blocked`，没有
  `unlisted`；推荐仍严格只有 `AI-Scarlett` 自有四个插件；
- 11 个新增可安装条目的固定 Commit 来源复核通过；3 个不满足单包标准 Bundle 或
  当前 Web Profile 边界的项目仍分类展示，但不会出现安装操作；
- GitHub Pages 页面标题同步为“DSH第三方插件商城”。

### `0.4.0` 插件详情、手动入口与更新执行修复

- 31 个目录条目全部声明插件类型、安装来源、许可证、权限等级、文件/网络/命令/凭据
  权限、外部依赖、审核状态，以及 DSH、Node.js、系统和 Profile 兼容性；缺失必填字段
  或空凭据权限数组会使目录校验失败；
- 26 个 `approved` 条目的固定 Commit manifest、包名、版本、许可证（manifest 有声明时）、
  Bundle Patch、入口 ID 和生命周期脚本已再次在线复核通过；
- DSH Client 和 GitHub Pages 均提供详情弹窗，搜索同时覆盖中文权限标签与兼容性字段；
- 5 个 `blocked` 条目改为面向用户的“商城不可安装”，不生成商城安装计划，但保留
  “前往 GitHub 手动安装”入口、项目原因以及脱离商城备份/健康检查/回滚保护的提示；
- DSH CLI Runner 在固定参数数组和无 Shell 前提下，将 Node 可执行文件目录加入子进程
  `PATH`；退出码 127 会报告 `DSH_PNPM_NOT_FOUND`，且不会运行没有必要的依赖恢复；
- 商城自身目录条目升级为 `0.4.0`，并固定到功能提交
  `f3a93c25bb43fa4512c12aea82437538d63e3c4a`；
- `npm run check` 的语法、目录校验和 34 项单元/契约/事务测试全部通过；GitHub Pages
  内联 ES Module 另行通过 Node 语法检查；
- 以上不等于真实 `web` Profile 已迁移到 `0.4.0`，也不等于 5 个手动安装项目已获
  商城安全批准。

### `0.4.1` 首次安装入口与商城自身来源同步

- README 顶部新增首次安装前置条件、Profile 文件备份边界、官方 DSH CLI 固定 Commit
  命令、配置合成、重启和设置页验收步骤；
- `package.json` 与 README 商城概况同步升级为 `0.4.1`，发布锚点
  `10bc2f5ef79dd10892a8a90849a1fd2684dfc3f6` 包含截至本轮的已安装页、详情、操作按钮、
  高对比 Tab 与首次安装说明；
- README 安装目标与商城自身目录条目统一固定到该发布锚点，不使用 `main` 等浮动来源；
- 目录契约测试要求 `package.json`、README 商城版本、README 安装 specifier 与
  `catalog.json` 商城自身条目完全一致，防止版本、文档与更新目标再次漂移；
- `npm run check` 的目录校验和 38 项测试通过，27 个可安装条目的在线固定来源复核均为
  `SOURCE_OK`，`npm pack --dry-run --json` 确认 README 包含在 20 个发布文件中；
- 本轮只验证仓库、GitHub 固定来源与打包内容，不修改真实 Profile，也不把命令存在或
  单元测试通过当作真实 DSH 安装、重启和 UI 验收成功。

### DSH Web UI All 精选推荐

- 该项目此前已作为 `@linxin666/dsh-web-ui-all` 收录，版本 `0.1.17`，固定 Commit
  `5f7da01c4241eddb17d9d3326235f4219eb5b4ab`，不是重复新增条目；
- 用户明确选择后设置 `featured: true`，推荐总数由 4 个变为 5 个；自研四件套继续
  保持推荐，新增的第 5 个推荐明确标注为社区来源；
- 固定 Commit 的 manifest、Apache-2.0 许可证、Bundle Patch、12 个入口 ID 和
  `prepare` 生命周期脚本再次通过目录来源复核；推荐不等于安全审计。

### Agent Reach for DSH 适配上架

- 上游 `Panniantong/Agent-Reach` 固定核验到版本 `1.5.0`、Commit
  `93ae1d18c37b707dec053c7c4f9d91cd8ef8943d`；确认其是 Python CLI/MCP/Skill 项目，
  不是可直接安装的标准 DSH Bundle；
- 新建公开适配仓库 `AI-Scarlett/dsh-agent-reach`，版本 `0.1.0`、固定 Commit
  `d37fb46edf783446b430d324c68ac911b84a14b0`；适配包无生命周期脚本，仅通过隔离的
  `@deepseek-ai/dsh-skill-filesystem` Provider 挂载 Skill；
- 适配仓库 `npm run check` 的 3 项契约测试与 `npm pack --dry-run --json` 通过，打包
  结果为 7 个运行文件、无 bundled dependencies；
- 一次性 `DSH_HOME` 中通过官方 `dsh plugin --profile web add <local-checkout>` 安装，
  `dsh --profile web --dump-config` 成功合成 `dsh-agent-reach-skill-provider`；没有写入
  真实 `web` Profile，也没有安装或调用 Agent Reach Python 运行时；
- 商城目录增加为 32 个条目，其中 27 个 `approved`、5 个 `blocked`；推荐条目仍为
  原有 5 个，Agent Reach 未设置推荐；目录明确披露高权限、外部 Python/CLI/API 依赖
  和“人工检查、非安全审计”状态。

官方安装命令曾把 Profile 中两个既有本地依赖也识别为 Bundle，但它们的链接包未
提供所声明的 Bundle Patch，导致首次重启失败。最终仅从 `bundles` 数组移除这两个
误识别条目，保留原依赖及原有 Patch 加载方式；当前 Bundle 集合为安装前 3 项加
本管理器 1 项。该兼容性处理没有改动两个本地插件的代码。

### `0.4.8` Guardian 单一所有者与健康探测

- 功能源码固定到 `ed8722b20073cb61c7041e3e8eab6e5e10ed6d6d`；商城自身目录条目、
  README 安装命令和 `package.json` 统一为 `0.4.8` 与该不可变 Commit；
- Guardian 不再用“3080 端口可连接”替代健康结论；首页 HTTP、商城 runtime API、
  Profile 和 Boot ID 必须同时匹配，连续探测失败并超过启动宽限期后才进入有界重启；
- 已覆盖 Guardian 自有子进程半挂、未知进程占用端口、外部 DSH 身份匹配但未持有所有权、
  旧版心跳兼容以及固定 launchctl 参数等自动化故障场景；
- 商城不再显示复制或手工启动第二个 `dsh web` 实例的命令；端口所有权不明确时，一键重启
  保持禁用，Guardian 不杀死、不冒充接管外部进程；
- 一次性 `DSH_HOME` 使用官方 DSH CLI、Node `v24.19.0` 与 pnpm `10.32.1` 安装固定 Commit，
  `--dump-config`、随机 loopback 端口首页、runtime API 和 inventory API 均通过；读取到的商城
  版本为 `0.4.8`，临时目录随后清理，真实 `web` Profile 三个控制文件哈希保持不变；
- 本节是仓库发布证据，不代表真实 `web` Profile 已更新或当前进程已由新版 Guardian 接管；
  真实安装、重启、单进程与可见 UI 仍属于独立 E4 验收。

### `0.8.0` DSH 0.1.1-rc.1 兼容与分页验收

- 商城功能源码固定到本地提交 `b9be979ff42deacff5e344e2e5d36c13638c95b9`；
  Build DSH Plugin 0.3.0 已发布到固定提交
  `fc69bf9cf6547e9ef02d227fd5ec5c19995e3acf`，公开 manifest、插件自有 Patch、Host
  入口、Release 与 ZIP SHA-256 已回读；商城提交在推送和公开回读前仍不标记为公开来源已验证；
- 商城 `npm run check` 通过 103 项单元、契约、事务与分页测试；Build Plugin
  `npm run check` 通过 Bundle、Skill、审计器、候选隔离和分发一致性检查；
- Catalog 保持 400 条，`0.1.1-rc.1` 矩阵为 274 compatible、117 unknown、
  9 incompatible；每个条目都有独立 install/start/uninstall/rollback 记录，缺少 E3
  证据时保持 unknown；
- 两个插件分别在独立临时 `DSH_HOME` 中通过官方 DSH `0.1.1-rc.1` CLI 安装、
  `--dump-config`、随机 loopback 端口 Web 启动、HTTP 200 和卸载；
- 商城额外通过 Inventory、Runtime 和 Market API HTTP 200，Market 首屏返回 24 条、
  公开总数 398 条，并在响应中携带 `0.1.1-rc.1` 兼容键；
- 真实 `web` Profile 的 `package.json`、`cordis.patch.yml`、`pnpm-lock.yaml` 哈希分别保持
  `4aa15cd22c7928cd81dc7e15b5fb1d53c1b40612ee6e5b9305527450f34fd48d`、
  `fdcedd3c71bf66db83ba9da8391f91291c54023347a2e8e2d0026120f022f7e2`、
  `1a5eb5138278d034fdd352854d0afc912f6d3b33868b4d5c889ff86c00e47e45`。

## 尚未验证

- 本轮没有注入失败事务验证回滚；其余 398 个 Catalog 条目也没有逐一执行 rc.1 E3；
- 尚未在一次性 Profile 中覆盖 headless、损坏 manifest、缺失依赖和坏链接；
- 运行态 Loader/Fiber 状态仍明确显示为“尚未核验”；
- 尚未在真实 Profile 执行商城 `0.8.0` 或 Build Plugin `0.3.0` 的安装、更新、启停或卸载；
  当前写入证据仅来自临时目录测试；

因此当前结论是“安全写入代码和临时目录故障注入通过”；只有重新完成真实 UI
只读验收，不能把它表述成“真实第三方插件生命周期闭环已通过”。
