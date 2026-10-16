# 作者整改后的正式准入判定 · 2026-10-16

本轮按用户要求完成正式判定，而不是再次发出“已读源码，等待审查”的回执。两项均完成第一方固定源码覆盖；此前要求修改的披露、出站守卫、分发入口和首次使用改进已逐项确认。完整审核发现的实际剩余门槛如下，均有具体整改方式。两个当前固定版本均不批准受保护安装；Catalog 与请求判定同步到本次源码和原因，不再保留旧版拒绝理由。

| 项目 | 本次固定版本 | 正式结论 | 唯一合并后的整改事项 |
| --- | --- | --- | --- |
| [#1390](https://github.com/AI-Scarlett/DSH-Store/issues/1390) | 0.17.6 / `3955b4f91ddb817d7bb0357da82cffd5d02fe4cb` | 不予准入 | AUTH001：本机 HTTP 接口的调用方与写入边界 |
| [#1415](https://github.com/AI-Scarlett/DSH-Store/issues/1415) | 0.2.13 / `46a3b4d31565df1dd03adff77607391a03805cf1` | 不予准入 | SUPPLY001：实际安装依赖闭包的可复现来源 |

## #1390：AUTH001，修复接口信任边界即可申请新的完整准入复检

已经确认通过：8 个分发文本、828,374 字节的固定 Git blob／大小／SHA-256；回环出站守卫和禁止重定向；加速包下载披露；子进程环境过滤；默认值注释修复。`lib/client.js:58-59,3177` 的 `draw_image` 卡片与 `lib/index.js:2127` 的本插件工具定义对应，Tool-view 归属已审清，**不再拿它作泛泛的待审理由**。命令、文件和网络能力本身不要求删除。

这次剩余的具体问题与已修复的注释无关：

- [`lib/index.js:1688`](https://github.com/yanfei0725/dsh-qwen-paint/blob/3955b4f91ddb817d7bb0357da82cffd5d02fe4cb/lib/index.js#L1688) 的 `isLocalRequest` 只看 Host 和 socket 的本机地址；缺失值也放行，不检查 Origin、Sec-Fetch-Site 或宿主调用方身份。
- 同文件 `3715-3777` 的状态 GET 处理器修改运行配置，部分选项还写 UI 状态。`4213-4229` 的修复接口和 `4321-4348` 的偏好读写接口同样只依赖这个回环判断。
- 来自其他网页、但目标地址为本机的请求，Host 和 socket 仍然是本机。单纯“只允许本机连接”不证明发起请求的网页可信。CORS 也不能阻止所有有副作用的 GET。
- 固定官方 alpha.3 的 [`host/webserver/src/index.ts:426-428`](https://github.com/deepseek-ai/deepseek-harness/blob/2fbf4359b82fb94c03dcce0b831660d87f12ea5c/packages/host/webserver/src/index.ts#L426) 对命中的插件路由直接调用 handler，并不替插件自动做上述校验。官方 [`api-request-trust.ts:121-150`](https://github.com/deepseek-ai/deepseek-harness/blob/2fbf4359b82fb94c03dcce0b831660d87f12ea5c/packages/client/connection/src/api-request-trust.ts#L121) 明确区分 Host、跨站标记和 Origin。这里只读核对官方源码，没有改官方包。

**最小修改办法，一次完成：** 让状态 GET 保持只读，写配置移到显式 POST JSON；私有读取、写入和修复操作之前接入目标宿主支持的请求信任／认证接口，或实现同等的 Host、Origin、Sec-Fetch-Site 与调用方检查。方法和 Content-Type 不符时拒绝；必需上下文或信任服务缺失时拒绝。客户端同步改用新的写接口。无需删绘图、加速包或 Tool-view 功能。

**验收条件：** 一次性 fixtures 中，本机 socket／Host 配合 `Origin: https://untrusted.example` 或 `Sec-Fetch-Site: cross-site` 的请求，必须在读取私有数据、写配置或执行命令前被拒绝；任意状态 GET 不产生配置写入；受信任的目标宿主请求正常；缺失信任上下文明确拒绝。Store 本轮没有执行插件或做真实跨站攻击复现，这是固定源码的信任边界判定。

## #1415：SUPPLY001，补齐实际运行依赖的固定分发证据

已经确认通过：110 个分发文本、703,110 字节的固定 Git blob／大小／SHA-256；稳定 Release、tag 和发布资产元数据；首次使用代码边界；新增 `web-search-fetch` 与覆盖 `web` 的不同语义。`web` 覆盖是合法能力，影响范围已明确，不再误报独占入口冲突。联网和凭据能力不要求声明为 false。alpha.4 等未验证版本不推断兼容，也不作为拒绝已声明兼容版本的借口。

具体缺口位于 [`package.json:100-106`](https://github.com/qikairo7/dsh-web-search-fetch/blob/46a3b4d31565df1dd03adff77607391a03805cf1/package.json#L100) 的 5 个直接运行依赖。Git 内完整读取的是第一方分发，不包括这些依赖实际安装的全部运行文件。[`docs/dependency-inventory.json`](https://github.com/qikairo7/dsh-web-search-fetch/blob/46a3b4d31565df1dd03adff77607391a03805cf1/docs/dependency-inventory.json) 自述为作者提供的 0.2.11 元数据，含 15 个包的锁定清单，但传递依赖的 manifest 仍含范围，且缺少“DSH 实际安装将严格使用该闭包”的源码证明，以及每个实际分发依赖到固定可读源码的映射。这里**没有发现或宣称依赖存在已知漏洞**；空公告查询和完整源码审阅也是两种证据。

**可接受的修改／补证路径，任选一种：**

1. 提交自包含、保留许可证的固定 Git 运行分发，使所需依赖运行模块也包含在可读的固定源码内，实际入口只引用这些分发文件。
2. 保留正常依赖，提供完整运行闭包的精确版本、canonical 源码 Commit、有界分发文件摘要、许可证与安装钩子证据，并提供源码可验证的安装解析约束，证明真实 DSH 安装会使用这一组经过审阅的内容，而不是另外解析未审阅版本。

Store 负责独立读取、核验和作出供应链判定，不要求作者自行给自己盖“安全通过”章。新增专项通道支持完整图、完整源文件摘要和安装解析证明；缺节点、摘要不匹配、无来源或未审安装钩子仍拒绝。仅增加 `complete: true`、版本列表或 advisory 结果不能通过。

**验收条件：** 每个运行节点均可独立定位到不可变来源和完整有界文件，传递图无缺口，许可证／安装钩子已知；安装解析证据绑定本插件 Commit，实际安装不会跳出该闭包。原 HTTPS 输入的历史故障仍按作者决定暂停，没有探针或重复外部调用；不将其混入本次供应链缺口。

## 商城自身修复及以后的处理规则

- 已修复 Tool-view 只能“待审”、无法受审放行的逻辑缺口。通过必须有逐文件摘要绑定的自有工具键归属证据，官方键仍拒绝。
- 运行依赖增加独立专项通道，只有精确依赖图、完整文件摘要和安装解析证据齐全才可进入受审状态；不会把有依赖的正常插件永久卡在一句“待供应链审查”。
- 作者明确请求复检时，即使没有投诉商城，也进入处理清单。正式结论按请求 ID、不可变人 ID、源码和 Catalog 保存；结论完成前不算已处理。
- 新增复检回复计划必须绑定正式结论 SHA-256；CI／发送器拒绝只有复核回执而没有正式判定的计划。符合条件必须更新 Catalog 并完成公网读回；不符合必须一次列清具体位置、修改方法和验收条件。商城自身工作不能当作作者缺陷。
- 联系限制仍然有效。本次两个原请求已各回复一次，尚未重复通知或绕过中央预留；最终补充回复稿已备好。公开审核记录和商城状态先行同步。

[机器判定记录](author-admission-decisions-20261016.json) · [请求与 Catalog 绑定记录](../../registry/author-resolutions.json)
