# 自动收录、历史版本更新与发布

## 两个库承担不同职责

- `registry/candidates.json` 是候选发现库：没有安装动作，条目必须晋级后才能进入商城可信安装路径。
- `registry/catalog.json` 是 Catalog 权威目录：记录固定 Commit、版本、包路径、入口、权限、兼容性和证据状态。

Catalog 的远端 GitHub `main` 是权威；本地副本或页面缓存只可用于诊断，不能替代合并后的远端目录。

## 每 8 小时扫描什么

自动化会：

1. 通过 `dsh-plugin`、`deepseek-harness` 等 GitHub 主题与检索词发现有限数量的新仓库。
2. 对全部历史 Catalog 条目读取 canonical GitHub 默认分支，并将 manifest 版本与当前固定版本比较。
3. 新版本只有在完整 Commit 上重新通过身份、许可证、Bundle、入口、依赖、生命周期和权限门禁后，才进入 Catalog 更新 PR。
4. 从官方 npm Registry 读取最近三个 DSH 完整发布版本；至少兼容其中一个版本才保留可收录资格。已收录但不再满足时会暂时 `unlisted`，候选中同时“其他门禁失败且没有最新三版精确兼容证据”的条目会被清理。
5. 为插件生成面向普通用户的中文用途信息，并保留英文项目名、包名和搜索词；展示遵循“中文名（English Name）”，搜索仍可使用中文用途、英文名、包名、分类或 GitHub 仓库。

## 自动准入门禁

自动批准要求公开 canonical GitHub 仓库和完整 40 位 Commit，并要求：

- 根目录或明确 monorepo 子目录中的标准 DSH Bundle；
- manifest 仓库、包名、版本、许可证与实际仓库匹配；
- 显式 `files`、安全的 `dsh.bundle.patch`、唯一入口 ID；
- 明确 DSH 与 Node.js 兼容性；
- 无安装生命周期脚本、运行时依赖、符号链接、子模块；
- 无文件、网络、命令、凭据、受保护 DSH 组件或原生可执行文件权限信号。

任何未知、超限、歧义或高风险证据都失败关闭，进入候选、暂缓或阻止状态，而不是降低标准自动上架。

## 写入与发布

扫描先绑定当前 `main` Commit、Catalog 哈希和候选库哈希，生成机器可读计划。只有计划未漂移、`npm run check`、Registry 校验和 CodeQL 全部通过时，GitHub Actions 才会通过短期令牌创建 PR、等待门禁并 squash 合并。

Catalog 工作流在扫描 Job 结束后，直接以可复用 Job 调用 `author-notifications.yml`，再调用
`catalog-run-report.yml`；两者都绑定当前 Catalog Run ID、Run Attempt 和同一次运行中的精确 Artifact，
不再依赖 `workflow_run` 事件串联。所有者报告在固定报告 Issue 中 `@AI-Scarlett`，从而触发 GitHub
站内通知及用户配置允许时的邮件转发。普通报告以 Catalog Run ID 幂等去重，不依赖三小时定时器；
失败扫描也会报告失败阶段，作者通知只在扫描策略 Job 成功后执行。

合并后，GitHub Pages 构建公开商城。看门狗每 3 小时分别核对：

- GitHub Raw Catalog；
- GitHub Pages Catalog；
- `dsh.store` 国际站 Catalog；
- `dsh-store.cn` 国内站 Catalog。

看门狗发现上一次 8 小时扫描超过 9 小时未成功时，会用本轮唯一请求 ID 补跑 Catalog、定位与该请求
严格匹配的新 Run ID，并等待它完成；随后再把该 Run ID 和 Run Attempt 直接传给报告工作流，绝不读取
补跑前的旧扫描。报告工作流按 Catalog Run ID 幂等，Catalog 内联报告已成功时补调用会安全跳过；内联
报告失败时则完成恢复。发现公开页面陈旧时仍会重跑 Pages 构建。只有补跑最终失败、报告恢复失败或
公开面仍失败时看门狗才标红。每次报告列出新增数量、历史插件更新数量、清单、作者通知量和公共表面状态。
