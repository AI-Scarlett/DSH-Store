# 技术架构

## 组件

### Bundle manifest

`package.json` 声明 `dsh.bundle.patch` 与 Web Client；`cordis.patch.yml` 只插入
`dsh-safe-plugin-manager` 自身 Host 行。删除本 Bundle 后，官方设置页面自然恢复原状。

### Host plugin

`src/index.mjs` 是薄组合层。它不把 `webServer` 设为硬依赖，而是通过
`ctx.inject(['webServer'], ...)` 延迟注册只读路由。这样 headless Profile 仍可挂载
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

### Client plugin

`src/client.js` 通过 `window.__ModuleLoader__.load()` 注册，通过
`settings.plugins.tab` 新增 `safe-plugin-manager` 标签。它不复用官方 `all` ID，
因此不会遮蔽官方只读清单。

## 信任边界

```text
Browser UI (untrusted input)
    │ same-origin + schema/size validation
    ▼
Host route (read-only contract)
    │ validated profile name
    ▼
Inventory core
    │ readFile only
    ▼
Selected DSH Profile manifests
```

## 后续扩展原则

更新查询应作为独立只读适配器加入，并返回 `fresh`、`stale`、`offline`、
`unsupported` 等证据状态。任何写入引擎必须是另一模块、另一 API 命名空间和另一轮
安全评审，不能把现有只读函数悄悄改成可写。

