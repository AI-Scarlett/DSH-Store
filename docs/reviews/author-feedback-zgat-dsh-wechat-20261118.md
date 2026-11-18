# 固定来源审阅：zgat/dsh-wechat

审阅日期：2026-11-18

## 请求与来源绑定

- Store Issue：[#1321](https://github.com/AI-Scarlett/DSH-Store/issues/1321)
- 作者：zgat，GitHub immutable user ID `23634926`
- 本次处理的最新请求：评论 [#6406848697](https://github.com/AI-Scarlett/DSH-Store/issues/1321#issuecomment-6406848697)，正文 SHA-256：`ccde16ef7149b1d8b52077c67d420af645957b5971da78f062504ad8d490ade7`
- 作者要求审阅的固定 Commit：`0776189bc200ddda2129a611ba6aeade44be380a`（`dsh-wechat@0.3.5`）
- 审阅时 Catalog 当前来源：`8213a830351753f128926b535693355b2f77763e`（`dsh-wechat@0.3.7`）。此来源比请求 Commit 多两个提交，改动涉及 README、设计文档、`lib/bridge.js`、`lib/config.js`、`lib/ilink/media.js`、`lib/index.js`、manifest 和测试；所以本结论同时核对了两个固定来源，并将最终 Catalog 决定绑定到当前的 0.3.7 Commit。
- 当前 Catalog binding：`fe383ba7afe1d0a4045516948b879db142f836e0352e80fe73add2608c4b3b14`

固定源码、manifest、分发清单和权限信号均作静态审阅；没有执行第三方安装、依赖、脚本、测试、构建或运行时代码。作者提供的一次性 Profile 结果仅作为作者证据，不等于 Store 独立运行验收。

## 终态结论

**拒绝本次准入；Catalog 保持 blocked。** 自动扫描器旧的 `commands` 与 `nativeOrExecutableArtifacts` 结论已由商城修复，不再作为当前阻塞。当前固定来源仍有真实的文件、网络和凭据能力信号；审阅另发现 AUTH001 和 COMPAT001 两个未满足项。

## AUTH001：本地 Web 路由缺少受信调用方检查

- 0.3.5 的 `lib/index.js:152` 和当前 0.3.7 的 `lib/index.js:168` 注册 `/dsh-wechat` 原始 `webServer` 前缀路由。处理器没有先调用 DSH 的 `connection.requestRejection` 或其他已验证的调用方信任入口。
- 路由返回 bot 连接、登录/二维码、错误计数、版本和错误状态；POST 路由还可以重命名 bot、注销凭据，并改变本地插件状态。方法限制不建立调用方身份或跨站请求边界。当前代码的“仅 loopback”注释不是服务器端请求校验。
- 官方 DSH `0.2.2-rc.4` 的 `packages/host/open-in-app/src/index.ts` 明确在路由业务逻辑前调用 `connection.requestRejection(req)`，用于 Host/Origin 和登录 cookie 检查。这是同一受支持宿主路由的请求信任入口。
- **最小修改：** 在所有状态读取和修改前通过受支持的请求信任入口；服务缺失或检查报错时 fail closed。保留功能与真实文件/网络能力披露。
- **验收：** 一次性 fixture 验证跨站 Origin、缺失请求上下文、缺失信任服务和检查异常均在状态/凭据读取或修改前拒绝；受信 DSH 卡片请求仍正常；错误方法仍被拒绝。

## COMPAT001：没有当前 latest-three 的精确兼容证据

- 0.3.7 的 `package.json:53-58` 只列出 `0.2.0-rc.2`、`0.2.0-rc.1`、`0.2.1-alpha.1` 和 `0.2.1-rc.2`。
- 官方 npm 包当前发布序列的最新三版为 `0.2.2-rc.2`、`0.2.2-rc.3`、`0.2.2-rc.4`；manifest 对这三版没有逐版本状态。宽范围 `>=0.2.0-rc.2 <0.3.0` 不构成兼容证明。
- **最小修改：** 只对已验证版本增加逐版本 `compatible` 声明，并绑定可审查的安装、启动、卸载证据；未验证版本继续标为 unknown。
- **验收：** latest-three 中至少一个具体版本具备准确的兼容声明和相应固定 Commit/CLI/临时 Profile 证据；其余未测版本不从范围推断。

文件、网络和凭据是插件的实际能力，不要求为通过扫描而删除。作者对 MIT、依赖和一次性 Profile 的材料未覆盖上述路由信任与当前宿主版本窗口，因此不能改变终态结论。

## 商城缺陷和 Catalog 更新

Issue #1321 报告的历史固定源刷新门禁缺陷已由商城修复：PR #1927 / #1929 修正重算条件，PR #1930 更新 Catalog。当前 Catalog 已到 `0.3.7 / 8213a830351753f128926b535693355b2f77763e`，准入 binding 已重算，statusReason 只保留 files、network、credentials。该 Store 修复不转嫁给作者。

实际 DSH Profile 安装/启动验收仍为 unknown；本次没有修改真实 Profile。
