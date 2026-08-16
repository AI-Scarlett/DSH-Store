# DSH Safe GitHub Plugin Registry

`catalog.json` 是 DSH Safe Plugin Manager 与 GitHub Pages 市场页共同读取的唯一目录。
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

## 分类、推荐与上下架

- `categories` 必须引用 `registry.categories` 中已声明的分类；页面会自动生成分类筛选；
- `featured: true` 表示推荐，在每个分类中优先显示，但不会绕过来源和安全检查；
- `status: approved` 为正常上架，`blocked` 为展示但禁止安装；
- `status: unlisted` 为下架：公共商城隐藏，已安装用户仍可停用或卸载；
- `installCount` 是可选聚合快照。客户端不得持有 GitHub 写令牌，自动计数必须通过
  独立的匿名计数服务汇总后再更新，不能让安装端直接写 `catalog.json`。

目录收录不等于完成安全审计。插件代码会以 DSH 进程权限运行，使用者必须在安装计划
中再次查看仓库、Commit、生命周期脚本和影响范围。
