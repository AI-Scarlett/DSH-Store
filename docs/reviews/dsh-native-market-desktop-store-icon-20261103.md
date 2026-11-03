# DSH Store 0.9.36 图标发布复核

## 目标

用户提供的 DSH Store 图标用于左侧商城标签和 DSH Desktop 插件列表中的 Store 包图标。

## 实现

- `package.json` 升级到 0.9.36，并通过顶层 `icon` 指向 `marketplace/dsh-store-icon-desktop.png`。该文件随现有 `files: ["marketplace"]` 一起打包，供 DSH Desktop 读取插件包图标。
- `sidebar.panellist` 以相同的 96×96 PNG 显示左侧入口图标；原 1254×1254 仓库品牌图保持不变。
- 图片来源 SHA-256：`8af3852ebf1cd2fe5b7d650a671d12200dd9c6f705e62a01f85a5255edb2d6c2`；96px 打包图 SHA-256：`43bf78b4ad72332d950bf6849fe2739938da1f09aa1aa577505b5b5735c9ce1b`。
- 仅更换图标和版本/发布记录，不改商城功能、DSH 核心、真实 Profile 或 Catalog。

## 验收状态

- 发布计划绑定基线 Commit `bfed2434c5c1b4915833d6384be38fda7cd17046`、精确文件范围和基线 SHA-256。
- `node scripts/verify-dsh-upgrade-plan.mjs docs/ops/dsh-native-market-desktop-store-icon-20261103.json`：`DSH_UPGRADE_PLAN_OK`，基线 `bfed2434c5c1b4915833d6384be38fda7cd17046`，范围 11 个文件。
- `node --test test/desktop-compat.test.mjs`：47/47 通过。
- `npm run check`：`REGISTRY_OK`，Catalog 875 条、发现索引 24,171 条，测试 594/594 通过。
- `npm pack --dry-run --json`：`dsh-safe-plugin-manager@0.9.36`，1,076 个文件，图标资源已包含。
- `git diff --check`：通过。
- Source PR exact-head CI：待创建。
- Catalog 0.9.36 独立 pin 与 GitHub Raw、Pages、dsh.store、dsh-store.cn 回读：源码合并后执行。
- 真实 DSH Desktop 安装/视觉验收：未验证，不能由源码测试推断。
