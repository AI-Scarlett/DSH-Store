# 验证记录

日期：2026-08-16。

## 已通过

- `npm run check`：语法检查通过，9 项单元/契约测试全部通过；
- `npm pack --dry-run --json`：打包预览成功，运行包只包含 README、安全说明、
  第三方说明、manifest、Bundle Patch 与 4 个 `src` 文件；
- 真实 Profile 只读检查：扫描器读取本机现有 `web` Profile，识别 5 个条目、
  无诊断错误；
- 零写入核对：扫描前后比较 `package.json`、`cordis.patch.yml`、
  `pnpm-lock.yaml` 的 SHA-256，结果为 `LIVE_PROFILE_HASHES_UNCHANGED`；
- 敏感信息扫描：项目内没有本机绝对路径、私有聊天链接或凭据值。

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

官方安装命令曾把 Profile 中两个既有本地依赖也识别为 Bundle，但它们的链接包未
提供所声明的 Bundle Patch，导致首次重启失败。最终仅从 `bundles` 数组移除这两个
误识别条目，保留原依赖及原有 Patch 加载方式；当前 Bundle 集合为安装前 3 项加
本管理器 1 项。该兼容性处理没有改动两个本地插件的代码。

## 尚未验证

- 尚未验证卸载并恢复到安装前状态；
- 尚未在一次性 Profile 中覆盖 headless、损坏 manifest、缺失依赖和坏链接；
- 运行态 Loader/Fiber 状态仍明确显示为“尚未核验”；
- 写入、更新与回滚功能尚未实现。

因此当前结论是“真实 `web` Profile 中的只读安装、启动、API 与页面已通过”，
不是“插件写入管理功能已经可交付”。
