# 新作者回复复核 · 2026-10-16

本轮在前次回复后发现两条明确的新固定源码复检请求。23 条会话评论中 21 条为上轮回复、2 条为作者新请求；inline review 为 0。补查最新请求之后没有新评论。按不可变用户 ID 核对中央完整历史，两条请求在审阅时均未被消费，均无全局停止联系标记。回复仍须先合并本次专属计划，再由中央 CAS 预留后各发送一次；本记录写入时尚未发送。

## #1390：0.17.6 的披露矛盾已修复

- 请求：[作者原文](https://github.com/AI-Scarlett/DSH-Store/issues/1390#issuecomment-6213375613)。
- 固定提交：`3955b4f91ddb817d7bb0357da82cffd5d02fe4cb`。
- 完整有界分发文本 8 文件、828,374 字节，逐项核验长度、Git blob 与 SHA-256，基础预检通过。
- 相对 0.17.5，分发文本只更改版本号和 `lib/config.js` 注释。注释已与实际默认 `accelAutoInstall: true` 一致，明确加载后自动检测／安装白名单加速包及显式 false 的关闭方式。这一具体披露问题结案。
- README／manifest 已区分回环出图数据流与 pip／GitHub 供应链下载，不再报告“未披露外部网络”。自动安装等能力的独立审查与披露修复分开；不要求作者反复修复已解决的问题。
- 剩余命令、文件、网络、凭据信号与 Tool-view key 归属需独立审阅；注册 Tool-view 本身不等于修改受保护组件。没有运行依赖，但这不替代命令调用与宿主运行验收。精确兼容性声明仅有 `0.2.0-rc.2`。

## #1415：0.2.13 正式发布与首次使用改进可静态确认

- 请求：[作者原文](https://github.com/AI-Scarlett/DSH-Store/issues/1415#issuecomment-6213790736)。
- 固定提交：`46a3b4d31565df1dd03adff77607391a03805cf1`。
- 完整有界分发文本 110 文件、703,110 字节，逐项核验长度、Git blob 与 SHA-256，基础预检通过。
- `v0.2.13` tag 指向该提交，Release 非草稿、非预发布；GitHub 资产元数据的 398,880 字节与 digest `sha256:89087d78c1f7bbd7aca3cd57a98e2e59b0abc0fe475fe832f73570f905352343` 与作者声明相符。本轮未下载或安装执行包，因此不声称独立包验收。
- `client/index.js:262-282` 的匿名入口按 credential-ready、未配置、无 partial、无待保存 keyDraft 筛选服务，切到自定义预设；配置仍通过草稿保存生效。`client/index.js:795-800` 与 `lib/keyless.js:1-15` 限制官方端点的 origin／路径，拒绝 userinfo、query、hash。不把自定义端点当作匿名官方端点。
- `web` 配置覆盖与新增 `web-search-fetch` 入口分开审查，旧的独占 ID 冲突误报不再阻塞；后层整段 `web` config 替换的影响仍需独立复核。
- 5 个精确版本直接运行依赖仍需要供应链审查：`@deepseek-ai/schemastery@3.18.5-alpha.2`、`@joplin/turndown-plugin-gfm@1.0.68`、`fast-xml-parser@5.11.2`、`turndown@7.2.4`、`undici@8.11.2`。依赖清单与作者测试是输入，不等于 Store 已完成独立审查。
- 精确声明 alpha.2／alpha.3 compatible；rc.2／alpha.1 unknown；alpha.4 未列出，不推断兼容。GUI、键盘、质量、历史生命周期与资产下载验收按作者证据保留，本轮只确认静态源码及发布元数据。
- [原 HTTPS 输入历史故障](https://github.com/qikairo7/dsh-web-search-fetch/issues/3)仍未归因并保持暂停。本轮没有外部接口探针或重复调用，不把 HTTP→HTTPS 升级修复当作该故障已解决。

## 处理范围

两条新请求各准备一次针对性回复，保留独立准入审阅；没有关闭整个 Issue 的依据。本轮不修改 Catalog、不新增可安装条目，不改插件商城版本。两个项目已经进入前轮的互动推荐，本轮没有新的推荐范围变更。未执行第三方 install／build／test／runtime，也未修改真实 DSH Profile。所有分发文本证据、请求绑定与哈希见[机器记录](author-feedback-new-replies-20261016-1121.json)。
