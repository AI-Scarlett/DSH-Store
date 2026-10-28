# 作者回复：固定源码复核最终结论（2026-10-28）

本轮已对两条明确复核请求完成正式准入判定，并将最终状态写入 registry/author-resolutions.json、registry/admission-reviews.json 与 Catalog。两项均**暂不准入，保持 blocked、不可安装**。没有联系作者；没有执行第三方 install、prepare、build、test 或运行时代码；没有修改真实 DSH Profile。Desktop 真机 UI 验收仍为 unverified。

官方 DSH 当前 latest-three 为 0.2.1-rc.3、0.2.1-rc.4、0.2.2-alpha.2。官方来源：[alpha.2 发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.2)，[本仓库 DSH 与 Desktop 兼容性记录](dsh-native-market-alpha2-desktop-20261028.md)。

## #1276 — DedsecLemon/dsh-obsidian

- 请求者：GitHub 用户 ID 288661966；请求评论 [#6432573518](https://github.com/AI-Scarlett/DSH-Store/issues/1276#issuecomment-6432573518)，正文 SHA-256 df6fcdb4ad40f6a0692fbd0610d3f8890df0343c5df54be8fa25306017148c57。
- 最终复核固定到当前默认分支 1.6.4 / 789ddbf7f326f59260759337848728406f9aab67，而不是回复中提到的旧 1.6.3。bounded source 覆盖 19 个树条目、有界扫描面 4 个文件且完整；source digest 5049ae28b8d75d3d85bf3eefb2c08f62ea47c572c41b276a73c7022935fe1882，Catalog binding 46e525e4266f08e0adae7746f02ce6dc2b1ac4d23cdc1ce3258376fded2a8f36。
- **AUTH001 — 请求来源信任边界未建立。** [index.mjs:1342](https://github.com/DedsecLemon/dsh-obsidian/blob/789ddbf7f326f59260759337848728406f9aab67/index.mjs#L1342) 的 allowMethod 只限制 GET/POST；webServer 私有 Vault 读写路由直接注册，例如 [index.mjs:1682](https://github.com/DedsecLemon/dsh-obsidian/blob/789ddbf7f326f59260759337848728406f9aab67/index.mjs#L1682)。在读取笔记或创建、重命名、移入 .trash 前，未建立 DSH 调用方/Host/Origin 信任检查。最小修复：在所有私有读写前接入官方信任门禁，缺失上下文或校验失败时拒绝。验收：一次性 fixture 拒绝不可信 Origin、跨站来源和缺失信任服务的请求，受信请求仍可工作，GET 不写入。
- **COMPAT001 — 当前兼容性仍未验证。** [package.json:39-45](https://github.com/DedsecLemon/dsh-obsidian/blob/789ddbf7f326f59260759337848728406f9aab67/package.json#L39) 仅有旧 0.2.0-rc.2 compatible 记录，三版 current latest-three 均 unknown。最小修复：只对实际验证的当前版本添加精确 compatible 声明，并提供安装、启动、卸载证据；其他版本保留 unknown。
- 商城此前把 process.env 读取误报为 credentials。对绑定源码 index.mjs:111 的复核确认它用于 DSH_OBSIDIAN_APP 和应用路径选择，没有读取 token/API key/cookie/OAuth。该 credentials 信号已记为误报，Catalog 权限修正为 credentials: none。文件写入、指定本机服务网络及用户点击后的受限启动能力如实保留，不要求作者删除功能。

## #1596 — lg6169219/dsh-fatfish-level

- 请求者：GitHub 用户 ID 39356339；请求评论 [#6465097579](https://github.com/AI-Scarlett/DSH-Store/issues/1596#issuecomment-6465097579)，正文 SHA-256 9d2ee46f6a33d93041c108a71615a286d9c028ff9c035912d616a57ca6cb91c1。
- 按作者指定固定 0.3.3 / fa7a183b01c7a2ec0e71cb3587f1f8c1523e35c1 复核。bounded source 覆盖 24 个树条目、有界扫描面 6 个文件且完整；source digest 3b88abb7f855e7b60b7deab62083d3b28ae43ec892c598c875b1ea911ff747f5，Catalog binding e618f07d3afcf402ec930c00da99641ae4a21e29dd341b2c9f5f49630128475a。
- **AUTH001 — 请求信任检查 fail-open。** [lib/index.js:61-74](https://github.com/lg6169219/dsh-fatfish-level/blob/fa7a183b01c7a2ec0e71cb3587f1f8c1523e35c1/lib/index.js#L61) 在 connection/requestRejection 不存在时放行，检查抛错后也记录日志并放行；后续 state route 会读取本地用量快照。最小修复：服务缺失或异常都拒绝该 HTTP 请求；如 Desktop IPC 需要独立入口，单独证明其可信来源。验收：缺少 trust service、缺少 requestRejection 或校验抛错均在文件读取前拒绝，受信 DSH 请求仍能读取统计。
- **COMPAT001 — 当前兼容性仍未验证。** [package.json:45-57](https://github.com/lg6169219/dsh-fatfish-level/blob/fa7a183b01c7a2ec0e71cb3587f1f8c1523e35c1/package.json#L45) 只有宽 engines.dsh 范围，没有 current latest-three 的逐版本 compatible 证据。最小修复：为实际验证的当前版本补充精确结果及安装、启动、卸载证据；未验证版本保持 unknown。
- 文件权限限于插件自己的统计账本及作者说明的可选只读鲸鱼历史数据；网络为同源 DSH 路由；没有命令或凭据能力。用户要求不删除文件/网络功能，复核结论也不要求删除这些功能。

## 发布与后续边界

两项正式结论已经写入机器可读登记；Catalog 维持不可安装状态。合并后仍须分别核对 GitHub Raw、Pages、dsh.store 和 dsh-store.cn。作者感谢、源码更新或本次复核本身都没有触发联系授权；本轮未发送任何 GitHub 消息。完整固定源码文件哈希见同目录 JSON 报告。
