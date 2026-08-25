# 安装与使用

## 安装前

- 使用项目 README 当前列出的 DSH 兼容版本和 Node.js 版本。
- 确认官方 `dsh` CLI 可用，并知道目标 Profile 名称；示例使用 `web`。
- 首次安装前备份该 Profile 的 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 和 `cordis.patch.yml`（存在时）。

## 使用固定 Commit 安装

请从[主仓库 README 的安装章节](https://github.com/AI-Scarlett/DSH-Store#安装插件商城)复制当前命令。安装来源必须是 Catalog 已固定的 40 位 Git Commit，不要把它改成浮动的 `main`：

```bash
dsh plugin --profile web add 'git+https://github.com/AI-Scarlett/DSH-Store.git#<catalog-fixed-commit>'
```

如果你的 Profile 不叫 `web`，只替换 Profile 名称，不要自行改包名或来源路径。首次安装发生在管理器启动前，因此尚没有商城内的一次性计划、备份和回滚保护。

## 安装后验收

1. 运行 `dsh --profile web --dump-config`，确认配置可以合成。
2. 启动 DSH 后打开“设置 → 插件 → 插件商城”。
3. 检查商城、已安装和健康检查三个视图是否可以读取。
4. 只有在 Guardian 心跳、首页 HTTP、runtime API、Profile 和 Boot ID 一致并持续稳定后，才把重启视为成功。

## 插件安装与更新

- 商城只从可信 Catalog 生成安装计划；候选库没有安装按钮。
- 每个来源最终解析为完整 Commit；不会直接安装浮动分支。
- 更新前会核对 manifest、许可证、Bundle Patch、入口 ID、生命周期脚本、依赖和权限信号。
- 高风险但合法的插件会显示具体变化并要求本机逐次确认；触碰 DSH 核心或受保护组件的候选会被禁止。
- 商城自身的包标识仍是 `dsh-safe-plugin-manager`。GitHub 仓库改名为 `DSH-Store` 不会改变 API 路由、状态目录或已安装包身份。

## 出错时

不要连续重复安装，也不要手工编辑 Profile 或绕过 DSH CLI。保留脱敏后的原始错误和安装前备份，在 [GitHub Issues](https://github.com/AI-Scarlett/DSH-Store/issues) 提交问题。不要上传凭据、完整 Profile、环境变量或私人文件。
