# 2026-10-17 外部动态固定源准入结论

基线：`3fb5b3c2f70b88ad498e79d84cfa77980a797dcd`。以下仅是完整有界静态源码审阅；没有安装、导入、构建、测试或执行第三方代码，没有修改真实 Profile。当前官方最新三版：0.2.1-alpha.5 / 0.2.1-rc.1 / 0.2.1-rc.2。

## #1390 · dsh-qwen-paint

固定 Commit：`a13ff75f40faf9accebbea6213172afd57e76dd6`；版本 0.17.9；9/9 个打包运行文本，841,810 字节，Git blob/SHA-256 全部核验。

**准入 approved / user-reviewed**：AUTH001 三项修复已确认；精确兼容声明覆盖当前官方最新三版，按完整固定源能力审阅准入 approved / user-reviewed。Store 未运行插件，出图、安装卸载回滚、真实 Profile 验收仍未验证。

确认位置：`lib/index.js:1566,3637,4003,4132,4254`（请求信任、405/415、256KiB 正文及 GET 不改 cfg）；`lib/index.js:1019,1061`（后台回退）；`lib/client.js:3205` 与 `lib/index.js:2002`（仅自有 draw_image 卡片）；`lib/net-guard.js:170,191`（无重定向、子进程环境过滤）。凭据信号为目录/可执行路径环境读取和秘密名过滤，按精确文件哈希记录误报处置。仍保留文件写入、pip/Git 下载、shell、远端 opt-in 风险；这不是沙箱或下载完整性认证。作者三版各 7 项是作者侧加载/注册材料，Store 的 install/start/uninstall/rollback 与出图均保持 unknown。历史公开盘符路径不要求改写作者历史；Store 无该仓库写权限，本任务也不实施改写。

## #1465 · dsh-plugin-vision

固定 Commit：`84b838b9808c18e0652c93dbccaf0a413e1d59ae`；版本 1.0.0；3/3 个打包运行文本，13,303 字节，Git blob/SHA-256 全部核验。

**拒绝准入 blocked**：重新投稿与 #1460 合并审查：manifest repository 已修正，不再保留旧身份不匹配结论；当前 Patch、精确兼容和端点/凭据边界仍不满足准入。只更新公开受审状态，不重复联系已收过消息的作者。

