# DSH STORE 中文 Wiki

DSH STORE 是 DeepSeek Harness（DSH）的第三方插件商城与安全生命周期管理器。它帮助普通用户发现插件、查看中文用途、核对固定源码与权限，并通过可恢复的流程安装或更新标准 DSH Bundle。

## 常用入口

- [插件商城官网](https://dsh.store/)
- [GitHub 主仓库](https://github.com/AI-Scarlett/DSH-Store)
- [完整插件目录](https://dsh.store/plugins/)
- [提交插件上架](https://github.com/AI-Scarlett/DSH-Store/issues/new?template=plugin-submission.yml)
- [Catalog 机器目录](https://github.com/AI-Scarlett/DSH-Store/blob/main/registry/catalog.json)
- [自动化运行记录](https://github.com/AI-Scarlett/DSH-Store/actions)
- [build-dsh-plugin 检查工具](https://github.com/AI-Scarlett/build-dsh-plugin)

## 先理解四个不同状态

1. **已发现**：只表示项目进入候选库，不可安装。
2. **可收录/可安装**：固定 Commit、Bundle、许可证、入口和静态源契约通过。
3. **运行已验证**：必须有具体 DSH 版本、系统和 Profile 的真实运行证据。
4. **安全已审查**：只代表指定范围与方法内的审查，不代表代码绝对安全。

自动扫描、作者声明、推荐位、Stars 和成功构建都不能把低一级证据自动升级为高一级证据。未知证据会保留为“未知”，不会猜测为安全或兼容。

## 自动化概览

- Catalog 扫描每 8 小时运行，发现新项目并检查所有历史收录项目的默认分支 manifest 与版本。
- 看门狗每 3 小时检查上一次扫描是否成功，以及 GitHub Raw、GitHub Pages、国际站和国内站目录是否一致；可恢复问题会触发重跑。
- 作者整改通知在成功扫描后运行，记录发送量、GitHub 通知邮件触发量，以及作者是否提交了新 Commit。
- 所有目录写入都通过绑定基准 Commit 和文件哈希的机器计划、确定性门禁与可审计 PR 完成。

## 知识与故障应急

[故障应急百科](https://github.com/AI-Scarlett/DSH-Store/wiki/Incident-Response)持续维护 Catalog 陈旧、模块加载、兼容性证据、权限变化与安全升级的判断方法。它先区分源码、Catalog、页面、独立站点和真实 Profile，再给出可恢复的处理边界，不会把静态检查或单一页面读数写成运行成功。

继续阅读：[安装与使用](https://github.com/AI-Scarlett/DSH-Store/wiki/Installation-and-Usage) · [自动收录与更新](https://github.com/AI-Scarlett/DSH-Store/wiki/Catalog-Automation) · [安全与信任边界](https://github.com/AI-Scarlett/DSH-Store/wiki/Security-and-Trust) · [故障应急百科](https://github.com/AI-Scarlett/DSH-Store/wiki/Incident-Response) · [作者整改通知](https://github.com/AI-Scarlett/DSH-Store/wiki/Author-Remediation) · [常见问题](https://github.com/AI-Scarlett/DSH-Store/wiki/FAQ)
