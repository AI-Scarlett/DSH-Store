# DSH 0.1.1-rc.1 兼容性迁移（2026-08-21）

## 结论

- 可信 Catalog 保持 400 个条目，没有把候选发现库直接升级为可安装插件。
- 新增无歧义兼容键 `0.1.1-rc.1`，同时保留 rc.5、rc.6、rc.7、rc.8 历史键。
- `0.1.1-rc.1` 结果为：274 compatible、117 unknown、9 incompatible。
- 排序改为上架状态、`0.1.1-rc.1` 兼容性、固定来源更新时间、推荐、安装量和版本。
- `dsh-wecom-cli` 继续保持 `unlisted`，不会回到公开商城。

## 保守迁移规则

1. 只有旧 rc.8 已显式标记 compatible，且声明范围包含 `0.1.1-rc.1`，才迁移为 compatible。
2. 声明范围明确排除 `0.1.1-rc.1` 时标记 incompatible。
3. 范围缺失、不可解析、旧 rc.8 为 unknown，或缺少足够证据时保持 unknown。
4. 版本范围只影响 `dshReleases`；install、start、uninstall、rollback 默认全部 unknown，不能由范围推导。

## 明确不兼容的 9 个条目

- `dsh-image-theme`
- `dsh-pdf`
- `dsh-weather`
- `dsh-promotion-toolkit`
- `dsh-plugin-agent-workflow`
- `dsh-image2-draw`
- `dsh-native-playbook`
- `dsh-btw`
- `dsh-context-provenance`

## 证据边界

本迁移证明 Catalog schema、解析、排序和静态显示能够表达 DSH `0.1.1-rc.1`，不证明 400 个插件都完成了真实运行验收。没有一次性 Profile 证据的操作矩阵保持 unknown。DSH-Store 与 Build DSH Plugin 另行执行一次性 Profile 安装、启动和卸载验证；真实 Profile、公开 GitHub 固定提交与公开商城回读仍是独立验收门。