- **PATCH001** [cordis.patch.yml:9](https://github.com/Wyatt5341/dsh-plugin-vision/blob/84b838b9808c18e0652c93dbccaf0a413e1d59ae/cordis.patch.yml#L9)：insert 的条目带 repository / permissions 字段，当前受支持 Bundle row 契约不能解释这两个键；它们不能充当运行时权限强制。
  最小修改：保持唯一 id/name 的增量 row；来源保留在 package.json.repository，权限在 manifest/README 披露。若必须使用新增官方字段，提供该 DSH 版本的官方解析契约供 Store 扩展有界审阅。
  验收：固定 Commit Bundle 解析通过，条目确为本包且未覆盖官方组件。

- **COMPAT001** [package.json:32](https://github.com/Wyatt5341/dsh-plugin-vision/blob/84b838b9808c18e0652c93dbccaf0a413e1d59ae/package.json#L32)：当前无 0.2.1-alpha.5 / 0.2.1-rc.1 / 0.2.1-rc.2 的准确 compatible 记录；peer range 不证明实际兼容。
  最小修改：验证实际支持版本的加载/注册和安装启停卸载边界，至少声明一版准确结果并附证据；未测版本保持 unknown。
  验收：至少一个当前官方窗口版本有可追溯 compatible 声明，证据范围明确。

- **NET001** [lib/index.js:196](https://github.com/Wyatt5341/dsh-plugin-vision/blob/84b838b9808c18e0652c93dbccaf0a413e1d59ae/lib/index.js#L196)：apiBaseUrl 可配置并携带 API key 和图片，未强制 HTTPS，也未显式限制重定向；失败响应仅截断原文，敏感远端回显边界不明确。
  最小修改：在发请求前验证受信端点；远端强制 HTTPS，开发回环另设明确例外；拒绝重定向，限制响应字节并脱敏错误回显。保留视觉/外部模型能力。
  验收：HTTP 远端、跨源/降级重定向、超大/回显凭据响应均在敏感数据外发或展示前拒绝。

## #1466 · dsh-skill-install

固定 Commit：`935dbb1ef7f10be54c0a972ac45a947f07832a78`；版本 0.1.0；7/7 个打包运行文本，160,317 字节，Git blob/SHA-256 全部核验。

**拒绝准入 blocked**：完整 7 文本覆盖；零 npm dependencies 不消除内置 js-yaml、curl/tar、文件写入和 GitHub token 能力。因请求/路径/身份兼容契约拒绝准入。

- **AUTH001** [index.js:608](https://github.com/Joey-K-tsubame/dsh-skill-install/blob/935dbb1ef7f10be54c0a972ac45a947f07832a78/index.js#L608)：通用 route 不限制方法/媒体类型或验证 Host/Origin/调用方；安装、移除、代理和 token 更新均由 query 触发，GET 就能写文件或改凭据。
  最小修改：读取路由保持只读；写操作使用 POST application/json、有界正文和可信调用方检查，拒绝跨站/错误 Host/无效媒体类型后才读写；token 从正文传递，不放 URL，并以受限文件权限或凭据存储保存。
  验收：GET 不产生安装/删除/设置修改；跨站、未知 Host、错误方法/类型、超大 body 不触碰文件或 token。

- **PATH001** [index.js:466](https://github.com/Joey-K-tsubame/dsh-skill-install/blob/935dbb1ef7f10be54c0a972ac45a947f07832a78/index.js#L466)：dirs 来自 query 后直接 join 到 work；对源目录未校验相对路径/realpath。tar 解压及 cp(dereference:false) 也没有对链接、包内越界条目和总体大小作完整准入检查。
  最小修改：固定下载源 Commit；在复制/解压前验证所有成员及 dirs 的规范路径、realpath 包含关系，拒绝 ..、绝对路径和越界软/硬链接，限制压缩/解压后大小；分阶段提交并支持失败回滚。
  验收：遍历、外链、超限包、并发/中途失败均不能读取或写入授权根外内容，安装源可复现到完整 SHA。

- **META001** [package.json:34](https://github.com/Joey-K-tsubame/dsh-skill-install/blob/935dbb1ef7f10be54c0a972ac45a947f07832a78/package.json#L34)：manifest 缺 repository 和 engines.node；仅 engines.dsh 范围，没有当前窗口的逐版声明。
  最小修改：补 canonical repository 与真实 Node 支持范围；验证后在 dsh.compatibility.dshReleases 写至少一个当前窗口精确 compatible，其他 unknown。
  验收：manifest 与 canonical GitHub 一致，当前窗口至少一版有可追溯准确声明。

## #1467 · dsh-delete-archived

固定 Commit：`7badd13a23a96d0c45f9b01ad8a2ded3e73ea611`；版本 0.1.0；6/6 个打包运行文本，17,095 字节，Git blob/SHA-256 全部核验。

**拒绝准入 blocked**：最新固定源已改为静态 Patch，旧预检标量错误已不适用；完整 6 文本覆盖。请求信任、删除事务/内存边界和 manifest/兼容契约仍拒绝。

- **AUTH001** [lib/entry.js:196](https://github.com/Joey-K-tsubame/dsh-delete-archived/blob/7badd13a23a96d0c45f9b01ad8a2ded3e73ea611/lib/entry.js#L196)：delete 路由只检查 POST，缺可信调用方和 JSON Content-Type，readJsonBody 无大小上限；list 也不验证调用方。
  最小修改：在读取会话或删除前校验宿主授权/可信请求，POST JSON 和有界正文；list 同样校验调用方。
  验收：跨站/错误 Host/媒体类型/超大 body 在读取会话和删除前拒绝；错误方法 405。

- **DELETE001** [lib/entry.js:137](https://github.com/Joey-K-tsubame/dsh-delete-archived/blob/7badd13a23a96d0c45f9b01ad8a2ded3e73ea611/lib/entry.js#L137)：当前源码只验证 archived；检查与 rm/registry 更新未序列化。已无“不在内存”检查，与工具说明及投稿描述不一致；磁盘删后登记修改失败时无法回滚。
  最小修改：用宿主公开维护/锁契约串行核验存档和存活状态；拒绝仍可写会话，或提供该版本已停止写入的官方可验证契约；将日志及登记变更做成可恢复事务，并令 UI/工具共享预览/明确确认边界，统一说明。
  验收：并发恢复/追加/删除、内存会话、登记写失败都不会复活或半删；确认取消不删除，失败可恢复。

- **META001** [package.json:32](https://github.com/Joey-K-tsubame/dsh-delete-archived/blob/7badd13a23a96d0c45f9b01ad8a2ded3e73ea611/package.json#L32)：manifest 缺 repository 与 engines.node，且无当前官方窗口的逐版兼容结果。
  最小修改：补 canonical repository、Node 范围，实际验证后增加精确 dshReleases 与范围明确的安装/启动/卸载证据。
  验收：至少一个当前窗口版本有准确 compatible 声明；未验证字段保持 unknown。

## #1468 · dsh-file-actions

固定 Commit：`1dae73c840d94f98f8bd1d6738d4a701be5f61ac`；版本 0.1.0；5/5 个打包运行文本，26,584 字节，Git blob/SHA-256 全部核验。

**拒绝准入 blocked**：完整 5 文本覆盖；保留已披露的本地命令能力，不把 child-process 信号当成恶意。scripts/verify.mjs 的 new Function 只用于客户端语法检查，不作为运行时动态执行的拒绝理由；真正阻断项是请求信任、cmd/目标约束与兼容。

- **AUTH001** [lib/index.js:140](https://github.com/nubeslove/dsh-file-actions/blob/1dae73c840d94f98f8bd1d6738d4a701be5f61ac/lib/index.js#L140)：POST /exec 未验证请求来源/调用方，也未要求 application/json；因此动作白名单与 exists/stat 不建立调用者授权。
  最小修改：在读正文/探测路径/启动进程前使用可信宿主授权或 Host/Origin/Sec-Fetch-Site 围栏并限制 POST JSON；保留已有 64KiB 上限。
  验收：跨站/错误 Host/错误媒体类型/错误方法在任何文件探测和进程前拒绝；正常授权请求可使用白名单功能。

- **EXEC001** [lib/index.js:84](https://github.com/nubeslove/dsh-file-actions/blob/1dae73c840d94f98f8bd1d6738d4a701be5f61ac/lib/index.js#L84)：open/browser 明确调用 cmd.exe /c start，且 windowsVerbatimArguments=true 手工加引号；参数数组不取消 cmd 的百分号环境展开等解释。open 同时接受存在的可执行/脚本文件，browser 也未在宿主限制文件类型。
  最小修改：优先使用有安全参数契约的系统打开 API 或固定浏览器进程，避免把路径交给命令解释器；对路径、UNC/设备/URL、扩展名和可执行文件建立宿主允许/拒绝及明确确认边界，准确披露本地执行能力。
  验收：用一次性 Windows 夹具覆盖空格、百分号变量、引号/元字符、UNC、脚本/可执行文件；保证只打开经授权的原始目标且没有附加进程。

- **COMPAT001** [package.json:40](https://github.com/nubeslove/dsh-file-actions/blob/1dae73c840d94f98f8bd1d6738d4a701be5f61ac/package.json#L40)：manifest 没有 DSH 兼容声明，README 只声称 0.1.1-rc.2 + Windows；当前官方窗口是 0.2.1-alpha.5 / rc.1 / rc.2。
  最小修改：只在实际验证后补 DSH/Windows 支持范围和至少一个当前版本的精确 compatible 记录；未验证系统/版本保持 unknown。
  验收：当前窗口至少一版有明确范围的安装/加载/卸载证据；不能从旧版本或平台推定。

## 商城修复与联系边界

四次投稿均已执行预检，但发送计划把 Store 自身当成目标而命中历史仓库隔离，实际没有回复；已修为 canonical 插件仓库绑定，并额外核验提交者/仓库所有者、完整当前讨论、中央历史和停止联系状态。没有删除历史隔离项。

新增 main-reviewed 投稿最终结果计划：同一人跨项目仅一条；Joey 的两项结论合并在 #1466，#1467 不再单独发。nubeslove 单独回复 #1468。每条发送均先中央 CAS，发送或回读不确定永久占用、不重试。Wyatt 已在 #1460 联系过，#1465 仅是重新投稿，不构成继续沟通授权，因此关联记录但不另发消息、不关闭两条 Issue。

Qwen 的 0.17.8 明确复核请求（6230366529）尚未回答；同一作者随后补齐本轮缺失证据并给出 0.17.9（6232543131），将二条合并为一次最新固定源结果，绑定最新原文哈希/时间，不继承旧请求的名额。全部 Issue 保持打开；关闭会额外通知，且不能把静态准入当真实运行验收。

验证及回滚：本仓库 npm run check、精确文件哈希计划、CI PR；源码回滚用 revert PR。联系账本只追加，不能回滚发送、删除预留或重试不确定消息。GitHub/Pages/生产公开回读与实际发送回执由交付记录单独保存。
