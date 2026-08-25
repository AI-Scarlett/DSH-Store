# 常见问题

## 新仓库地址是什么？

当前 canonical 仓库是 [AI-Scarlett/DSH-Store](https://github.com/AI-Scarlett/DSH-Store)。旧的 `AI-Scarlett/dsh-safe-plugin-manager` URL 由 GitHub 重定向，但新文档、Catalog、Pages、工作流和安装命令都应使用新地址。

## 为什么包名还是 `dsh-safe-plugin-manager`？

GitHub 仓库名称和插件包身份是两件事。保留包名可以避免破坏已安装依赖、API 路由、本地状态目录、Bundle 入口和保护规则。不要手工把包名替换成 `DSH-Store`。

## 自动化在哪里运行，需要 Codex 或商城服务器吗？

Catalog 扫描、历史版本检查、PR、Pages 构建、看门狗和作者通知都在 GitHub Actions 运行，不依赖 Codex 常驻，也不依赖商城服务器执行扫描。国际站和国内站属于独立部署表面，看门狗会检查它们是否与 GitHub 权威目录一致。

## 为什么自动扫描经常显示新增 0、更新 0？

0 可能是正确结果：新项目可能已经收录、不是标准 DSH Bundle、缺少许可证或完整固定源码、权限/依赖超出自动准入范围，或没有兼容最近三个 DSH 版本之一。历史项目只有默认分支 manifest 的版本高于 Catalog 且完整门禁重新通过，才计为更新。

## “运行时源超过自动检查字节限制”是安全漏洞吗？

不是。它表示自动化无法在既定资源上限内完整检查整个运行面，因此失败关闭。直接去掉限制会让超大仓库拖垮扫描，或诱使系统只检查一部分代码后错误批准。正确做法是缩小运行包、拆分资源或进入能覆盖全部源码的专门审查。

## 自动扫描通过等于插件安全吗？

不等于。它证明固定源码满足确定性的静态准入规则；不证明真实安装、运行行为、故障恢复或绝对安全。页面会分别显示发现、安装、运行与安全证据。

## 如何提交插件？

使用[插件上架表单](https://github.com/AI-Scarlett/DSH-Store/issues/new?template=plugin-submission.yml)提交公开 GitHub 地址。monorepo 可补充插件目录。建议先用 [build-dsh-plugin](https://github.com/AI-Scarlett/build-dsh-plugin) 检查并整改。

## 如何知道自动化是否成功？

打开 [GitHub Actions](https://github.com/AI-Scarlett/DSH-Store/actions)，查看 “Automated plugin radar and Catalog update” 与 “Three-hour marketplace watchdog”。商城首页也会展示最近自动新增清单和运行证据；固定报告 Issue 会列出新增、历史更新、作者通知和公共表面状态。
