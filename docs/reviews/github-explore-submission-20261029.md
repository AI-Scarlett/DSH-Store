# github-explore 3.1.2：作者提交的复核证据

请求对 [github-explore](https://github.com/Fectivnfy112357/github-explore) 的固定源码
[`6ee754470c23f71204f26ebbd6b8bb1d36915d5f`](https://github.com/Fectivnfy112357/github-explore/commit/6ee754470c23f71204f26ebbd6b8bb1d36915d5f)
进行专项准入复核，关联 [#585](https://github.com/AI-Scarlett/DSH-Store/issues/585)。
本文件是作者申请，不是商城的批准结论；目录状态、安装策略和独立审计状态不由此改变。

- manifest：`package.json`；Bundle：`cordis.patch.yml`；入口：`github-explore-skill`；许可证：MIT。
- 逐版本声明包括当前官方窗口 `0.2.1-rc.3`、`0.2.1-rc.4`、`0.2.2-alpha.2`；Node 声明为 `26.8.1`。
- 作者侧：在 Linux / Node 26.8.1 的独立 DSH_HOME 中，三个当前版本分别通过本地 checkout 安装；启动宿主后，临时探针在 `ctx.skills.list()` 中观察到该技能；随后卸载命令退出成功。宿主由超时停止。旧窗口三个版本也进行了相同检查。没有验证交互式 agent 调用、回滚或其他系统、Node 版本。
- DSH-Store 本地提交预检针对上述 commit 返回 passed；有界扫描 18/18 文件，发现 `lib/index.js:14` 文件访问能力信号。该静态预检不等同于完整准入审阅、安全审计或商城独立运行验收。
- 技能依赖 `gh` 和 Python；按用户指令调用 GitHub 命令与脚本，可能访问文件、网络及 gh 管理的凭据。manifest 含 `prepack` 脚本；申请预检定义的 `preinstall`、`install`、`postinstall`、`prepare` 均未声明。

请按当前固定源码、入口、权限和策略完成复核，并由商城维护者决定能否更新 Catalog 及采用何种安装策略。真实 Profile 操作结果属于作者侧证据；商城独立验收和安全审计仍未完成。
