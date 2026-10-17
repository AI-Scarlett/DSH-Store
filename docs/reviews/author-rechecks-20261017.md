# 2026-10-17 作者整改固定源最终判定

基线 ef39537839a1c3817973ca4a5f5b7b1946e4506f。仅审阅公开固定 Git source，不执行作者 install/build/test/runtime；真实 Profile 未变更。三个条目均为 blocked，不可据此安装。

官方 npm 当前 latest-three：0.2.1-alpha.3、0.2.1-alpha.4、0.2.1-alpha.5。范围声明不替代逐版本兼容证据。

## #1390: 0.17.7 / ec492531209e9cc89fc6d68fd86104074ef8241b

[固定源码](https://github.com/yanfei0725/dsh-qwen-paint/commit/ec492531209e9cc89fc6d68fd86104074ef8241b)；运行文本 8 个，835981 字节，Git blob 与 SHA-256 全覆盖；binding e2b643d07c26ee87d1410464707ba1c7cb84de60423e137674c79e25be9415d1。最终判定 rejected，Catalog blocked。

已确认 Host/Origin/cross-site 围栏及客户端 POST 改造；缺 Origin 本身不是拒绝项。作者声称的 170 项测试未由 Store 执行。既有出站守卫、加速包披露与 Tool-view 归属结论保留为静态证据。

- **AUTH001**：[lib/index.js:3869](https://github.com/yanfei0725/dsh-qwen-paint/blob/ec492531209e9cc89fc6d68fd86104074ef8241b/lib/index.js#L3869)。isTrustedRequest/旧名别名已增加 Host 缺失拒绝、cross-site 拒绝及存在 Origin 时同 authority 检查；但状态 POST 没有 Content-Type 校验，非 GET/POST 方法也未统一拒绝。repairHandler:4355-4367 无方法/媒体类型限制，任意方法解析 confirm:true 即调用 runRepair。另状态 GET 的 4242 行仍可调用 recoverFromSageCrash，后者 642-644 行会改 cfg.nvidiaSageAttention；不能判为严格只读。
  最小修改：保留已完成的信任围栏和客户端 POST 改造。状态入口仅允许 GET 读取和 POST application/json 写入；repair 仅允许 POST application/json，错误方法/媒体类型在读取正文或任何修复动作前拒绝，正文采用有界解析。将修改运行配置的故障恢复放到生命周期/后台或显式写操作，GET 只展示状态。对 memory/preference POST 同步限制 JSON 与正文上限。
  验收：在一次性 fixture 中，跨站/不可信 Origin/缺 Host 请求均在私有读写/命令前 403；状态 GET（含故障恢复分支）不改配置或持久化状态；repair 的 GET/PUT/DELETE 与 text/plain POST 不执行动作；合法受信 POST JSON 正常工作。无需删除绘图、加速或卡片功能。

- **COMPAT001**：[package.json:34](https://github.com/yanfei0725/dsh-qwen-paint/blob/ec492531209e9cc89fc6d68fd86104074ef8241b/package.json#L34)。截至本轮官方 npm 最新三个发布版为 0.2.1-alpha.3 / alpha.4 / alpha.5；此固定 manifest 对三者均未声明 compatible。现有 0.2.0-rc.2 声明不能替代当前窗口。
  最小修改：在实际验证后，对所支持的完整 DSH 版本添加准确的逐版本声明，并提供对应安装、启动及卸载证据；未验证的版本保留 unknown，不从范围推断兼容。
  验收：新固定 Commit 至少对当前官方 latest-three 窗口中的一个完整版本具备可审核的 compatible 声明及对应证据；Store 自身未执行的运行验收继续 unknown。

## #1386: 1.0.1 / 75e475a7b45e3cc2cf3c093fb8892e36642030fb

[固定源码](https://github.com/ArisaYamatogi/dsh-lecture-copilot/commit/75e475a7b45e3cc2cf3c093fb8892e36642030fb)；运行文本 13 个，195668 字节，Git blob 与 SHA-256 全覆盖；binding 8d57f64b382b3a0c338d41fe4a604e64652395c9e8488ba53826347369da5558。最终判定 rejected，Catalog blocked。

已撤换旧的 repository/license/Node/DSH 声明问题。作者只有版本报告；本次单条结果依据当前所有者逐项回复指令，经独立有限授权与同一中央 CAS 账本发送，不记为作者继续沟通同意。

- **AUTH001**：[lib/index.js:656](https://github.com/ArisaYamatogi/dsh-lecture-copilot/blob/75e475a7b45e3cc2cf3c093fb8892e36642030fb/lib/index.js#L656)。lectureRoutes 直接注册原始 HTTP handler；state/review 读取课堂内容，start:669、stop:694、clear:720 不检查 method 或请求信任；clear 可取消 review 并清空会话。928/986/1056 的 OneNote 写入/记忆删除同样无请求来源围栏。1117-1121 将这些 handler 直接传给 webServer.register，没有统一授权包装。
  最小修改：在路由公共入口接入宿主支持的 request-trust/auth seam 或等价 Host/Origin/Sec-Fetch-Site 拒绝逻辑，私有读取与写入之前验证。读取限定 GET，start/stop/clear/select/OneNote 等变更限定显式 POST 及各自的 JSON/audio Content-Type；保留已有正文上限和错误处理。
  验收：一次性 fixture 中不可信 Origin、cross-site、缺必需上下文请求在访问课堂内容、调用模型、清空会话、写文件或启动 OneNote 前拒绝；GET 不触发写操作；可信的录音/翻译/OneNote 路径正常。

- **COMPAT001**：[package.json:63](https://github.com/ArisaYamatogi/dsh-lecture-copilot/blob/75e475a7b45e3cc2cf3c093fb8892e36642030fb/package.json#L63)。截至本轮官方 npm 最新三个发布版为 0.2.1-alpha.3 / alpha.4 / alpha.5；此固定 manifest 对三者均未声明 compatible。现有 0.2.0-rc.2 声明不能替代当前窗口。
  最小修改：在实际验证后，对所支持的完整 DSH 版本添加准确的逐版本声明，并提供对应安装、启动及卸载证据；未验证的版本保留 unknown，不从范围推断兼容。
  验收：新固定 Commit 至少对当前官方 latest-three 窗口中的一个完整版本具备可审核的 compatible 声明及对应证据；Store 自身未执行的运行验收继续 unknown。

## #934: 0.2.4 / ec9c22794b8de3c1794246b309fce6ecd66df90a

[固定源码](https://github.com/sakuraqqq/dsh-auto-paste/commit/ec9c22794b8de3c1794246b309fce6ecd66df90a)；运行文本 8 个，199288 字节，Git blob 与 SHA-256 全覆盖；binding 61a4b24f036fe886e4eadb85ecc179324ed8b8024ca2ee2a7b40c4dfdb6716f4。最终判定 rejected，Catalog blocked。

已核对 v0.1.4 manifest：zod:^4.4.3 早已存在，撤回此前“新增依赖”的表述；最新默认分支仅有文档变更，8 个运行 blob 与 5fab0ff 一致。zod 出现在 src 与实际 dist 的 Typert 文件；当前有三个 RPC（含 setMinChars）。未观测到网络/命令/凭据能力，文件写入继续披露。npm 4.6.5 元数据有 MIT、无运行依赖、签名及 SLSA v1 provenance 声明；未声称已密码学验证签名，也未验证作者本机 46 包统计。

- **SUPPLY001**：[package.json:73](https://github.com/sakuraqqq/dsh-auto-paste/blob/ec9c22794b8de3c1794246b309fce6ecd66df90a/package.json#L73)。zod:^4.4.3 是唯一直接第三方运行依赖，v0.1.4 已存在，先前“新增”说法错误。src/typert.host.ts 和实际分发的 dist/typert.host.js 均导入 zod。pnpm-lock.yaml:11-13 固定 4.4.3，而本次作者材料描述本机 4.6.5；没有证据证明实际 DSH Git 安装强制使用一个经审阅的精确依赖版本和分发文件闭包。npm 的 MIT/签名/来源元数据不能单独证明这一安装映射。
  最小修改：可保留 zod。提供一种安装路径实际强制采用的固定依赖闭包：例如精确版本、完整性哈希、canonical source Commit、已分发运行文件的有界哈希/许可证/安装钩子证据以及 DSH 安装解析证明；或提供带许可证的自包含固定 Commit 分发。仅把 ^4.4.3 改成 4.6.5 不能单独补齐源码和分发映射。本轮不要求为了外观与官方包一致而改变依赖类型。
  验收：Store 可独立读取并绑定实际安装执行的全部依赖节点，确认精确版本、不可变源码/分发哈希、已知许可证、无未经审查安装钩子以及闭包完整性；安装路径不会再浮动解析到另一版本。

- **COMPAT001**：[package.json:49](https://github.com/sakuraqqq/dsh-auto-paste/blob/ec9c22794b8de3c1794246b309fce6ecd66df90a/package.json#L49)。截至本轮官方 npm 最新三个发布版为 0.2.1-alpha.3 / alpha.4 / alpha.5；此固定 manifest 对三者均未声明 compatible。现有 0.2.0-rc.2 声明不能替代当前窗口。
  最小修改：在实际验证后，对所支持的完整 DSH 版本添加准确的逐版本声明，并提供对应安装、启动及卸载证据；未验证的版本保留 unknown，不从范围推断兼容。
  验收：新固定 Commit 至少对当前官方 latest-three 窗口中的一个完整版本具备可审核的 compatible 声明及对应证据；Store 自身未执行的运行验收继续 unknown。

## 流程与回滚

三个 Issue 暂保持打开。完整请求 hash、源文件 hash、最终判定见同名 JSON 与 registry/author-resolutions.json；回复计划绑定后者 SHA-256。所有消息必须先合入 main，再通过现有 Requested author feedback resolution 工作流和中央 contacts.json CAS 发送一次。未知/失败送达永久占用名额，不重试。代码或目录回滚走 CI 检查的 revert PR；联系历史、停止状态和预留永不回滚。
