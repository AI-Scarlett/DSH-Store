# 2026-10-17 投稿源码漂移后的最终结论

基线 38a97c83b88652f229e4b6542ccdb2d3a28074b2。工作流 39025606087 在完整集合的源预检阶段发现 nubeslove 上游变更，未进入任何 CAS 预留或 POST；Joey 与 nubeslove 的中央名额均未使用。不得重跑旧计划。已拆成两个独立 main-reviewed 首次结果计划，继续共享中央不可变人物账本。

## dsh-file-actions 0.1.1

固定 Commit：fb4a1ba9a3451d40045baf8d02748e245d7ee247；7/7 个打包文本，40859 字节，Git blob/SHA-256 与完整有界覆盖已核验。**blocked / rejected**。最新 0.1.1 固定源完整覆盖 7 个文本。已确认 open-url 的 http/https/双引号校验及 new Function 移除；请求信任、cmd/目标约束与精确 DSH 兼容仍拒绝准入。生成截图的 Playwright/DSH_HOME 查找属于显式开发脚本，不当成运行时凭据读取或新的恶意证据。

- **AUTH001** [lib/index.js:176](https://github.com/nubeslove/dsh-file-actions/blob/fb4a1ba9a3451d40045baf8d02748e245d7ee247/lib/index.js#L176)：POST /exec 在处理本地文件和新增 open-url 之前均未验证请求来源/调用方，也未要求 application/json；64KiB 上限、动作白名单和文件存在检查不能替代授权。
  最小修改：在读正文/探测路径/启动进程前使用可信宿主授权或 Host/Origin/Sec-Fetch-Site 围栏并限制 POST JSON；保留已有 64KiB 上限。
  验收：跨站/错误 Host/错误媒体类型/错误方法在任何文件探测和进程前拒绝；正常授权请求可使用白名单功能。

- **EXEC001** [lib/index.js:88](https://github.com/nubeslove/dsh-file-actions/blob/fb4a1ba9a3451d40045baf8d02748e245d7ee247/lib/index.js#L88)：open/browser 与新增 open-url（lib/index.js:130-132）仍调用 cmd.exe /c start，并手工引号 + windowsVerbatimArguments=true。只拒绝双引号及限定 http/https 不取消 cmd 的百分号变量展开；文件 open 也没有宿主侧可执行/脚本确认边界。
  最小修改：避免将不可信路径/URL 交给 cmd 解释，采用有安全参数契约的系统打开 API 或固定浏览器进程；宿主限制路径、URL、UNC/设备、扩展名和可执行文件，建立明确确认边界。
  验收：用一次性 Windows 夹具覆盖空格、百分号变量、引号/元字符、UNC、脚本/可执行文件；保证只打开经授权的原始目标且没有附加进程。

- **COMPAT001** [package.json:22](https://github.com/nubeslove/dsh-file-actions/blob/fb4a1ba9a3451d40045baf8d02748e245d7ee247/package.json#L22)：manifest 没有 DSH 兼容声明；投稿补充的 0.2.x 桌面端是范围描述，没有当前官方最新三版的逐版结果。
  最小修改：只在实际验证后补 DSH/Windows 支持范围和至少一个当前版本的精确 compatible 记录；未验证系统/版本保持 unknown。
  验收：当前窗口至少一版有明确范围的安装/加载/卸载证据；不能从旧版本或平台推定。

## Wyatt 的 Store 元数据误报修复

Store 已按官方 cordis-plugin-include 1.0.10 的增量行语义支持有界 literal repository / network-storage permissions 元数据，固定源预检通过；不再要求作者删除这些字段。它们不提供运行时权限强制。当前仍因 NET001 和 COMPAT001 拒绝准入。 固定 Commit 84b838b9808c18e0652c93dbccaf0a413e1d59ae；绑定 8bf9fcf4650dd1c78ced30d41af4527f555e698ea5b107ab5c0e4a5b0e2b1f45。官方 @deepseek-ai/cordis-plugin-include 1.0.10 的 applyEntryPatches 直接追加 insert 行，不过滤这类元数据。Store 仅支持新增命名行中的 literal owner/repo 和 network/storage 布尔字段，其他未知键、覆写、动态值、disabled 等仍拒绝；实际能力继续从完整源码扫描，声明 false 不能隐藏真实权限。没有执行官方模块。当前最终结论仅保留 NET001、COMPAT001，具体整改沿用首轮同一源码的文件与行号。

## 其余状态

Joey 两个项目仍为前次已完整审阅的固定源码；一个人一条合并结果，其完整结论保持在 [首轮报告](./external-activities-20261017.md)。新计划只刷新终局注册表的整体摘要引用，不增加联系名额。Qwen 已有单次成功回执，不重发；Wyatt 无新沟通授权，不另发。所有 Issue 保持打开。未运行任何第三方源码/测试/截图工具，未修改真实 Profile。源码回滚仅用 CI PR；联系预留及历史永不重置。
