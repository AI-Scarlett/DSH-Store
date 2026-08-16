# DSH Safe Plugin Manager

一个面向 DeepSeek Harness（DSH）的专用插件管理插件。项目采用标准 DSH
Bundle + Host Plugin + Client Bundle 结构，不开发桌面端，不修改 DSH 源码，
也不替换任何 `@deepseek-ai/*` 官方包。

## 当前状态

当前仓库已升级为 `0.3.1` GitHub-only 第三方插件商城，已发布到
[`AI-Scarlett/dsh-safe-plugin-manager`](https://github.com/AI-Scarlett/dsh-safe-plugin-manager)，
并以本地链接安装在真实 DSH `web` Profile：

- 已实现：读取指定 Profile 的 `package.json`，归并 Bundle 与依赖，识别来源、
  本地版本和官方/第三方属性；
- 已实现：集中 GitHub 目录、搜索、分类筛选、推荐排序、上下架、固定 Commit 来源复核
  和离线内置快照；
- 已实现：安装、更新、本地链接迁移、卸载、启用、停用的计划/确认/执行 API；
- 已实现：Profile 文件锁、前置哈希、精确备份、官方 DSH 命令、配置健康检查、
  失败回滚与脱敏审计；
- 已实现：“插件市场 / 已安装 / 健康检查”三视图、外部安装来源标记与逐操作确认界面；
- 已验证：DSH 配置可合成，Host API 返回 HTTP 200，浏览器中的
  “设置 → 插件 → 插件商城”可见；
- 已验证：安装后的页面刷新和扫描只读；安装前已有备份可用于人工恢复；
- 已验证：单元/契约/事务测试和目录内全部 approved GitHub 固定 Commit 来源；
- 尚未验证：真实 Profile 的安装—重启—卸载闭环、运行态 Fiber 映射、异常依赖
  矩阵和无 Web Server Profile。

这一区分是刻意的：测试通过只证明本地模块契约，不等于真实 DSH 集成已经通过。

## 不破坏 DSH 的边界

页面加载、搜索、刷新、健康检查和生成计划全部只读。只有用户为单次计划精确输入
确认语后，才允许当前事务修改目标 Profile。安装插件本身会让 Profile 增加依赖与
Bundle 记录，这是任何标准 DSH 插件都无法避免的；管理器永久不得修改：

- DSH 源码和全局安装目录；
- 任何 `@deepseek-ai/*` 官方包；
- 其他 Profile 或管理器托管区块以外的用户 Patch 内容；
- DSH 会话、设置和凭据；
- 官方只读插件列表及其 Loader/Fiber 生命周期。

项目自己的 `cordis.patch.yml` 只插入自身条目，不遮蔽或禁用官方插件清单。

以 `link:`、`file:` 或 `workspace:` 安装的本地开发插件不会被普通“更新”静默覆盖。
页面会改为提供“迁移到商城版”：经单次计划确认后，仅将目标 Profile 的依赖
来源切换为目录固定的 GitHub Commit，原本地项目不删除、不修改；迁移后才进入商城
的常规更新链路。

## 架构

```text
GitHub catalog.json ──> DSH 市场搜索 / 固定 Commit 来源复核
                              │
DSH Web Settings ──> 只读查看与操作计划 ──> 精确确认语
                                              │
                                              ▼
                        Profile 锁 → 备份 → 官方 dsh plugin
                                              │
                                  健康检查 → 成功 / 自动回滚
```

Host 端使用 `ctx.inject(['webServer'], ...)` 延迟挂载路由，确保无 Web Server 的
Profile 不因本插件而启动失败。Client 端通过 DSH 官方 `ModuleLoader` 与 Settings
Slot 注册独立标签页，不导入 Host 模块。

## 本地检查

```bash
npm run check
```

事务测试只使用临时目录，不会修改真实 `~/.dsh`。

## GitHub 插件目录

- 机器目录：`registry/catalog.json`；
- GitHub Pages 页面：`marketplace/index.html`；
- 目录准入说明：`registry/README.md`；
- 本地校验：`npm run validate:registry`；
- 固定 Commit 在线复核：`npm run verify:registry-sources`。

在线目录默认从本仓库的 GitHub Raw 地址读取，人工浏览页面位于
[DSH Safe GitHub Plugin Registry](https://ai-scarlett.github.io/dsh-safe-plugin-manager/marketplace/)；
任何网络失败都只会回退到随包发布的已知目录快照，不会自动改用未知安装地址。

`approved` 表示上架，`blocked` 表示展示但禁止安装，`unlisted` 表示下架且不在商城
显示。`featured: true` 的插件会在所属分类优先展示。成功安装可向配置的 HTTPS 计数
服务发送不含设备、Profile 或用户标识的最小回执；该能力默认关闭，GitHub Pages
本身不能接收写请求，也不会把 GitHub 写令牌下发给客户端。

## 文档

- [产品需求](docs/PRODUCT_REQUIREMENTS.md)
- [技术架构](docs/ARCHITECTURE.md)
- [开发路线](docs/DEVELOPMENT_PLAN.md)
- [验收方案](docs/ACCEPTANCE.md)
- [验证记录](docs/VERIFICATION.md)
- [研究与来源](docs/RESEARCH.md)
- [安全约束](SECURITY.md)

## 下一步

先在一次性 Profile 中真实执行 GitHub 安装、更新、启停、卸载和故障回滚，再允许
生产 Profile 执行写操作。运行态 Fiber 状态继续以 DSH 官方清单为权威，不由本插件
直接控制。
