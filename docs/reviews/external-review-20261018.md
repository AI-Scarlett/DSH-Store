# 外部动态最终准入复核 — 2026-10-18

基线：`e93353289423a01e44706548f11c639be4f4ec4e`。九个固定源码的有界打包文本均完整读取，逐文件核验 Git blob/SHA-256；没有执行第三方代码/测试或改真实 Profile。本文是发布前最终判定，不冒充评论发送或公网部署回执。

## #1466

### dsh-skill-install 0.1.3

固定 Commit：`70aa4ffd8706d7e6de2ca95558d954a213bc60f8`；7/7 个有界文本、169,491 字节，已完整读取并核验 Git blob/SHA-256。最终结论：**blocked / rejected**。

AUTH001 的方法/JSON/有界正文与请求来源围栏已补齐；canonical repository、Node 和固定安装 SHA 已确认。仍因解压先于安全准入和当前窗口兼容声明缺失拒绝准入。

- **PATH001** [index.js:489](https://github.com/Joey-K-tsubame/dsh-skill-install/blob/70aa4ffd8706d7e6de2ca95558d954a213bc60f8/index.js#L489)：downloadExtract 在第 524 行运行 tar -xzf，直到第 529 行才 sanitizeTree；展开体积/条目数和链接检查发生在磁盘写入之后。第 516 行 arrayBuffer 与代理 curl 也在完整接收后才检查 64 MiB，未在传输时限制实际字节。
  最小修改：用有界流限制所有直连/代理传输；在写出归档成员前验证规范路径、类型、链接目标及展开预算，拒绝越界或超限成员；失败清理 staging，保留原目标。
  验收：压缩/展开超限、绝对路径、..、软/硬链接、设备条目均在写到授权根外或耗尽预算前拒绝；并发/失败不删除其他安装。

- **COMPAT001** [package.json:41](https://github.com/Joey-K-tsubame/dsh-skill-install/blob/70aa4ffd8706d7e6de2ca95558d954a213bc60f8/package.json#L41)：固定 manifest 没有当前官方窗口（0.2.1-alpha.5 / rc.1 / rc.2）至少一版的精确 compatible 记录；历史版本、宽范围和自定义 workshop 字段不替代逐版声明。
  最小修改：实际验证后，在 dsh.compatibility.dshReleases 声明至少一版当前窗口的准确结果，并给出该版本安装/启动/卸载证据；未验证项保留 unknown。
  验收：至少一版当前窗口声明与证据一致；其他宿主、系统和 rollback 不从旧记录推定。

## #1467

### dsh-delete-archived 0.1.1

固定 Commit：`80261000c204002ecea1ac609eaf16a0667df14b`；6/6 个有界文本、24,187 字节，已完整读取并核验 Git blob/SHA-256。最终结论：**blocked / rejected**。

AUTH001 的 POST/JSON/大小/Host/Origin 围栏与插件内按会话串行已确认；DELETE001 的跨宿主竞态和失败重试仍未闭合，当前窗口兼容声明也缺失。

- **DELETE001** [lib/entry.js:247](https://github.com/Joey-K-tsubame/dsh-delete-archived/blob/80261000c204002ecea1ac609eaf16a0667df14b/lib/entry.js#L247)：withSessionLock 只串行本插件调用，不能排除宿主恢复/追加。第 289 行 unarchive 成功后，第 294 或 302 行若清理失败，下一次调用会在第 253 行以 not-archived 退出；因此重复执行不能保证完成 registry cleanup。永久 rm 在第 270 行先发生，没有可恢复事务。
  最小修改：通过可核验的宿主维护/互斥契约覆盖删除前重新检查、磁盘与登记变更；保存可恢复日志/事务状态，直到所有清理成功才消费归档标记；使重试可完成未完成步骤。
  验收：一次性夹具覆盖删除与恢复/追加并发、unarchive 成功后 unpin/detach 失败和中断重启；不复活、不半删且重试能收敛；公开宿主版本对应的停止写入契约。

- **COMPAT001** [package.json:44](https://github.com/Joey-K-tsubame/dsh-delete-archived/blob/80261000c204002ecea1ac609eaf16a0667df14b/package.json#L44)：固定 manifest 没有当前官方窗口（0.2.1-alpha.5 / rc.1 / rc.2）至少一版的精确 compatible 记录；历史版本、宽范围和自定义 workshop 字段不替代逐版声明。
  最小修改：实际验证后，在 dsh.compatibility.dshReleases 声明至少一版当前窗口的准确结果，并给出该版本安装/启动/卸载证据；未验证项保留 unknown。
  验收：至少一版当前窗口声明与证据一致；其他宿主、系统和 rollback 不从旧记录推定。

## #1464

### dsh-tun-proxy 0.3.1

固定 Commit：`d639074c31502d2d115dcb67c77eeb5dba317ae5`；61/61 个有界文本、438,317 字节，已完整读取并核验 Git blob/SHA-256。最终结论：**blocked / rejected**。

0.3.1 的 ZIP/EXE/DLL 摘要与长度校验、缺摘要拒绝、替换备份已确认；a878df87 只修改文档/证据，按作者侧 rc.2 证据保存。仍有控制路由缺失 Host 时放行和精确兼容声明缺失。

- **AUTH001** [lib/routes.js:23](https://github.com/scclovez/dsh-tun-proxy/blob/d639074c31502d2d115dcb67c77eeb5dba317ae5/lib/routes.js#L23)：sameOrigin 仅在 Host 存在时检查 loopback；Host 与 Origin 均缺失且无 cross-site 元数据时第 30 行直接 true。/state 与 /action 共用该判定，后者可进入安装、启动、代理和设置副作用；不能宣称缺请求信任材料时 fail closed。
  最小修改：在任何读状态/解析正文/dispatch 前，缺失或畸形 Host、错误 Origin/Fetch Metadata 一律拒绝；优先复用官方 connection.requestRejection，并在该上下文缺失/抛错时拒绝；保留 POST JSON 与有界正文。
  验收：缺 Host 的 HTTP/1.0、错 Host/Origin、无效或缺失授权上下文均在状态读取、下载、文件、进程及注册表动作前拒绝；授权面板仍正常。

- **COMPAT001** [package.json:36](https://github.com/scclovez/dsh-tun-proxy/blob/d639074c31502d2d115dcb67c77eeb5dba317ae5/package.json#L36)：固定 manifest 没有当前官方窗口（0.2.1-alpha.5 / rc.1 / rc.2）至少一版的精确 compatible 记录；历史版本、宽范围和自定义 workshop 字段不替代逐版声明。
  最小修改：实际验证后，在 dsh.compatibility.dshReleases 声明至少一版当前窗口的准确结果，并给出该版本安装/启动/卸载证据；未验证项保留 unknown。
  验收：至少一版当前窗口声明与证据一致；其他宿主、系统和 rollback 不从旧记录推定。

## #1477

### dsh-ledger-memory 1.2.7

固定 Commit：`cb397a780f0cab4838ce5b3baf17abb08f1c3c78`；11/11 个有界文本、1,431,332 字节，已完整读取并核验 Git blob/SHA-256。最终结论：**approved / user-reviewed**。

准入通过：旧 AUTH001 已修复。路由 settingsGate 与 saveSettings/broadcast 均在副作用前复用官方 connection.requestRejection；完整固定源码、许可、增量 Patch、无安装脚本/直接运行依赖和 rc.2 精确声明已核对。以 user-reviewed 承载文件写入、同源设置接口和受限 Git 能力；运行验收保持 unknown。


## #1478

### dsh-archive-purge 1.0.0

固定 Commit：`0fbe8584f2ab664cbc048162cd6e2d00c152b1d8`；6/6 个有界文本、67,364 字节，已完整读取并核验 Git blob/SHA-256。最终结论：**blocked / rejected**。

monorepo plugin/ 的固定 Bundle 与官方 Connection /api 认证入口已核对，预检通过不等于准入。永久删除的宿主并发边界和错误恢复不完整，标准兼容声明缺失，拒绝准入。

- **DELETE001** [plugin/index.js:221](https://github.com/Angela-lwh/dsh-archive-purge/blob/0fbe8584f2ab664cbc048162cd6e2d00c152b1d8/plugin/index.js#L221)：归档/运行检查与实际 rm 之间有多个 await（stat、目录验证、等待/释放）；没有覆盖宿主恢复/追加及并发删除的维护锁。第 392-406 行吞掉 metadata 清理错误，随后仍返回 deleted:true，且未保存未完成清理事务。
  最小修改：用受支持的宿主维护/事务契约串行化重新核验、删除与登记；为不可逆文件删除保留恢复或持久可重试状态，明确返回部分失败，不能仅日志告警后报全成功。
  验收：一次性会话验证恢复/追加/双删除竞态、metadata 写失败及中断重启；取消不删，错误可恢复/收敛，无成功假阳性。

- **COMPAT001** [plugin/package.json:46](https://github.com/Angela-lwh/dsh-archive-purge/blob/0fbe8584f2ab664cbc048162cd6e2d00c152b1d8/plugin/package.json#L46)：固定 manifest 没有当前官方窗口（0.2.1-alpha.5 / rc.1 / rc.2）至少一版的精确 compatible 记录；历史版本、宽范围和自定义 workshop 字段不替代逐版声明。
  最小修改：实际验证后，在 dsh.compatibility.dshReleases 声明至少一版当前窗口的准确结果，并给出该版本安装/启动/卸载证据；未验证项保留 unknown。
  验收：至少一版当前窗口声明与证据一致；其他宿主、系统和 rollback 不从旧记录推定。

## #1465

### dsh-plugin-vision 1.0.0

固定 Commit：`84b838b9808c18e0652c93dbccaf0a413e1d59ae`；3/3 个有界文本、13,303 字节，已完整读取并核验 Git blob/SHA-256。最终结论：**blocked / rejected**。

已关联 #1460 与 #1465；与上一轮相同固定 Commit，Store 对 literal Patch 元数据的修复已在 main。仍因非安全传输/响应无界和当前窗口兼容缺失拒绝准入；没有新的继续沟通请求，公开记录而不重复联系。

- **NET001** [lib/index.js:199](https://github.com/Wyatt5341/dsh-plugin-vision/blob/84b838b9808c18e0652c93dbccaf0a413e1d59ae/lib/index.js#L199)：可配置 apiBaseUrl 直接组成 endpoint，第 199 行 fetch 携带图像和 Bearer；未限制 HTTPS/凭据 URL/跳转。第 216 行 response.text 和 224 行 response.json 在读取后才处理，没有实际响应字节上限。
  最小修改：配置时校验 HTTPS 或明确授权的 loopback HTTP，拒绝 URL 用户信息及非授权目标/跳转；对成功和失败响应采用实际流式字节上限，错误正文脱敏。
  验收：远端 HTTP、凭据 URL、跨目标跳转在发送图片/API Key 前拒绝；超大/慢流及错误回显有界，不泄漏密钥。

- **COMPAT001** [package.json:21](https://github.com/Wyatt5341/dsh-plugin-vision/blob/84b838b9808c18e0652c93dbccaf0a413e1d59ae/package.json#L21)：固定 manifest 没有当前官方窗口（0.2.1-alpha.5 / rc.1 / rc.2）至少一版的精确 compatible 记录；历史版本、宽范围和自定义 workshop 字段不替代逐版声明。
  最小修改：实际验证后，在 dsh.compatibility.dshReleases 声明至少一版当前窗口的准确结果，并给出该版本安装/启动/卸载证据；未验证项保留 unknown。
  验收：至少一版当前窗口声明与证据一致；其他宿主、系统和 rollback 不从旧记录推定。

## #1468

### dsh-file-actions 0.1.1

固定 Commit：`0e7ff4f0ce2921580c9fda4575fbb6185478b799`；7/7 个有界文本、40,859 字节，已完整读取并核验 Git blob/SHA-256。最终结论：**blocked / rejected**。

与上轮运行文件 blob 相同，最新 Commit 只重绑定来源；AUTH001 / EXEC001 / COMPAT001 仍成立。截图脚本、测试和 DSH_HOME 不当成运行时恶意证据。

- **AUTH001** [lib/index.js:176](https://github.com/nubeslove/dsh-file-actions/blob/0e7ff4f0ce2921580c9fda4575fbb6185478b799/lib/index.js#L176)：POST /exec 未在探测路径/启动进程前校验调用方/Host/Origin，也不要求 JSON Content-Type；动作白名单和 64 KiB 上限不能代替授权。
  最小修改：复用可信宿主请求授权，在缺上下文、错 Host/Origin、错误方法/类型时先拒绝，再读正文或探测文件。
  验收：未授权/跨站/错媒体类型请求均不能探测路径或启动进程。

- **EXEC001** [lib/index.js:88](https://github.com/nubeslove/dsh-file-actions/blob/0e7ff4f0ce2921580c9fda4575fbb6185478b799/lib/index.js#L88)：open/browser/open-url 交给 cmd.exe /c start，手工引号与 windowsVerbatimArguments=true 仍保留 cmd 百分号变量展开；本地脚本/可执行文件也缺独立确认边界。
  最小修改：改用不解释目标文本的系统打开 API 或固定浏览器 argv；限制 URL、路径/UNC/设备及可执行目标，明确高风险打开确认。
  验收：一次性 Windows 夹具覆盖百分号变量、空格/引号/元字符、UNC 和脚本；只打开授权原目标，不附加命令。

- **COMPAT001** [package.json:23](https://github.com/nubeslove/dsh-file-actions/blob/0e7ff4f0ce2921580c9fda4575fbb6185478b799/package.json#L23)：固定 manifest 没有当前官方窗口（0.2.1-alpha.5 / rc.1 / rc.2）至少一版的精确 compatible 记录；历史版本、宽范围和自定义 workshop 字段不替代逐版声明。
  最小修改：实际验证后，在 dsh.compatibility.dshReleases 声明至少一版当前窗口的准确结果，并给出该版本安装/启动/卸载证据；未验证项保留 unknown。
  验收：至少一版当前窗口声明与证据一致；其他宿主、系统和 rollback 不从旧记录推定。

## #1469

### dsh-web-preview 0.1.0

固定 Commit：`320cebb458a525e119d34095010e3faf55166c47`；7/7 个有界文本、29,637 字节，已完整读取并核验 Git blob/SHA-256。最终结论：**blocked / rejected**。

已按最新固定 Commit 完成审核；只读 health 也暴露本机绝对 Profile 路径，且资源直达绕过客户端 URL 校验。标准兼容声明缺失，拒绝准入；不把开发截图脚本当运行时凭据行为。

- **PRIVACY001** [lib/index.js:58](https://github.com/nubeslove/dsh-web-preview/blob/320cebb458a525e119d34095010e3faf55166c47/lib/index.js#L58)：未鉴权 GET /health 返回 profileHome（DSH_HOME 或用户 homedir）和 hasProfileHome，泄漏用户绝对路径；健康检查并非只有不敏感 ready。
  最小修改：去掉不必要的本机路径/存在性信息，或在返回敏感状态前复用官方请求授权并 fail closed。
  验收：匿名/跨站请求不获得用户路径或文件系统存在性；公开 health 只返回最小非敏感状态。

- **UI001** [lib/client.js:104](https://github.com/nubeslove/dsh-web-preview/blob/320cebb458a525e119d34095010e3faf55166c47/lib/client.js#L104)：currentUrl 直接 decodeAddress(tab.contentId)，第 276 行 iframe.src 使用该值；只在 navigate 内调用 validate。资源链接直接打开可绕过 http/https 和 DSH 自身 origin 禁止条件。
  最小修改：在渲染 iframe、外部打开及任何资源入口统一验证解码后的 URL；不合规 URL 不创建 frame；对允许脚本/同源的 sandbox 证明重定向后的宿主隔离。
  验收：通过直接资源地址、错误协议、DSH 自身 origin 和重定向测试；都不能嵌入/执行宿主同源页面。

- **COMPAT001** [package.json:23](https://github.com/nubeslove/dsh-web-preview/blob/320cebb458a525e119d34095010e3faf55166c47/package.json#L23)：固定 manifest 没有当前官方窗口（0.2.1-alpha.5 / rc.1 / rc.2）至少一版的精确 compatible 记录；历史版本、宽范围和自定义 workshop 字段不替代逐版声明。
  最小修改：实际验证后，在 dsh.compatibility.dshReleases 声明至少一版当前窗口的准确结果，并给出该版本安装/启动/卸载证据；未验证项保留 unknown。
  验收：至少一版当前窗口声明与证据一致；其他宿主、系统和 rollback 不从旧记录推定。

## #1473

### dsh-web-annotate 0.3.0

固定 Commit：`511a4abf7be2a363930a7bead5d16b83a76caaf3`；8/8 个有界文本、79,160 字节，已完整读取并核验 Git blob/SHA-256。最终结论：**blocked / rejected**。

预检 0.1.0 已被默认分支 0.3.0 的完整固定源审阅取代。浏览器/SSE/输入/导出缺请求授权，Chromium 强制关闭 sandbox，且宿主依赖和精确兼容契约缺失，拒绝准入。

- **AUTH001** [lib/index.js:324](https://github.com/nubeslove/dsh-web-annotate/blob/511a4abf7be2a363930a7bead5d16b83a76caaf3/lib/index.js#L324)：全部路由直接注册到 webServer，无请求授权/可信 Host/Origin 或 JSON 媒体类型门禁。/session 可启动浏览器，/frames 暴露画面，/input 控制页面，/export 写文件。
  最小修改：统一复用官方请求授权，读/写/SSE 都在访问 session 或启动浏览器前检查；写路由限制 JSON 和有界正文，SSE 绑定授权会话并限制资源数量。
  验收：未授权、跨站、错误媒体类型、未知 session 无浏览器/输入/文件副作用，也拿不到画面；授权面板功能保留。

- **BROWSER001** [lib/index.js:48](https://github.com/nubeslove/dsh-web-annotate/blob/511a4abf7be2a363930a7bead5d16b83a76caaf3/lib/index.js#L48)：chromium.launch 对任意 http/https 内容无条件设置 --no-sandbox，撤销浏览器进程隔离；只限制协议不能替代浏览器沙箱。
  最小修改：移除默认 --no-sandbox；如特定平台必须例外，采用明确可关闭的隔离策略和可核验安全运行契约，不作为通用默认。
  验收：正常沙箱开启下可预览；不支持的环境安全失败，不默默降级为无沙箱浏览器。

- **DEPENDENCY001** [lib/index.js:30](https://github.com/nubeslove/dsh-web-annotate/blob/511a4abf7be2a363930a7bead5d16b83a76caaf3/lib/index.js#L30)：从可变 DSH_PROFILE 解析未声明的 playwright 并启动 Chromium，manifest 没有对应版本/peer 或宿主供应契约；零 dependencies 不等于无运行依赖。
  最小修改：声明并固定受支持的 Playwright/Chromium 与官方宿主供应契约，检查版本/路径，不加载任意 Profile 中未受审包；提供可只读核验的来源与许可。
  验收：明确宿主版本下依赖解析可复现且缺依赖安全失败；供应链来源、许可、版本及实际解析一致。

- **COMPAT001** [package.json:23](https://github.com/nubeslove/dsh-web-annotate/blob/511a4abf7be2a363930a7bead5d16b83a76caaf3/package.json#L23)：固定 manifest 没有当前官方窗口（0.2.1-alpha.5 / rc.1 / rc.2）至少一版的精确 compatible 记录；历史版本、宽范围和自定义 workshop 字段不替代逐版声明。
  最小修改：实际验证后，在 dsh.compatibility.dshReleases 声明至少一版当前窗口的准确结果，并给出该版本安装/启动/卸载证据；未验证项保留 unknown。
  验收：至少一版当前窗口声明与证据一致；其他宿主、系统和 rollback 不从旧记录推定。

## Store 修复与证据边界

Ledger 的旧 AUTH001 已修复，当前完整源码符合 reviewed 通道，Catalog 改为 approved/user-reviewed。官方 Connection 0.2.1-rc.2 的发布 SRI 与 requestRejection → admit 已独立读取；rc.2 精确兼容为作者声明，运行/GUI/生命周期没有由 Store 重跑。Joey 两项目分别按指定完整 Commit 审阅，skill-install 的 v0.1.1 标签指向另一 Commit，不混为 0.1.3。Tun 的 a878df87 仅六个文档/证据文件有变；已独立核验 yaml 2.9.1 npm 归档 233 文件的 SHA-512/SHA-256、ISC、无直接依赖与安装钩子。MIT/NOASSERTION、固定导入和开发夹具不作为新的恶意指控。

新增正文复核通道只接受 main-reviewed 的明确复核请求，核验原 issue 不变 ID、作者不变 ID、正文摘要/更新时间、无新作者评论或已回复，并走原中央 CAS；合并 Joey 两个请求在单次 CAS 内消费两条评论，后续不能拆开发第二条。失败/超时永不返还预留。修复状态同步文字被误识别为复核的否定语义；新投稿仍不提供继续沟通授权。

自动 Catalog 最近一次运行 39079354758 在 Store 自身测试读取已压缩省略的 searchTerms.length 时失败。本 PR 将该测试按可选字段契约修正，不改准入门槛；同时修复 Catalog 读取器截断超过 120 字符的 DSH 兼容范围的问题，保留完整范围（上限 4096，超限拒绝），避免重写目录损坏 Store 0.9.8 的兼容声明；自动作者回复仍关闭，不能假定自动化已回答本轮请求。

## 联系和 issue 状态

计划发送三条：#1466 合并 #1467，#1464 合并两条材料，#1477 关联 #1376。#1465/#1460、#1468/#1469/#1473、#1478 已用首次联系名额，新投稿不续权，故只公开本次最终记录，不补评论/关闭通知。#1415 明确“状态同步，不请求本轮准入复核”，不回复、不准入、不刷新 Catalog；作者说明历史故障关闭为 not planned 且未归因，不能标为已修复。全部 issue 保持打开，无 label 编辑或重跑预检。实际评论、PR、提交和 GitHub/Pages/两站回读保存在交付回执。
