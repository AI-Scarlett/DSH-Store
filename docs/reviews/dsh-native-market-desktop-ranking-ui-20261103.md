# DSH Desktop 榜单计数与商城留白修复复核

## 问题与现场复现

当前主线和 Catalog 已发布 Store `0.9.30`。在运行中的 DSH Desktop 里切换“推荐榜单”和“必装榜单”时，卡片内容会跟随所选榜单变化，但两个顶部标签都显示当前榜单的数量：推荐榜选中时均为 160，必装榜选中时均为 30。原因是标签共用当前视图的 `rankedDirectoryRows.length`。

页面主容器没有左右内边距，标题、提示、筛选控件和卡片都贴着 Desktop 内容边缘；截图与现场界面一致。

## 修复

- 将推荐榜和必装榜分别生成并缓存；两个标签始终读取各自榜单的总数。当前视图的搜索、分类、结果数和分页仍从当前榜单派生。
- 在商城滚动根容器增加居中与响应式左右留白：`clamp(16px, 2.5vw, 30px)`；卡片间距从 10px 加到 14px。sticky 搜索栏和滚动容器仍沿用原结构。
- 源码版本提升到 `0.9.31`。Catalog 仍固定 `0.9.30` / `4939e294af0096621c3ba3fccbd3e94779b7aff3`；本源码 PR 不修改 Catalog。若要让已安装 Desktop 获取 `0.9.31`，后续需单独生成 Catalog policy plan 并按该计划要求的确认短语提交。

## 验收

- 实际 DSH Desktop 操作：已在现有 `0.9.30` 版本复现标签数字串用；此次新源码没有加载到真实 Desktop。
- Disposable Desktop 用例：45/45 通过。榜单 fixture 特意设置了不同榜单总数，逐次检查两个标签各自的计数，并核对各榜分页条目；同时检查根容器的留白和卡片间距。
- `npm run check`：通过；注册表校验 `entries=875`、`discoveryEntries=24171`；测试 592/592 通过。
- `npm pack --dry-run --json`：通过，包为 `dsh-safe-plugin-manager@0.9.31`，1,075 个文件。
- `node --check src/client.js`、typed plan verifier、`git diff --check`：通过。
- `build-dsh-plugin` 静态审查给出 `72/80` 和 `BLOCKED`，原因是它把两个测试中描述权限扫描的字面帮助文本误报为可能写入 `~/.dsh`。已检查对应内容：它们是字符串和正则样例，没有文件写入；该通用审查结果不替代仓库 disposable tests，也不作为此次 UI 修复通过的证据。
- 没有安装或更新真实 DSH Profile，没有重启 Desktop，没有运行第三方插件代码。

## 决策记录

| decision | objective | benefit | cost | evidence | reconsider when |
| --- | --- | --- | --- | --- | --- |
| 分别缓存两个榜单的完整行 | 防止未选中的榜单标签借用当前榜单计数 | 标签数量与榜单身份保持一致，切换不重跑同一榜单 | 数据或目录更新时需要各生成一份行列表 | disposable fixture 两榜不同总数并逐个切换断言 | 官网改为提供可信的每榜总数接口时 |
| 根容器使用 clamp 左右留白 | 让商城内容符合 Desktop 的页面边界 | 标题、筛选和卡片共享内容边界；窄面板自动收缩 | 可用于卡片的横向空间减少 | Client harness 检查 CSS clamp，实际旧版本 Desktop 已确认原问题 | 若小尺寸 Desktop 需要低于 16px 的边距 |

## 发布边界

源码修复通过本地验证后走 CI 检查的 PR。Catalog 发布仍是独立变更；实际 Desktop/Profile 接受只在 `0.9.31` Catalog 发布后、单独加载新源码时验证。回滚方式为通过审计 PR 回退本次源码提交；Profile 未改，无需 Profile 回滚。
