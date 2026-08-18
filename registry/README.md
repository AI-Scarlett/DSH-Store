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
支持仓库根包和 monorepo 子目录。Issue 创建、编辑或重新打开后，
`.github/workflows/plugin-submission.yml` 会调用 `scripts/check-plugin-submission.mjs`，读取公开
固定 Commit，并复用目录校验器检查 manifest、Bundle Patch、包名/版本、入口 ID、生命周期
脚本、受保护条目、分类、权限和兼容性字段。

预检通过时添加 `submission-passed`，失败时添加 `submission-failed`，并幂等更新一条带固定
标记的机器人评论；修改 Issue 会重新检查并移除相反状态标签。只有通过预检的申请才进入
每天北京时间 06:00 和 18:00 的“热门、有用、有趣”人工筛选。工作流权限只包含
`contents: read` 与 `issues: write`，不会检出申请仓库，也不会运行第三方 install、prepare、
build 或 test 脚本。

该门禁是固定源静态一致性检查，不是安全审计或 DSH 运行验证。通过不会自动修改
`catalog.json`、创建 Pull Request 或合并；正式上架仍需人工复核、一次性变更计划和明确确认。

## 详情元数据

商城详情由 GitHub 上的同一份 `catalog.json` 提供。每个条目必须显式声明：

- `details.pluginType`、`installSource`、`license`；
- 文件、网络、命令与凭据访问，以及汇总后的权限等级；
- 外部运行依赖与审核状态；
- `compatibility` 中的 DSH、Node.js、系统和 Profile 范围。

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
