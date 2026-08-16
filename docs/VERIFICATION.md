# 验证记录

日期：2026-08-16。

## 已通过

- `npm run check`：语法检查、目录校验和 25 项单元/契约/事务测试全部通过；
- `npm pack --dry-run --json`：打包预览成功，运行包只包含 README、安全说明、
  第三方说明、manifest、Bundle Patch 与 4 个 `src` 文件；
- 真实 Profile 只读检查：扫描器读取本机现有 `web` Profile，识别 5 个条目、
  无诊断错误；
- 零写入核对：扫描前后比较 `package.json`、`cordis.patch.yml`、
  `pnpm-lock.yaml` 的 SHA-256，结果为 `LIVE_PROFILE_HASHES_UNCHANGED`；
- 敏感信息扫描：项目内没有本机绝对路径、私有聊天链接或凭据值。
- `npm run verify:registry-sources`：两个 approved 条目的 GitHub 固定 Commit
  manifest、版本、Bundle 入口与生命周期脚本复核通过；
- 安装失败故障注入：临时 Profile 的控制文件恢复到精确前置内容，依赖恢复命令走
  官方 DSH 边界；
- 托管 Patch 测试：空数组和既有用户序列均可停用/启用，区块外字节保持不变。

## 真实 `web` Profile 集成

- 安装前备份：已保存 `package.json`、Bundle Patch 与工作区/锁文件（如存在），
  并生成 SHA-256 清单；
- 官方安装入口：通过 `dsh plugin --profile web add <local-checkout>` 安装，本项目
  以本地链接依赖和 Bundle 记录存在；
- 配置合成：`dsh --profile web --dump-config` 通过；
- 进程与端口：DSH Web 重启后持续运行，`127.0.0.1:3080` 可访问；
- Host API：同源请求 `POST /api2/dsh-safe-plugin-manager/inventory` 返回 HTTP 200，
  `mode=read-only`、`profile=web`、`plugins` 长度为 6、无诊断错误；
- Client UI：浏览器实测“设置 → 插件 → 安全管理”可见，显示只读提示、Profile
  与 6 个插件条目；
- DSH 源码：安装过程中没有修改 DSH 源码或替换任何 `@deepseek-ai/*` 包。

### `0.2.0` 升级后只读验收

- DSH 重启后管理器清单版本为 `0.2.0`，Web 首页与 5 个 Host API 均可用；
- 市场页显示 3 个种子条目：1 个已安装本地链接、1 个可安装、1 个因遮蔽官方清单
  被策略阻止；
- GitHub Raw 默认目录尚未发布，页面明确显示 `内置目录回退` 与
  `CATALOG_UNAVAILABLE`，没有伪装成在线目录；
- 搜索 `chat` 后浏览器只显示 1 个匹配条目；
- 健康检查显示 `healthy`，inventory、dependencies、managed-patch、
  config-composition 四项均为 `pass`；
- 浏览器生成 `dshmarket` 安装计划，固定 Commit、`prepare` 脚本、影响范围、永久
  保护范围和确认语均可见；确认语为空时执行按钮保持禁用；
- API 与浏览器只读验收前后，`package.json`、`cordis.patch.yml`、lockfile、
  workspace 文件 SHA-256 均保持不变；没有执行安装计划。

官方安装命令曾把 Profile 中两个既有本地依赖也识别为 Bundle，但它们的链接包未
提供所声明的 Bundle Patch，导致首次重启失败。最终仅从 `bundles` 数组移除这两个
误识别条目，保留原依赖及原有 Patch 加载方式；当前 Bundle 集合为安装前 3 项加
本管理器 1 项。该兼容性处理没有改动两个本地插件的代码。

## 尚未验证

- 尚未验证卸载并恢复到安装前状态；
- 尚未在一次性 Profile 中覆盖 headless、损坏 manifest、缺失依赖和坏链接；
- 运行态 Loader/Fiber 状态仍明确显示为“尚未核验”；
- 尚未在真实 Profile 执行 `0.2.0` 的写操作；当前写入证据仅来自临时目录事务测试；
- GitHub Pages 与 Raw 默认目录尚未发布，因此真实 UI 应显示内置目录回退。

因此当前结论是“安全写入代码和临时目录故障注入通过”；只有重新完成真实 UI
只读验收，不能把它表述成“真实第三方插件生命周期闭环已通过”。
