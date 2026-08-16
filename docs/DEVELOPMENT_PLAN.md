# 开发路线

## M0：仓库与边界（已完成）

- 独立 Git 项目；
- 标准 DSH Bundle/Host/Client 骨架；
- 产品、架构、安全和验收文档；
- 临时目录单元测试与静态无写入门。

## M1：只读真实集成

- 在一次性 `dsh-safe-manager-test` Profile 安装本地 checkout；
- 验证 DSH 启动、Host 路由、设置标签和明暗主题；
- 补充 Profile 自动识别或可靠的当前 Profile 注入机制；
- 连接官方 Plugin Inventory 的只读 Remote，区分 declared/runtime；
- 对 malformed manifest、缺包、坏 symlink 和 headless 场景做故障注入；
- 运行前后比对关键文件内容与目录清单，证明扫描零写入。

完成定义：`docs/ACCEPTANCE.md` 中 M1 全部通过，并保留命令、哈希与 UI 截图证据。

## M2：更新与兼容性

- npm 查询适配器：超时、缓存上限、Registry 来源、dist-tag 与发布时间；
- Git 查询适配器：只读 `ls-remote`，禁止修改本地 checkout；
- local/link/file 的明确不可判定状态；
- Node/DSH/peerDependencies 兼容性；
- Bundle Patch、重复行 ID、官方包重复安装的静态检查；
- 更新证据时间、错误分类和离线降级。

完成定义：断网、超时、404、私有仓库等都不得产生“无更新”的假结论。

## M3：写入设计评审

只写设计与原型，不接真实 Profile：

- `OperationPlan`、`Precondition`、`BackupManifest`、`CommitResult` 数据结构；
- 官方/关键组件保护策略；
- Profile 文件锁与并发冲突；
- 临时 Profile 预检、原子提交和逐字节回滚；
- 操作确认 UI 与审计记录脱敏；
- 包管理器调用采用参数数组，不接受 Shell 字符串。

完成定义：安全评审与故障注入方案通过后，才能进入 M4。

## M4：受控启停与更新

- 先做第三方条目的启停；
- 再做 npm 安装/更新；
- 最后评估 Git 来源；
- 每项能力独立开关、独立验收、默认关闭；
- 失败自动回滚，健康检查未通过不得提交成功状态。

## M5：发布准备

- 决定许可证并移除 `private`；
- 完成第三方来源与许可证审计；
- `npm pack --dry-run`、全新 Profile 安装/卸载验证；
- macOS/Linux/Windows 测试矩阵；
- 版本、变更日志、升级和恢复说明；
- 发布后重新下载包并验证内容、版本与哈希。

