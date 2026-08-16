# DSH Safe Plugin Manager

一个面向 DeepSeek Harness（DSH）的专用插件管理插件。项目采用标准 DSH
Bundle + Host Plugin + Client Bundle 结构，不开发桌面端，不修改 DSH 源码，
也不替换任何 `@deepseek-ai/*` 官方包。

## 当前状态

当前仓库是“规划完成 + 可测试只读骨架”，尚未安装到真实 DSH Profile，也没有发布：

- 已实现：读取指定 Profile 的 `package.json`，归并 Bundle 与依赖，识别来源、
  本地版本和官方/第三方属性；
- 已实现：只读 Host API 与“设置 → 插件”中的独立标签页骨架；
- 已实现：路径校验、同源请求校验、请求大小限制和无写入契约测试；
- 已验证：扫描器可读取本机现有 `web` Profile；读取前后 manifest、patch 与 lockfile
  的 SHA-256 保持一致；
- 未实现：运行态 Fiber 状态、npm/Git 更新查询、兼容性分析；
- 未实现：安装、删除、启停、更新、备份和回滚；
- 未验证：真实 DSH 安装、启动和浏览器 UI。

这一区分是刻意的：测试通过只证明本地模块契约，不等于真实 DSH 集成已经通过。

## 不破坏 DSH 的边界

首版运行时只读。安装插件本身会让目标 Profile 增加依赖与 Bundle 记录，这是任何
标准 DSH 插件都无法避免的；安装完成后的扫描和页面刷新不得修改：

- DSH 源码和全局安装目录；
- 任何 `@deepseek-ai/*` 官方包；
- Profile 的 `package.json`、`cordis.patch.yml`、lockfile 或 `node_modules`；
- DSH 会话、设置和凭据；
- 官方只读插件列表及其 Loader/Fiber 生命周期。

项目自己的 `cordis.patch.yml` 只插入自身条目，不遮蔽或禁用官方插件清单。

## 架构

```text
DSH Web Settings
  └─ dsh-safe-plugin-manager Client
       └─ POST /api2/dsh-safe-plugin-manager/inventory
            └─ Host plugin
                 └─ read-only Profile manifest scanner
```

Host 端使用 `ctx.inject(['webServer'], ...)` 延迟挂载路由，确保无 Web Server 的
Profile 不因本插件而启动失败。Client 端通过 DSH 官方 `ModuleLoader` 与 Settings
Slot 注册独立标签页，不导入 Host 模块。

## 本地检查

```bash
npm run check
```

测试只使用临时目录，不会访问或修改 `~/.dsh`。

## 文档

- [产品需求](docs/PRODUCT_REQUIREMENTS.md)
- [技术架构](docs/ARCHITECTURE.md)
- [开发路线](docs/DEVELOPMENT_PLAN.md)
- [验收方案](docs/ACCEPTANCE.md)
- [验证记录](docs/VERIFICATION.md)
- [研究与来源](docs/RESEARCH.md)
- [安全约束](SECURITY.md)

## 下一步

先在一次性 DSH 测试 Profile 中完成 M1 集成验证：安装本地 checkout、确认 DSH
能启动、确认页面可见、对运行前后关键文件做哈希比对。通过之前不接入真实 `web`
Profile，也不开始任何写入功能。
