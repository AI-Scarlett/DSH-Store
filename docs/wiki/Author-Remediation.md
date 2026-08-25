# 插件作者整改通知

## 哪些项目会收到通知

成功的 Catalog 扫描会为不符合准入条件、暂缓上架或候选项目生成原因明确的整改记录。通知覆盖新发现项目，也会跟踪已通知项目在 canonical 仓库是否出现新的默认分支 Commit。

每次工作流最多新建 3 个整改 Issue，避免短时间大量通知。已有记录会复用并更新，不会为同一项目无限创建重复 Issue。

## 通知中包含什么

- 当前失败或暂缓原因；
- 最小可执行修复建议；
- [build-dsh-plugin](https://github.com/AI-Scarlett/build-dsh-plugin) 的只读检查与修改入口；
- [DSH STORE 官网](https://dsh.store/)；
- [上架契约](https://github.com/AI-Scarlett/DSH-Store/blob/main/registry/README.md)与自动化证据链接。

常见整改包括：补充公开许可证、标准 `dsh.bundle.patch`、唯一入口 ID、显式运行文件、兼容最近三个 DSH 版本之一、移除隐藏生命周期脚本、减少运行时源码体积，或明确 monorepo 插件目录。

## 如何判断作者是否修改

自动化保存上次观察到的仓库默认分支 Commit。后续运行会分为：

- 未检测到新提交；
- 首次建立基线或暂无法判断；
- 检测到修改但仍未通过；
- 检测到修改且原阻断已清除。

这只能证明 canonical 仓库是否出现新 Commit 以及门禁结果变化，不能证明作者阅读了邮件、理解了建议或完成了真实运行测试。

## 关于“邮件”

仓库通过 GitHub Issue、评论和 `@mention` 触发 GitHub 通知。接收者是否收到电子邮件取决于其 GitHub 通知设置，DSH STORE 无法验证实际投递或阅读。每次自动报告会分别列出 GitHub 整改消息数量、GitHub 邮件通知触发数量和作者修改结果，不把触发量冒充送达量。
