# DSH Safe Plugin Manager

一个面向 DeepSeek Harness（DSH）的专用插件管理插件。项目采用标准 DSH
Bundle + Host Plugin + Client Bundle 结构，不开发桌面端，不修改 DSH 源码，
也不替换任何 `@deepseek-ai/*` 官方包。

## 当前状态

当前仓库是“已安装验证的只读预览版”，已经以本地链接安装到真实 DSH `web`
Profile，但尚未发布：

- 已实现：读取指定 Profile 的 `package.json`，归并 Bundle 与依赖，识别来源、
  本地版本和官方/第三方属性；
- 已实现：只读 Host API 与“设置 → 插件”中的独立标签页骨架；
- 已实现：路径校验、同源请求校验、请求大小限制和无写入契约测试；
- 已验证：DSH 配置可合成，Host API 返回 HTTP 200，浏览器中的
  “设置 → 插件 → 安全管理”可见并列出 6 个条目；
- 已验证：安装后的页面刷新和扫描只读；安装前已有备份可用于人工恢复；
- 未实现：运行态 Fiber 状态、npm/Git 更新查询、兼容性分析；
- 未实现：安装、删除、启停、更新、备份和回滚；
- 未验证：卸载闭环、异常依赖矩阵和无 Web Server Profile。

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

补齐一次性 Profile 的卸载、异常依赖与 headless 验收，再接入真实运行态
Loader/Fiber 状态。任何安装、删除、启停或更新能力仍需单独完成备份、预检、
确认、执行、验证和回滚设计后才能开放。
