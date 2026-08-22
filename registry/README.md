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

[上架申请表](https://github.com/AI-Scarlett/dsh-safe-plugin-manager/issues/new?template=plugin-submission.yml)
只要求一个公开 GitHub 项目地址。Issue 创建、编辑或重新打开后，
`.github/workflows/plugin-submission.yml` 会调用 `scripts/check-plugin-submission.mjs`，自动固定默认
分支当前 Commit，读取仓库树、`package.json`、README 和 Bundle Patch，并提取包名、版本、
许可证、入口 ID、生命周期脚本和已声明的兼容范围。若 monorepo 中发现多个 DSH 插件，
机器人会列出候选目录；提交者只需补充可选的 `Plugin path`。

预检通过时添加 `submission-passed`，失败时添加 `submission-failed`，并幂等更新一条带固定
标记的机器人评论；修改 Issue 会重新检查并移除相反状态标签。每三小时运行的 Catalog
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

## 三小时自动化与自愈

- `catalog-automation.yml` 在每个三小时窗口第 5 分钟扫描、复核并生成可审计 PR；
- `pages.yml` 在第 25 分钟重新构建 GitHub Pages；
- 两台服务器的 systemd timer 在第 47 分钟校验清单、哈希、首页与 Catalog，必要时原子切换；
- `marketplace-watchdog.yml` 在第 55 分钟核验上一轮工作流以及 GitHub、Pages、国际站、国内站；
- 上一轮缺失、失败、超过四小时或公共目录不一致时，自动重跑 Catalog 或 Pages；
- 所有 Catalog 写入绑定 base Commit、文件 SHA-256、外部备份、机器计划 ID 和精确文件范围。

## 详情元数据

商城详情由 GitHub 上的同一份 `catalog.json` 提供。每个条目必须显式声明：

- `details.pluginType`、`installSource`、`license`；
- 文件、网络、命令与凭据访问，以及汇总后的权限等级；
- 外部运行依赖与审核状态；
- `compatibility` 中的 DSH、Node.js、系统和 Profile 范围。

版本矩阵继续接受历史别名 `rc.5`、`rc.6`、`rc.7`、`rc.8`；新增版本必须使用完整
SemVer 键，例如 `0.1.1-rc.2`，避免不同发布线的 `rc.1` 混淆。商城从官方 npm Registry
读取 `@deepseek-ai/dsh` 最新版本；读取超时或失败时退回目录已有版本，不影响插件列表加载。
目录中的精确 `dshReleases` 是兼容证据；新版本只有范围匹配而没有精确证据时显示
“范围支持·待验证”，不会自动标为兼容。`install`、`start`、`uninstall`、`rollback`
四项 `dshOperations` 也必须逐版本提供真实证据，缺少记录时保持 `unknown`。

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
