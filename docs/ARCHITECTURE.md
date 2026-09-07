# 技术架构

## 组件

### Bundle manifest

`package.json` 声明 `dsh.bundle.patch` 与 Web Client；`cordis.patch.yml` 只插入
`dsh-safe-plugin-manager` 自身 Host 行。删除本 Bundle 后，官方设置页面自然恢复原状。

### Host plugin

`src/index.mjs` 是薄组合层。它不把 `webServer` 设为硬依赖，而是通过
`ctx.inject(['webServer'], ...)` 延迟注册管理路由。这样 headless Profile 仍可挂载
Bundle，Web 能力缺失时不阻断启动。

### Inventory core

`src/inventory.mjs` 读取：

1. `$DSH_HOME/profiles/<profile>/package.json`；
2. `dsh.profile.bundles` 的有序列表；
3. Profile dependencies/optionalDependencies；
4. Profile `node_modules` 和 DSH 维护的 profiles fallback 中的包 manifest；
5. `link:`/`file:` 本地包 manifest（只读）。

它不解析或修改 `cordis.patch.yml`，也不读取 Loader/Fiber。运行状态因此明确标记为
`unverified`，避免从“已声明”错误推断为“已启用且正在运行”。

### GitHub registry

`registry/catalog.json` 是供历史商城读取的 schemaVersion 1 完整兼容目录，为每个插件保留旧版
验证、搜索、权限展示和固定来源操作所需的有界字段，并固定 `registry/catalog-index.json` 的路径、
SHA-256、字节数和条目数；`registry/catalog-index.json` 是
GitHub Pages 与 DSH 市场的轻量事实源索引；`registry/catalog/details/<插件编号>.json` 是对应的
完整详情记录，三者必须来自同一提交。
索引只承载插件编号、中英文名称、版本、推荐标记、顺序、GitHub 地址和有界分页辅助字段，
详情承载权限、兼容性、证据和安装信息。运行时先读取索引，再只读取当前页面或用户打开的
详情；兼容目录与索引上限均为 2 MiB，单详情上限为 512 KiB。目录摘要或详情身份不匹配时
失败关闭；远端不可用时只原子回退到随包的完整索引与详情集合，
但安装/更新前仍必须从固定 Commit 重新核对 manifest 与 Bundle Patch。

Catalog 控制面由八小时自动策略驱动：GitHub 搜索和 Issue 只提供候选；固定 Commit 的
manifest、仓库许可证、Bundle Patch、入口、文件清单、依赖、生命周期和完整有界运行时
源码共同决定 `approved`、`blocked` 或拒绝。策略只通过临时分支与 PR 修改
`registry/catalog.json`、`registry/catalog-index.json`、`registry/catalog/details/*.json` 和
`registry/candidates.json`，通过仓库检查和 CodeQL 后由 GitHub
自动 squash 合并。服务器不保存 GitHub 长期写令牌，只消费 Pages 的固定清单和哈希。

Catalog 策略在 UTC 00:05、08:05、16:05 运行；Pages、生产站原子刷新和公共看门狗仍按三小时
错峰，在各自窗口第 25、47、55 分钟运行。看门狗核验上一轮状态与四个 Catalog 表面，Catalog
超过九小时或公开面失败时自动重派 Catalog 或 Pages；服务器 timer 使用 `Persistent=true`，
恢复上线后补跑。

### Host API

`POST /api2/dsh-safe-plugin-manager/inventory`

请求：

```json
{ "profile": "web" }
```

响应：

```json
{
  "ok": true,
  "value": {
    "schemaVersion": 1,
    "mode": "read-only",
    "profile": "web",
    "bundleOrder": [],
    "plugins": [],
    "diagnostics": []
  }
}
```

API 只接受 JSON POST，限制为 16 KiB，并拒绝跨 Origin 请求。响应禁用缓存。

其余路由：

- `POST /market`：读取、搜索并合并 GitHub 目录与本地安装状态；
- `POST /health`：依赖、托管 Patch 和 DSH 配置合成；
- `POST /plan`：生成限时、单次、无写入的操作计划；
- `POST /execute`：校验精确确认语后执行事务。

`plan` 与 `execute` 还要求独立 intent Header。它是防误调用措施，不应被误解为对
同源恶意插件的认证边界。

### Transaction core

安装、更新、本地来源迁移、卸载只使用当前 DSH CLI 的固定参数数组；启停只编辑带双标记的托管
区块。事务持有 Profile 锁，检查四个文件的前置哈希，创建权限收紧的备份，执行后
运行健康检查。失败时恢复控制文件并通过官方边界离线协调依赖。

### Client plugin

`src/client.js` 通过 `window.__ModuleLoader__.load()` 注册，通过
`settings.plugins.tab` 新增 `safe-plugin-manager` 标签。它不复用官方 `all` ID，
因此不会遮蔽官方只读清单。

## 信任边界

```text
Browser UI (untrusted input)
    │ same-origin + schema/size + intent + exact confirmation
    ▼
Host routes
    │ validated Profile + catalog entry + one-time plan
    ▼
Transaction core
    │ lock + hash + backup + official CLI / managed block
    ▼
Selected DSH Profile manifests
```

## 后续扩展原则

下一阶段应接入官方 Plugin Inventory 的只读运行态状态，并在一次性 Profile 完成
真实写入和重启矩阵。不得通过 Loader/Fiber 变更替代官方运行时权威状态。
