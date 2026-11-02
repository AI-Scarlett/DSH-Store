# DSH Desktop 商城自更新与全量目录复核

## 当前运行界面

2026-11-02 通过 DSH Desktop 的实际界面读取到：运行 DSH Store `0.9.26`，Catalog 已固定 `0.9.27`，页面显示 779 条（33 条 Catalog 已审核、746 条待复核、39 页）。商城自身详情中的更新按钮为禁用状态，提示“商城更新条件未满足”。因此用户没有运行已经包含完整目录、全量搜索和独立列表滚动的 `0.9.27` 源码。

可见的搜索框、分类筛选、状态筛选和分页均已渲染。尝试对真实 Desktop 输入搜索词和滚动时，原生窗口自动化后端返回窗口不可用；不把源码 fixture 或一次截图当作真实交互验收。

## 根因

商城自身更新沿用了普通第三方包的旧来源约束：

- `desktopBundleNeedsUpdate` 必须从当前安装来源解析出完整 40 位旧 Commit；DSH 返回的旧安装来源只要含规范仓库和旧版本、但没有 Commit pin，更新入口就消失。
- `managerSupports('update')` 无条件要求 `removeBundle()`；DSH Store 自更新路径实际按设计跳过移除，直接调用 DSH `installBundle()`。
- `confirmAction` 在区分 Store 自更新前仍要求旧 Commit，以便第三方更新恢复。这个前置条件不适用于 DSH 原子处理的 Store 自更新。

这三处门禁发生在调用 DSH 之前，因而只要其中一项不满足，DSH 就没有机会对正确的固定目标 Commit 作最终判断。当前 Desktop 详情只显示汇总提示，没有暴露实际安装来源 Commit 或 Manager 方法列表，因此无法从 UI 确定到底是哪一项触发禁用；修复覆盖 Store 自更新不需要旧 Commit 或 `removeBundle()` 的根本设计问题。

## 官网目录对照

- DSH STORE 自有目录 `https://dsh.store/plugins/` 提供全部公开记录、分类、独立收录状态、搜索、排序和分页；读取时页面显示 20,021 条记录、961 条 Catalog 匹配、19,060 条未收录记录、46 个分类。公开索引为 19,345 条且页面标注 2026-10-13 生成，说明该生产域名目录快照落后于当前 main。
- GitHub Raw 与 Pages 上的当前 `registry/discovery-index.json` 均为 24,171 条；`dsh-store.cn` 仍返回旧的 19,345 条索引。发布后必须继续逐站确认数据和目录页面。
- `https://www.dsh.so/artifacts/` 也显示 24,171 条，但它是独立社区站点，不是 DSH STORE；它的验证等级不替代 DSH STORE Catalog 状态。
- 源码 `0.9.27` 已使用完整公开索引，并将 Catalog 收录、审核建议和候选状态分别展示。未收录条目保持浏览记录，不因此获得安装权限；可执行操作仍交给 DSH Desktop 官方插件管理器。

## 修复

源码 `0.9.28` 将例外严格限定为 `dsh-safe-plugin-manager` 的精确包名、Catalog ID 和规范 GitHub 仓库。若 DSH 清单确认安装版本落后于稳定 Catalog 版本，即使旧来源未 pin 完整 Commit，也开放自更新；必须通过 DSH `listBundles()` 读到旧状态，并由 DSH `installBundle()` 收到 Catalog 固定 Commit。自更新不调用 `removeBundle()`。

DSH 的明确拒绝继续显示为失败，旧版来源通过包名、版本、仓库和原始来源字符串精确回读后标记为仍保留。不确定结果只核对一次、不重试。普通第三方更新仍要求完整旧 Commit，并保留原有移除与恢复保护。

## 验收状态

- 新增隔离 Desktop fixture：旧来源无 Commit 且 Manager 未提供 `removeBundle()` 时可以提交固定自更新；DSH 明确拒绝时保留拒绝信息、不卸载、不重试。
- Desktop compatibility tests：40/40 通过。
- `npm run check`：通过，`REGISTRY_OK entries=875`，全量 587/587 通过。
- `npm pack --dry-run --json`：通过，`dsh-safe-plugin-manager@0.9.28`，1,075 个文件。
- `node --check src/client.js` 与 `git diff --check`：通过。
- 计划后置哈希校验和精确 HEAD PR CI：待完成。
- Source PR、独立 Catalog `0.9.28` 发布、Raw/Pages/两域名公网回读：待完成。
- 真实 Desktop 更新、滚动和键盘搜索：需要单独确认的 DSH Desktop 操作计划；当前不改真实 Profile。
