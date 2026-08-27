# DSH-Store GitHub Plugin Registry

`catalog.json` 是 DSH-Store 与 GitHub Pages 市场页共同读取的唯一目录。
目录只接受 GitHub 仓库，不接受 npm-only、任意下载 URL、本地路径或浮动安装目标。

新增或更新插件必须通过 Pull Request 修改一个条目，并同时满足：

1. `repositoryUrl` 是公开的 `https://github.com/<owner>/<repo>`；
2. `manifestPath` 指向的 `package.json` 声明 `dsh.bundle.patch`；单仓库多包可同时声明
   `installPath`，安装时仍固定到同一个 Commit；
3. `commit` 是 40 位不可变 Git Commit；
4. `version` 与该 Commit 的 manifest 一致；
5. `entryIds` 与 Bundle Patch 插入的 DSH ID 一致；
6. 明确列出 `preinstall/install/postinstall/prepare` 生命周期脚本；
7. 不禁用、替换或重复安装任何 `@deepseek-ai/*` 官方组件；
8. `npm run validate:registry` 通过。

## GitHub 上架申请预检

[上架申请表](https://github.com/AI-Scarlett/DSH-Store/issues/new?template=plugin-submission.yml)
只要求一个公开 GitHub 项目地址。Issue 创建、编辑或重新打开后，
`.github/workflows/plugin-submission.yml` 会调用 `scripts/check-plugin-submission.mjs`，自动固定默认
分支当前 Commit，读取仓库树、`package.json`、README 和 Bundle Patch，并提取包名、版本、
许可证、入口 ID、生命周期脚本和已声明的兼容范围。若 monorepo 中发现多个 DSH 插件，
机器人会列出候选目录；提交者只需补充可选的 `Plugin path`。

同一工作流还会对固定 Commit 做一轮有界静态安全扫描：优先读取 manifest、Bundle Patch、
`src`/`lib`/运行时代码和脚本，最多扫描 150 个文本源码文件，单文件上限 400,000 字节；不下载
依赖，也不执行插件的 install、prepare、build、test 或运行时代码。硬编码密钥、常见临时外传
端点、针对系统/用户目录的破坏性命令以及挖矿特征会阻断提交；动态执行、子进程、Shell、远程
安装和混淆等常见 CLI 能力只产生警告并进入机器人清单。命中文件数、单文件体积、符号链接或
目录树上限时，回执必须明确显示“扫描面不完整”，不能把没读到的源码当成安全通过。

预检通过时添加 `submission-passed`，失败时添加 `submission-failed`，并幂等更新一条带固定
标记的机器人评论；修改 Issue 会重新检查并移除相反状态标签。每八小时运行的 Catalog
策略还会合并 GitHub 主动发现结果，固定默认分支当前 Commit，并以有界源码读取复用同一套
结构门禁。工作流不会运行第三方 install、prepare、build、test 或运行时代码。

该门禁是固定源策略检查，不是安全审计或 DSH 运行验证。只有 canonical GitHub、完整 Commit、
manifest/repository/license 一致、明确文件清单、无生命周期脚本和运行依赖、Bundle/入口唯一，
并且完整有界运行时源码没有文件、网络、命令、凭据、原生制品或受保护 DSH 行为信号时，才会
自动生成 `source-verified` Catalog PR；现有检查与 CodeQL 通过后自动 squash 合并。其他项目自动
拒绝、隔离或以 `blocked` 展示，不会进入受保护安装通道，也不会要求所有者机械点击确认。

提交前建议使用 [`build-dsh-plugin`](https://github.com/AI-Scarlett/build-dsh-plugin) 制作标准
Bundle、生成 Catalog 候选或执行只读上架预检。它同样遵循“不修改 DSH 核心、不写真实
Profile、不用低层测试冒充运行验收”的边界。

## 提交者自检清单

- 公开 GitHub 仓库，且目标包能够固定到 40 位 Commit；
- `package.json` 具有合法包名、语义化版本和可解析的 `dsh.bundle.patch`；
- Bundle Patch 入口 ID 唯一，不禁用、遮蔽或冒充官方组件；
- manifest 与实际许可证、生命周期脚本、Node.js/DSH 兼容声明一致；
- README 说明用途、安装/启用方式、外部依赖、权限和已知风险；
- monorepo 能唯一定位插件目录；第三方包不使用 `@deepseek-ai/*` 命名空间；
- 高权限、原生构建或外部服务明确披露，并准备一次性 Profile 的安装与功能验收证据；
- 插件在“热门、有用、有趣”至少一个维度具有收录价值。

自动准入只证明固定源码策略门槛；一次性 Profile 安装、可见性、运行效果、独立安全审核和
作者认证仍是不同证据层级。自动化不得把未执行的运行验收写成 `passed`。

## 作者整改通知

每次八小时 Catalog 扫描成功后，`author-notifications.yml` 会对四类确定性结果维护公开 GitHub
修复单：Catalog 中仍为 `blocked` 的仓库、发现更高上游版本但因源码契约暂缓更新的仓库，以及
明确属于 DSH 且被固定 Commit 门禁拒绝的候选仓库，以及因不在最新三个 DSH 版本兼容窗口而
暂时下架的仓库。修复单逐项列出原因和建议，并 `@` canonical
仓库维护者；个人仓库使用所有者，组织仓库优先使用最近的人类提交者。同一仓库只保留一单，原因
变化才再次提醒，阻断消失后自动关闭。

修复单固定附带 [build-dsh-plugin](https://github.com/AI-Scarlett/build-dsh-plugin) 自检与修改入口，
并链接 [DSH STORE 官网](https://dsh.store/) 供作者查看后续状态。修复单还记录 canonical 仓库固定
Commit 的有界指纹；后续复检会区分“已修改但仍未通过、已修改且阻断清除、未检测到新提交、首次
建立基线或暂无法判断”。该状态只表示上游源码是否变化及确定性阻断是否消失，不等同于运行时验收。

`catalog-run-report.yml` 会在每一次 Catalog 工作流完成后立即生成所有者报告；成功扫描会有界等待
最多五分钟，以纳入与同一 Catalog Run ID 绑定的作者通知计划，失败扫描也会报告失败阶段而不是
静默跳过。报告通过固定 Issue 评论 `@AI-Scarlett`，按 Catalog Run ID 只发送一次普通报告；三小时
看门狗仅在即时报告缺失时补发，或为修复/公开面失败使用独立告警标记。报告列出 GitHub 整改消息
涉及的项目数和 GitHub 通知邮件触发项目数。GitHub 是否实际投递邮件取决于被提及维护者的个人
通知设置，仓库无法读取私人邮箱回执，因此必须显示“送达未验证”，不能把触发数量表述成实际送达数量。

每轮计划会把 Candidate Registry 的全部 canonical 仓库逐一归入机器可读台账，去重后只能处于
`direct-remediation`、`public-reviewing`、`public-remediation`、`public-deferred` 或
`public-discovery-only` 之一；台账条目数、候选记录数和未覆盖数必须通过不变量校验，未覆盖不为 0
时拒绝执行。完整候选仍公开在 `registry/candidates.json` 和商城候选视图，因而不会从发现与复检链路遗漏。

全量覆盖不等于无差别群发。主动搜索中的普通项目不会因为关键词误命中而收到 `@mention`；GitHub
403/404/429、限流、超时、连接失败和默认分支移动等基础设施状态也不会归责给作者。凡是明确属于
DSH、状态为 `rejected`、并且已经有非基础设施类确定性整改原因的候选，不论来自用户提交、固定
Commit 复核还是自动雷达，都会进入一次性直接通知队列；`reviewing`、仅发现记录和没有确定结论的
项目仍只公开展示。通知必须带具体整改原因、build-dsh-plugin 和商城状态入口，不发送纯推广消息，
也不在第三方仓库批量开 Issue。同一 canonical 仓库只保留一单，未变化的签名不重复提醒。每轮最多
新建 10 单，以 `更新暂缓 → 兼容性下架 → 候选未通过 → Catalog blocked` 轮转选取。该流程只读
固定源码，不执行第三方代码，也不把修复后的再次通过承诺为真实 Profile 安装或运行验收。

Candidate Registry 只保留仍有单独复核价值的记录。`rejected` 候选按 canonical 仓库哈希分成
24 个批次，每次八小时扫描其中一批，并只读取记录内完整 Commit 的有界仓库树与 `package.json`。
如果候选已经存在其他确定性门禁失败，同时没有任何 manifest 对官方最新三个 DSH 版本给出精确
`compatible` 声明，就直接从候选库删除；当轮报告仍保留清理清单并用于一次作者整改通知。
仅因最新三版兼容性不足而暂时下架的 Catalog 条目使用 `reviewing` 候选，不适用该删除规则。
GitHub 暂时失败、仓库树截断或 manifest 数量超出有界检查面时保留候选并稍后重试，不把“没读到”
冒充“不兼容”。24 个批次在正常八小时调度下约八天覆盖一轮，无需在候选文件中保存扫描游标。

## 八小时 Catalog 自动化与三小时自愈

- `catalog-automation.yml` 在 UTC 00:05、08:05、16:05 扫描新插件，并检查所有历史 Catalog
  条目的原项目版本；版本权威源是 canonical GitHub 仓库当前默认分支的完整 Commit，以及该
  Commit 下条目 `manifestPath` 指向的 `package.json`；
- 每轮从官方 npm Registry 完整元数据读取 `@deepseek-ai/dsh` 的 `latest` 标签及其之前最近两个
  未弃用发行版，组成最新三个版本窗口；权威源不可用、元数据异常或不足三个版本时整轮失败关闭，
  不使用 Catalog 推测值执行上下架；
- `approved` 条目在三个版本中至少需要一个精确 `dshReleases: compatible` 记录；三者均为
  `incompatible`、`unknown` 或缺失时自动转为 `unlisted`，并在 Candidate Registry 新建
  `reviewing` 记录。后续固定 Commit 补齐兼容记录后自动恢复 `approved` 并只删除本策略创建的候选；
- 原项目通过 `package.json` 的 `dsh.compatibility.dshReleases` 提供逐版本声明，例如
  `{"0.1.1-rc.2":"compatible"}`；插件提升自身 SemVer 后，扫描会从新固定 Commit 读取该矩阵。
  未声明的版本写为 `unknown`，声明值只接受 `compatible`、`incompatible` 或 `unknown`；
- 自动低风险源码面仍有硬上限：最多 240 个运行时文件、单文件 262144 字节（256 KiB）、合计
  2097152 字节（2 MiB）。超过上限时报告会写出实际文件数、总字节和最大文件字节并失败关闭。
  这些是保证完整读取、限制 API/时间消耗并抵御超大输入的审核边界，不是插件运行时内存限制；
  不得通过取消上限或跳过未读源码来获得自动批准；
- 只有原项目 SemVer 高于商城版本、候选 Commit 是旧 Commit 的有界直接后继，且包名、仓库、
  manifest 路径、安装路径、Bundle 入口和许可证保持一致时，才进入固定源更新审查；
- `source-verified` 更新必须继续满足完整低风险自动策略；`user-reviewed` 条目可以自动刷新
  商城中的固定 Commit 和版本号，但真实安装仍逐次执行本机风险审查；`external-only`、blocked
  和 unlisted 条目只刷新可追溯的项目元数据，不会因此获得安装资格；
- 新版本写入后，旧版本的安装、运行、安全和精确兼容证据全部重置为 `unknown`，不把历史
  验收沿用到新版本；源码变化但没有提升版本号时只记录异常，不移动 Catalog 固定 Commit；
- `pages.yml` 仍按三小时窗口第 25 分钟重新构建 GitHub Pages；
- 两台服务器的 systemd timer 仍按三小时窗口第 47 分钟校验清单、哈希、首页与 Catalog，必要时原子切换；
- `catalog-run-report.yml` 监听每一次 Catalog 完成事件，立即发布一次按 Run ID 去重的所有者 `@mention` 报告；
- `marketplace-watchdog.yml` 仍按三小时窗口第 55 分钟核验上一轮工作流以及 GitHub、Pages、国际站、国内站；
- 上一轮缺失、失败、超过九小时或公共目录不一致时，自动重跑 Catalog 或 Pages；
- 所有 Catalog 写入绑定 base Commit、文件 SHA-256、外部备份、机器计划 ID 和精确文件范围。

公开商城首页和插件目录会读取 GitHub Pages 上的 `automation-status.json`，分别显示最近一次
Catalog 扫描、四端巡检、扫描新增数、历史版本检查数、发现的高版本数，以及最近自动新增和
版本更新的插件名称、旧版本、新版本与审查策略，并链接到对应的 GitHub Actions 运行记录。
扫描成功但没有合格新增或版本更新时会明确显示 0，不把“运行成功”和“发生变更”混为一谈。
状态文件只承载公开运行证据，不进入 Catalog 权威文件，也不会触发服务器发布备份轮转。

## 中文名称与搜索

每个可信 Catalog 条目的 `name` 必须使用 `中文名（English Name）` 格式，`description` 必须包含
面向普通用户的中文用途说明，并通过 `searchTerms` 提供中文用途、常见说法、分类词和英文包名等
搜索别名。自动发现的新条目在写入 Catalog 前执行同一套本地化规则；格式或中文搜索词缺失时，
`npm run validate:registry` 失败关闭，不允许自动合并。

商城搜索同时匹配中文名、英文名、中文用途、中文别名、包名、仓库、分类和权限信息。名称与搜索词
是正式 Catalog 数据，不是浏览器临时翻译，因此 GitHub、Pages、国际站、国内站和 DSH 内商城会
读取到同一份结果。

## 详情元数据

商城详情由 GitHub 上的同一份 `catalog.json` 提供。每个条目必须显式声明：

- `details.pluginType`、`installSource`、`license`；
- 文件、网络、命令与凭据访问，以及汇总后的权限等级；
- 外部运行依赖与审核状态；
- `compatibility` 中的 DSH、Node.js、系统和 Profile 范围。

版本矩阵只接受仍有公开发行物的历史别名 `rc.7`、`rc.8`；新增版本必须使用完整
SemVer 键，例如 `0.1.1-rc.2`，避免不同发布线的 `rc.1` 混淆。商城从官方 npm Registry
读取 `@deepseek-ai/dsh` 最新版本；读取超时或失败时退回目录已有版本，不影响插件列表加载。
目录中的精确 `dshReleases` 是兼容证据；新版本只有范围匹配而没有精确证据时显示
“范围支持·待验证”，不会自动标为兼容，也不公开不存在发行物的 rc.5/rc.6。`install`、`start`、`uninstall`、`rollback`
四项 `dshOperations` 也必须逐版本提供真实证据，缺少记录时保持 `unknown`。
自动上下架使用官方 `latest` 向前最近三个未弃用发行版作为滚动窗口；范围声明不能替代精确记录。
该规则只决定商城是否继续可安装；作者 manifest 的逐版本声明属于来源兼容声明，不把它解释为
真实 Profile 或运行时验收，`dshOperations` 仍需独立证据。

可信证据分为四种状态：`verified` 表示该道门已经有对应的完整证据，`partial` 表示只验证了明确边界内的一部分（例如一次性 Profile 安装、契约或固定源策略检查），`unknown` 表示尚未取得可引用证据，`failed` 表示检查未通过。`partial` 不得被解释为完整运行验收或独立安全审计；商城会把它单独显示为“部分验证”，避免把产品已有的可复核能力压成“未知”，也避免把局部证据夸大成完整结论。

为保证已安装的 0.8.2 能在商城内完成自举升级，schemaVersion 1 允许把 `partial` 编码为 `status: "unknown"` 与 `evidenceStatus: "partial"`。旧客户端会忽略新增字段并保守显示“未知”，当前客户端和官网使用 `evidenceStatus` 恢复“部分验证”语义。该兼容编码不能省略 `method`、`checkedAt` 或 `evidenceUrl`，也不能与 `verified` 等其他 wire status 组合。

权限值依据固定 Commit 的 manifest、README 与运行时代码信号保守填写。无法确认时必须
使用 `unknown` 或空兼容范围，不得把“未发现”写成“不访问”。`automated-scan` 和
`author-verified` 只描述来源核验层级，不代表完成安全审计。客户端优先显示 GitHub Raw
目录；随包副本只用于网络失败时的只读回退。

权限等级使用保守汇总：完全不访问文件、网络、命令和凭据时才标为 `low`；仅有范围
明确的只读、插件私有状态写入、指定服务或受限命令时可标为 `medium`；触及 Profile、
会话或其他敏感持久状态，可访问任意网络、任意 Shell、凭据，或承担插件生命周期管理
时标为 `high`。没有足够证据时使用 `unknown`，不能根据“代码中暂未搜索到”推断为
`none`。`installSource` 描述目录分发来源；已安装副本的 npm、GitHub 或本地 Bundle
来源由 Profile 扫描结果另行显示。

## 分类、推荐与上下架

- `categories` 必须引用 `registry.categories` 中已声明的分类；页面会自动生成分类筛选；
- `featured: true` 表示推荐，在每个分类中优先显示，但不会绕过来源和安全检查；
- `status: approved` 为正常上架；`blocked` 为商城不可安装，但保留 GitHub 手动安装入口
  和风险原因；手动安装不受商城事务、健康检查或回滚保护；
- `status: unlisted` 为下架：公共商城隐藏，已安装用户仍可停用或卸载；
- `installCount` 是可选聚合快照。客户端不得持有 GitHub 写令牌，自动计数必须通过
  独立的匿名计数服务汇总后再更新，不能让安装端直接写 `catalog.json`。

目录收录不等于完成安全审计。插件代码会以 DSH 进程权限运行，使用者必须在安装计划
中再次查看仓库、Commit、生命周期脚本和影响范围。
