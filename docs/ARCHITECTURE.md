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

`registry/catalog.json` 是 GitHub Pages 与 DSH 市场的单一事实源。运行时优先读取
GitHub Raw；不可用时回退到随包快照，但安装/更新前仍必须从固定 Commit 重新核对
manifest 与 Bundle Patch。

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
