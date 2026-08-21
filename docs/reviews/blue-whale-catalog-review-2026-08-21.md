# Blue Whale DSH 候选固定源审核（2026-08-21）

> 本文保留批量准入时的 rc.8 快照。当前 `0.1.1-rc.1` 兼容迁移与新排序见
> [DSH 0.1.1-rc.1 兼容性迁移](dsh-0.1.1-rc.1-compatibility-2026-08-21.md)。

## 结论

- 发现来源：`leenkcool/Blue-Whale-Harness` 固定提交 `ee0f3167f213144680f1b80be8cd30fe6353c8aa`。
- 输入记录：1,408；实时 canonical 身份去重后：1,394 个仓库（合并 14 个改名/别名）。
- 通过：139 个仓库、147 个标准 Bundle 包；Catalog 从 253 增至 400。
- 未通过：1,255 个仓库；全部只进入不可安装 Candidate Registry。连同既有 `dsh-ios` 决定，Candidate 总数为 1,256。
- 全量 rc.8 矩阵：274 compatible、119 unknown、7 incompatible；Catalog 物理顺序与运行时排序均为状态、rc.8 兼容性、来源更新时间。
- `dsh-wecom-cli` 保持 `unlisted`，不进入公开搜索与推荐。

## 证据边界

- 每个通过条目均回读公开 GitHub 固定 40 位 Commit、manifest、Bundle Patch、许可证、声明入口和运行产物。
- 本批量审核没有执行一次性 Profile 安装或 rc.8 冷启动，因此 installability、runtime 和 securityReview 均保持 `unknown`。
- `automated-scan` 仅表示固定源静态契约审核，不等于独立安全审计；所有新增条目使用 `user-reviewed` 更新策略。
- 未修改 DSH 核心、`@deepseek-ai/*`、官方插件清单、真实 Profile 或 `~/.dsh`。

## 明确拒绝示例

- `evanfang0054/dsh-tailscale-console`：运行时代码包含远程 `curl ... install.sh | sh` 下载执行路径。
- `agentic-control-plane/dsh-acp-plugin`：Patch 插入包名未由 manifest 或依赖声明。
- `HongzhongL/dsh-hotswap`：调用动态插件管理/Loader 能力，越过安全商城的事务边界。
- 其他直接修改 Profile/Loader、覆盖官方入口、使用保留命名空间、来源或许可证不可验证的项目均拒绝上架。

## 未通过路由

| 路由 | 仓库数 | 含义 |
| --- | ---: | --- |
| blocked | 749 | 固定源存在硬冲突、安全边界或契约失败 |
| monorepo-review | 30 | 固定源树或多包范围无法在本次有界扫描内完整证明 |
| adapter-required | 477 | 没有可直接安装的标准 DSH Bundle |

## 主要拒绝信号（源记录，可重叠）

| 信号 | 次数 |
| --- | ---: |
| 未发现无歧义的标准 DSH Bundle | 483 |
| manifest repository 与 canonical GitHub 不一致 | 427 |
| 生命周期脚本缺少一次性安装证据 | 209 |
| package 标记为 private | 106 |
| 缺少许可证文件 | 103 |
| 命中受保护官方组件信号 | 85 |
| Bundle Patch 契约无效 | 72 |
| 声明的 Bundle Patch 缺失 | 64 |
| Bundle 插入 entry ID 缺失 | 64 |
| 固定提交缺少声明的运行产物 | 60 |
| entry ID 与现有 Catalog 冲突 | 55 |
| Patch 修改既有顶层 entry | 41 |
| 许可证缺失或不可确认 | 33 |
| 使用保留的 @deepseek-ai 命名空间 | 30 |
| 固定源扫描未完整覆盖 | 22 |

## 通过条目

| Catalog ID | 固定仓库与包路径 | 版本 | Commit | rc.8 | 权限等级 |
| --- | --- | --- | --- | --- | --- |
| `dsh-context-provenance` | [030611/dsh-context-provenance](https://github.com/030611/dsh-context-provenance) · `package.json` | `0.1.0` | `e32793dbf07c` | incompatible | high |
| `dsh-plugin-greet` | [0lidaxiang/dsh-plugin-greet](https://github.com/0lidaxiang/dsh-plugin-greet) · `package.json` | `0.2.0` | `825ec518c594` | unknown | unknown |
| `dsh-scrape-webpage` | [131CDA1/dsh-scrape-webpage](https://github.com/131CDA1/dsh-scrape-webpage) · `package.json` | `1.0.0` | `7485af10c063` | unknown | high |
| `dsh-git-graph` | [1841220388zzzcccxxx-star/dsh-git-graph](https://github.com/1841220388zzzcccxxx-star/dsh-git-graph) · `package.json` | `0.11.0` | `2dc485e72e32` | unknown | high |
| `dsh-paddleocr-skills` | [Aidenwu0209/dsh-PaddleOCR-Skills](https://github.com/Aidenwu0209/dsh-PaddleOCR-Skills) · `package.json` | `0.1.1` | `15c692ae2ecf` | compatible | high |
| `dsh-unlimited-ocr-skill` | [Aidenwu0209/dsh-Unlimited-OCR-Skill](https://github.com/Aidenwu0209/dsh-Unlimited-OCR-Skill) · `package.json` | `0.2.0` | `cb2bbddd0b72` | compatible | high |
| `dsh-godot-skill` | [akira399/dsh-godot-skill](https://github.com/akira399/dsh-godot-skill) · `package.json` | `1.0.0` | `393cec166392` | unknown | high |
| `embedded-workbench` | [AmethystLuna/embedded-workbench](https://github.com/AmethystLuna/embedded-workbench) · `package.json` | `0.7.1` | `9728f9a5ca83` | unknown | high |
| `logicprobe` | [AmethystLuna/logicprobe](https://github.com/AmethystLuna/logicprobe) · `package.json` | `0.3.0` | `75a2848f6610` | unknown | medium |
| `dsh-eye-care` | [Anionex/dsh-eye-care](https://github.com/Anionex/dsh-eye-care) · `package.json` | `0.1.0` | `4f87acff0013` | compatible | high |
| `dsh-suggested-replies` | [Anionex/dsh-suggested-replies](https://github.com/Anionex/dsh-suggested-replies) · `package.json` | `0.1.0` | `eb7e41b82ae8` | compatible | high |
| `dsh-wordbox` | [arcmosin/dsh-wordbox](https://github.com/arcmosin/dsh-wordbox) · `package.json` | `0.1.0` | `747a6ef921e3` | unknown | unknown |
| `dsh-zh-hant-hk` | [Argonaut790/dsh-zh-hant-hk](https://github.com/Argonaut790/dsh-zh-hant-hk) · `package.json` | `0.1.6` | `e5d7948a108f` | unknown | high |
| `dsh-conversation-cost` | [Ayaka157/dsh-conversation-cost](https://github.com/Ayaka157/dsh-conversation-cost) · `package.json` | `0.1.0` | `768428d227b6` | unknown | unknown |
| `design-playbook` | [Bandersnatch0x/design-playbook](https://github.com/Bandersnatch0x/design-playbook) · `packages/design-playbook/package.json` | `0.20.2` | `52edcb23380e` | unknown | medium |
| `dsh-web-billing` | [bpc-oss/dsh-web-billing](https://github.com/bpc-oss/dsh-web-billing) · `package.json` | `2.3.2` | `d1a9412156f1` | compatible | high |
| `dsh-quota-panel` | [brittanistrehlowll-oss/dsh-quota-panel](https://github.com/brittanistrehlowll-oss/dsh-quota-panel) · `package.json` | `0.3.0` | `18cfc7f5b52b` | unknown | high |
| `dsh-toy` | [c3ll256/dsh-toy](https://github.com/c3ll256/dsh-toy) · `package.json` | `0.2.0` | `adece3467506` | compatible | high |
| `dsh-llm-kiro` | [caopu16/dsh-llm-kiro](https://github.com/caopu16/dsh-llm-kiro) · `package.json` | `0.1.0` | `f3f71e75d03d` | compatible | high |
| `dsh-client-ui-skin-aurora` | [CAPTAIN1275/dsh-ui-web](https://github.com/CAPTAIN1275/dsh-ui-web) · `packages/dsh-skins/skins/aurora/package.json` | `0.2.8` | `4a275b080cb6` | unknown | high |
| `dsh-client-ui-skin-miku` | [CAPTAIN1275/dsh-ui-web](https://github.com/CAPTAIN1275/dsh-ui-web) · `packages/dsh-skins/skins/miku/package.json` | `0.2.8` | `4a275b080cb6` | unknown | unknown |
| `dsh-client-ui-skin-minecraft` | [CAPTAIN1275/dsh-ui-web](https://github.com/CAPTAIN1275/dsh-ui-web) · `packages/dsh-skins/skins/minecraft/package.json` | `0.2.8` | `4a275b080cb6` | unknown | unknown |
| `dsh-client-ui-skin-ths` | [CAPTAIN1275/dsh-ui-web](https://github.com/CAPTAIN1275/dsh-ui-web) · `packages/dsh-skins/skins/ths/package.json` | `0.2.8` | `4a275b080cb6` | unknown | unknown |
| `dsh-client-ui-skin-trading` | [CAPTAIN1275/dsh-ui-web](https://github.com/CAPTAIN1275/dsh-ui-web) · `packages/dsh-skins/skins/trading/package.json` | `0.2.8` | `4a275b080cb6` | unknown | medium |
| `dsh-client-ui-skin-xp` | [CAPTAIN1275/dsh-ui-web](https://github.com/CAPTAIN1275/dsh-ui-web) · `packages/dsh-skins/skins/xp/package.json` | `0.2.8` | `4a275b080cb6` | unknown | unknown |
| `dsh-usage-dashboard` | [CAPTAIN1275/dsh-ui-web](https://github.com/CAPTAIN1275/dsh-ui-web) · `packages/dsh-usage-dashboard/package.json` | `0.2.7` | `4a275b080cb6` | compatible | high |
| `dsh-image-theme` | [Carpon39038/dsh-image-theme](https://github.com/Carpon39038/dsh-image-theme) · `package.json` | `0.1.0` | `d522281fcdf8` | unknown | high |
| `dsh-image-to-path` | [cesaryike/dsh-image-to-path](https://github.com/cesaryike/dsh-image-to-path) · `package.json` | `0.1.1` | `ec937c3bff4d` | compatible | high |
| `dsh-harness-mcp-server` | [chushixixin/dsh-harness-mcp-server](https://github.com/chushixixin/dsh-harness-mcp-server) · `package.json` | `0.1.10` | `d174cea870aa` | unknown | medium |
| `dsh-claude-auto-memory` | [cnzgray/dsh-plugins](https://github.com/cnzgray/dsh-plugins) · `packages/claude-auto-memory/package.json` | `0.1.1` | `6e58c156a694` | unknown | high |
| `dsh-claude-marketplace-bridge` | [cnzgray/dsh-plugins](https://github.com/cnzgray/dsh-plugins) · `packages/claude-marketplace-bridge/package.json` | `0.1.0` | `6e58c156a694` | unknown | medium |
| `dsh-claude-rules-bridge` | [cnzgray/dsh-plugins](https://github.com/cnzgray/dsh-plugins) · `packages/claude-rules-bridge/package.json` | `0.1.0` | `6e58c156a694` | unknown | high |
| `dsh-superpowers` | [codeAnqiang-ma/dsh-superpowers](https://github.com/codeAnqiang-ma/dsh-superpowers) · `package.json` | `0.1.0` | `9511c7b961fa` | unknown | high |
| `dsh-session-management` | [cokiscarazo-rgb/dsh-session-management](https://github.com/cokiscarazo-rgb/dsh-session-management) · `package.json` | `1.0.6` | `c29f78f30b7e` | unknown | medium |
| `dsh` | [ConradLu2740/pa-dsh](https://github.com/ConradLu2740/pa-dsh) · `packages/dsh/package.json` | `0.3.0` | `86c7e364924f` | unknown | unknown |
| `dsh-landscape` | [cyanseek/dsh-landscape](https://github.com/cyanseek/dsh-landscape) · `package.json` | `0.3.0` | `e03414c9e934` | unknown | high |
| `dsh-native-playbook` | [cyanseek/dsh-native-playbook](https://github.com/cyanseek/dsh-native-playbook) · `package.json` | `0.2.1` | `994465be9fff` | incompatible | high |
| `dsh-beacons` | [Da-Mie/dsh-beacons](https://github.com/Da-Mie/dsh-beacons) · `package.json` | `0.2.0` | `ca5abe1eb748` | compatible | high |
| `dsh-web-open` | [dawsondx/dsh-web-open](https://github.com/dawsondx/dsh-web-open) · `package.json` | `0.1.2` | `89cf7af04ff8` | unknown | high |
| `dsh-humanizer` | [DEEP-IOS/dsh-humanizer](https://github.com/DEEP-IOS/dsh-humanizer) · `package.json` | `0.3.0-rc.1` | `e956599769fe` | compatible | medium |
| `dsh-openapi` | [Degurechaff57/dsh-openapi](https://github.com/Degurechaff57/dsh-openapi) · `package.json` | `0.1.0` | `fb854355b89e` | compatible | high |
| `dsh-2origin` | [dongsheng123132/dsh-2origin](https://github.com/dongsheng123132/dsh-2origin) · `package.json` | `0.2.0` | `f2d0b362611b` | unknown | high |
| `dsh-action-parity` | [dongsheng123132/dsh-action-parity](https://github.com/dongsheng123132/dsh-action-parity) · `package.json` | `0.2.0` | `33eb4e6cab58` | unknown | high |
| `dsh-audit-bundle` | [dongsheng123132/dsh-audit-bundle](https://github.com/dongsheng123132/dsh-audit-bundle) · `package.json` | `0.2.0` | `e69b94060bca` | unknown | high |
| `dsh-benchmark` | [dongsheng123132/dsh-benchmark](https://github.com/dongsheng123132/dsh-benchmark) · `package.json` | `0.2.0` | `3c2eedee2ee3` | unknown | high |
| `dsh-cache-stabilizer` | [dongsheng123132/dsh-cache-stabilizer](https://github.com/dongsheng123132/dsh-cache-stabilizer) · `package.json` | `0.1.0` | `0ea2f599d0c3` | unknown | unknown |
| `dsh-cad-review` | [dongsheng123132/dsh-cad-review](https://github.com/dongsheng123132/dsh-cad-review) · `package.json` | `0.2.0` | `b2ecef56a9c0` | unknown | high |
| `dsh-capability-receipt` | [dongsheng123132/dsh-capability-receipt](https://github.com/dongsheng123132/dsh-capability-receipt) · `package.json` | `0.3.0` | `53fe2a117909` | unknown | high |
| `dsh-cost` | [dongsheng123132/dsh-cost](https://github.com/dongsheng123132/dsh-cost) · `package.json` | `0.2.0` | `849d81509b33` | unknown | high |
| `dsh-lineage` | [dongsheng123132/dsh-lineage](https://github.com/dongsheng123132/dsh-lineage) · `package.json` | `0.2.0` | `bb9932ef5c25` | unknown | high |
| `dsh-narrative-ledger` | [dongsheng123132/dsh-narrative-ledger](https://github.com/dongsheng123132/dsh-narrative-ledger) · `package.json` | `0.2.0` | `21851f7f0b7f` | unknown | high |
| `dsh-policy-drift-proof` | [dongsheng123132/dsh-policy-drift-proof](https://github.com/dongsheng123132/dsh-policy-drift-proof) · `package.json` | `0.2.0` | `3d9c66f23dd9` | unknown | high |
| `dsh-recovery-proof` | [dongsheng123132/dsh-recovery-proof](https://github.com/dongsheng123132/dsh-recovery-proof) · `package.json` | `0.2.0` | `7ecd2bc72663` | unknown | high |
| `dsh-release-proof` | [dongsheng123132/dsh-release-proof](https://github.com/dongsheng123132/dsh-release-proof) · `package.json` | `0.2.0` | `67b233ae7207` | unknown | high |
| `dsh-surface-contract-proof` | [dongsheng123132/dsh-surface-contract-proof](https://github.com/dongsheng123132/dsh-surface-contract-proof) · `package.json` | `0.2.0` | `a959e3877062` | unknown | high |
| `dsh-switch` | [dongsheng123132/dsh-switch](https://github.com/dongsheng123132/dsh-switch) · `package.json` | `0.1.0` | `b37a63cae265` | unknown | high |
| `dsh-windows-readiness-proof` | [dongsheng123132/dsh-windows-readiness-proof](https://github.com/dongsheng123132/dsh-windows-readiness-proof) · `package.json` | `0.1.1` | `291151da48ac` | unknown | high |
| `dsh-xiapan-media` | [dongsheng123132/dsh-xiapan-media](https://github.com/dongsheng123132/dsh-xiapan-media) · `package.json` | `0.1.0` | `ee2f51f4f50b` | unknown | high |
| `dsh-skillx` | [drowned-fish1/deepseek-harness-skillx](https://github.com/drowned-fish1/deepseek-harness-skillx) · `package.json` | `0.1.0` | `baf8d166e27b` | unknown | medium |
| `dsh-moyan` | [elviszhang007/dsh-moyan](https://github.com/elviszhang007/dsh-moyan) · `package.json` | `0.5.3` | `da5389836a5b` | unknown | medium |
| `dsh-outdoor-theme` | [Estellalee/dsh-outdoor-theme](https://github.com/Estellalee/dsh-outdoor-theme) · `package.json` | `2.0.0` | `236e5426f9a8` | compatible | high |
| `deepseek-harness-wallet` | [feibi-mochi/deepseek-harness-control-center](https://github.com/feibi-mochi/deepseek-harness-control-center) · `package.json` | `0.2.2` | `9cc3bef27dcc` | unknown | high |
| `dsh-session-cleaner` | [fountunt/dsh-session-cleaner](https://github.com/fountunt/dsh-session-cleaner) · `package.json` | `1.0.2` | `f12ef7bad873` | unknown | medium |
| `dsh-sight` | [Fu3rte/dsh-sight](https://github.com/Fu3rte/dsh-sight) · `package.json` | `0.3.1` | `ed49f0888a96` | compatible | high |
| `dsh-livis-connector` | [fyy99/dsh-livis-connector](https://github.com/fyy99/dsh-livis-connector) · `package.json` | `0.1.0` | `40df2eb3b774` | unknown | high |
| `dsh-task-console` | [He2way/dsh-task-console](https://github.com/He2way/dsh-task-console) · `package.json` | `0.1.0` | `a3f130852db0` | unknown | medium |
| `dsh-gadgets` | [Highjobop/dsh-gadgets](https://github.com/Highjobop/dsh-gadgets) · `dsh-gadgets/package.json` | `0.4.1` | `a307f3b99301` | unknown | unknown |
| `dsh-client-ui-mobile-adapt` | [Hotsteel2901/dsh-client-ui-mobile-adapt](https://github.com/Hotsteel2901/dsh-client-ui-mobile-adapt) · `package.json` | `0.1.0` | `0fa5276a36dd` | compatible | unknown |
| `dsh-codex-provider` | [Hu9956/dsh-codex-provider](https://github.com/Hu9956/dsh-codex-provider) · `package.json` | `0.1.0` | `15d8c9ecadbf` | compatible | high |
| `dsh-better-archive` | [huahai0202/dsh-better-archive](https://github.com/huahai0202/dsh-better-archive) · `package.json` | `0.3.1` | `fa31fc486d35` | unknown | medium |
| `dsh-her-eyes` | [huashenglian/dsh-her-eyes](https://github.com/huashenglian/dsh-her-eyes) · `package.json` | `1.2.0` | `73799bf935ac` | unknown | high |
| `dsh-api-usage-bar` | [hurry060215-tech/dsh-api-usage-bar](https://github.com/hurry060215-tech/dsh-api-usage-bar) · `package.json` | `0.1.1` | `b7e2b54dae8d` | compatible | high |
| `dsh-mcp-manager` | [hyqhyq3/dsh-mcp-manager](https://github.com/hyqhyq3/dsh-mcp-manager) · `package.json` | `0.6.0` | `69d5cbc76e21` | unknown | high |
| `dsh-mimo-vision-hint` | [Isekai-Mfu/dsh-mimo-vision-hint](https://github.com/Isekai-Mfu/dsh-mimo-vision-hint) · `package.json` | `0.3.1` | `b851a236ae83` | unknown | unknown |
| `dsh-btw` | [iyllyt/dsh-btw](https://github.com/iyllyt/dsh-btw) · `package.json` | `0.2.0` | `0ca9db4bfd86` | incompatible | high |
| `dsh-commandcode-go-provider` | [jiesou/dsh-commandcode-go-provider](https://github.com/jiesou/dsh-commandcode-go-provider) · `package.json` | `0.1.5` | `d48ad4179ace` | compatible | high |
| `dsh-stream-rules` | [jiesou/dsh-stream-rules](https://github.com/jiesou/dsh-stream-rules) · `package.json` | `0.1.7` | `e0178c043c58` | compatible | medium |
| `dsh-survey` | [jinhuang712/dsh-survey](https://github.com/jinhuang712/dsh-survey) · `package.json` | `1.1.2` | `463d9de102f4` | compatible | medium |
| `dsh-image2-draw` | [JuneLearn/dsh-image2-draw](https://github.com/JuneLearn/dsh-image2-draw) · `package.json` | `0.1.0` | `78972d05d604` | incompatible | high |
| `dsh-image-bridge` | [kbpoyo/dsh-image-bridge](https://github.com/kbpoyo/dsh-image-bridge) · `package.json` | `0.1.0` | `6c4d6e2dbda4` | compatible | unknown |
| `dsh-codebuddy` | [Lbryany/dsh-codebuddy](https://github.com/Lbryany/dsh-codebuddy) · `package.json` | `0.1.1` | `e8495e0c37c0` | compatible | high |
| `dsh-multimedia-webui-input` | [LCYLYM/dsh-attachments](https://github.com/LCYLYM/dsh-attachments) · `package.json` | `0.1.0` | `028dc1f8dc9c` | unknown | high |
| `dsh-promotion-toolkit` | [lhmd/dsh-promotion-toolkit](https://github.com/lhmd/dsh-promotion-toolkit) · `package.json` | `0.1.0` | `c4e19742d439` | unknown | high |
| `dsh-provider-model-configurator` | [LiangYin233/dsh-provider-model-configurator](https://github.com/LiangYin233/dsh-provider-model-configurator) · `package.json` | `0.3.9` | `70f88112c7d9` | unknown | high |
| `dsh-vision-provider` | [libinyam/dsh-vision-provider](https://github.com/libinyam/dsh-vision-provider) · `package.json` | `0.3.3` | `c4c76c2a2a69` | unknown | high |
| `dsh-billing-glass` | [linkingoscar/dsh-billing-glass](https://github.com/linkingoscar/dsh-billing-glass) · `package.json` | `0.2.0` | `7a5b6a60e674` | unknown | high |
| `dsh-balance` | [linshule/dsh-balance](https://github.com/linshule/dsh-balance) · `package.json` | `0.3.0` | `fab2ea528ee4` | unknown | high |
| `dsh-plugin-mermaid` | [lj970926/dsh-plugin-mermaid](https://github.com/lj970926/dsh-plugin-mermaid) · `package.json` | `0.1.0` | `73d08a87f163` | unknown | unknown |
| `dsh-open-in-ide` | [LJninse/dsh-open-in-ide](https://github.com/LJninse/dsh-open-in-ide) · `package.json` | `0.5.2` | `e03f9dc62a6f` | unknown | medium |
| `dsh-plugin-dedup` | [lordship12138-crypto/dsh-plugin-dedup](https://github.com/lordship12138-crypto/dsh-plugin-dedup) · `package.json` | `0.1.0` | `211055668e43` | compatible | unknown |
| `dsh-task-notify` | [ltao0829/dsh-task-notify](https://github.com/ltao0829/dsh-task-notify) · `package.json` | `0.1.0` | `8771ac7c56ec` | compatible | high |
| `dsh-background` | [luoyu-xingu/dsh-background](https://github.com/luoyu-xingu/dsh-background) · `package.json` | `0.2.9` | `14980c518e7a` | compatible | medium |
| `dsh-session-stars` | [malevrigns/dsh-session-stars](https://github.com/malevrigns/dsh-session-stars) · `package.json` | `0.1.0` | `ec0fcf3ba911` | compatible | high |
| `dsh-theme-pack` | [math-lrz/dsh-theme-pack](https://github.com/math-lrz/dsh-theme-pack) · `package.json` | `1.0.0` | `5a4cdbe9e6ac` | unknown | high |
| `dsh-tokensaver` | [Miku196/dsh-tokensave](https://github.com/Miku196/dsh-tokensave) · `package.json` | `0.2.0` | `50a8973a3b8e` | unknown | high |
| `dsh-git-branch-switcher` | [mixin-ai/dsh-git-branch-switcher](https://github.com/mixin-ai/dsh-git-branch-switcher) · `package.json` | `0.1.0` | `e8ec829fca75` | compatible | unknown |
| `dsh-docs-panel` | [mlosun/dsh-docs-panel](https://github.com/mlosun/dsh-docs-panel) · `package.json` | `0.1.0` | `a2ab2da5627e` | unknown | medium |
| `dsh-ui-quote-selection` | [nekogpt/dsh-ui-quote-selection](https://github.com/nekogpt/dsh-ui-quote-selection) · `package.json` | `0.1.0` | `728d16234d59` | unknown | unknown |
| `dsh-billing` | [nianpangzhi233/dsh-billing](https://github.com/nianpangzhi233/dsh-billing) · `package.json` | `0.1.0` | `88b0dc0851de` | compatible | high |
| `dsh-view-modes` | [NigelYao/dsh-view-modes](https://github.com/NigelYao/dsh-view-modes) · `package.json` | `1.0.0` | `a57d237e03b6` | unknown | unknown |
| `dsh-plugin-jinji` | [quan2005/dsh-plugin-jinji](https://github.com/quan2005/dsh-plugin-jinji) · `package.json` | `0.6.0` | `c3a6d0d9dee4` | unknown | high |
| `dsh-client-ui-trajectory-categories` | [QWQ-nn/dsh-client-ui-trajectory-categories](https://github.com/QWQ-nn/dsh-client-ui-trajectory-categories) · `package.json` | `0.2.1` | `652f159b6087` | unknown | medium |
| `dsh-balance-monitor` | [Rainronin/dsh-balance-monitor](https://github.com/Rainronin/dsh-balance-monitor) · `package.json` | `0.2.1` | `46f8f7d0579b` | compatible | high |
| `dsh-mermaid-preview` | [realguan/dsh-mermaid-preview](https://github.com/realguan/dsh-mermaid-preview) · `package.json` | `0.2.1` | `a1bfa69c17d9` | unknown | high |
| `dsh-launcher-lifetime` | [Ruler4396/dsh-launcher-lifetime](https://github.com/Ruler4396/dsh-launcher-lifetime) · `package.json` | `0.2.1` | `6bb13b55ef0d` | unknown | high |
| `dsh-browser-desktop` | [runzhliu/deepseek-harness-docker](https://github.com/runzhliu/deepseek-harness-docker) · `plugins/dsh-browser-desktop/package.json` | `0.1.0` | `77cf78a699cf` | compatible | medium |
| `dsh-soul-md` | [Scorp1o117/dsh-soul-md](https://github.com/Scorp1o117/dsh-soul-md) · `package.json` | `0.5.5` | `976283737d47` | compatible | high |
| `dsh-tdai-memory` | [Scorp1o117/dsh-tdai-memory](https://github.com/Scorp1o117/dsh-tdai-memory) · `package.json` | `0.2.10` | `e6bf395f9b9b` | compatible | high |
| `dsh-youmind-plugin` | [seamas0825-lab/dsh-youmind-plugin](https://github.com/seamas0825-lab/dsh-youmind-plugin) · `package.json` | `0.1.1` | `d70df4302679` | unknown | high |
| `dsh-plugin` | [securstack/securstack-dsh-plugin](https://github.com/securstack/securstack-dsh-plugin) · `package.json` | `0.1.2` | `234fe4847a85` | compatible | high |
| `dsh-notify-windows` | [SeverusZh/dsh-notify-windows](https://github.com/SeverusZh/dsh-notify-windows) · `package.json` | `0.7.0` | `b18733a70db4` | unknown | high |
| `dsh-plugin-product-subagents` | [shaokeyibb/dsh-plugin-product-subagents](https://github.com/shaokeyibb/dsh-plugin-product-subagents) · `package.json` | `0.3.1` | `9149aaa8b7b9` | compatible | high |
| `dsh-utility-tools` | [sharkymew/dsh-utility-tools](https://github.com/sharkymew/dsh-utility-tools) · `package.json` | `1.0.5` | `d8ee3a77aed2` | unknown | medium |
| `dsh-plugin-wepre` | [shujiTech/dsh-plugin-wepre](https://github.com/shujiTech/dsh-plugin-wepre) · `package.json` | `0.1.0` | `4b95dca5fa6e` | unknown | high |
| `dsh-turn-index` | [Simon314620/dsh-turn-index](https://github.com/Simon314620/dsh-turn-index) · `package.json` | `0.1.1` | `a324ecde201a` | unknown | medium |
| `dsh-translator` | [SiYue-ZO/dsh-translator](https://github.com/SiYue-ZO/dsh-translator) · `package.json` | `0.2.0` | `7ab238541380` | unknown | medium |
| `dsh-advisor` | [slhssb/dsh-advisor](https://github.com/slhssb/dsh-advisor) · `package.json` | `0.2.0` | `a27fbbfcbd3c` | compatible | high |
| `deepseek-harness-qqbot` | [sliverp/DeepSeek-harness-qqbot](https://github.com/sliverp/DeepSeek-harness-qqbot) · `package.json` | `0.1.5` | `691af8ca2ffc` | compatible | high |
| `deepseek-harness-wecom` | [sliverp/DeepSeek-harness-wecom](https://github.com/sliverp/DeepSeek-harness-wecom) · `package.json` | `0.1.5` | `e241355f081c` | compatible | high |
| `ds-vision-plugin` | [Sorwcyra/ds-vision-plugin](https://github.com/Sorwcyra/ds-vision-plugin) · `package.json` | `0.4.1` | `55967fad750f` | compatible | high |
| `dsh-pdf` | [sunshine-lang/dsh-pdf](https://github.com/sunshine-lang/dsh-pdf) · `package.json` | `0.1.0` | `bfb4231ab6ca` | unknown | medium |
| `dsh-weather` | [sunshine-lang/dsh-weather](https://github.com/sunshine-lang/dsh-weather) · `package.json` | `0.1.0` | `9f85d87ac584` | unknown | medium |
| `dsh-message-navigator` | [TableRogue/dsh-message-navigator](https://github.com/TableRogue/dsh-message-navigator) · `package.json` | `0.1.0` | `7233842936a6` | unknown | unknown |
| `dsh-vision` | [Terry12138qy/dsh-vision](https://github.com/Terry12138qy/dsh-vision) · `package.json` | `0.1.0` | `a9bbce894547` | unknown | high |
| `dsh-commit-review` | [the-qian/dsh-commit-review](https://github.com/the-qian/dsh-commit-review) · `package.json` | `0.1.0` | `40a21f0a1609` | unknown | high |
| `dsh-wanghong-handwritten-ppt` | [tjxj/dsh-wanghong-handwritten-ppt](https://github.com/tjxj/dsh-wanghong-handwritten-ppt) · `package.json` | `0.1.0` | `3968e8b2e46a` | unknown | medium |
| `dsh-netdoctor` | [TYEclipse/dsh-netdoctor](https://github.com/TYEclipse/dsh-netdoctor) · `package.json` | `0.1.0` | `43de786b7268` | unknown | high |
| `dsh-webfetch` | [TYEclipse/dsh-webfetch](https://github.com/TYEclipse/dsh-webfetch) · `package.json` | `0.1.0` | `6296371dd407` | unknown | high |
| `dsh-academic-research` | [userInner/dsh-academic-research](https://github.com/userInner/dsh-academic-research) · `package.json` | `0.1.0` | `41650f0b52c5` | incompatible | high |
| `dsh-plugin-development` | [w2112515/dsh-plugin-development](https://github.com/w2112515/dsh-plugin-development) · `package.json` | `0.2.0-beta.1` | `4dab80cbeb86` | unknown | high |
| `project-change-router-skill` | [WeirdSky924/project-change-router-skill](https://github.com/WeirdSky924/project-change-router-skill) · `package.json` | `0.4.0` | `51d12a8c4dd9` | unknown | medium |
| `dsh-oai-oauth` | [werifu/dsh-oai-oauth](https://github.com/werifu/dsh-oai-oauth) · `package.json` | `0.1.0` | `75a0509a987c` | compatible | high |
| `dsh-deepseek-protocol-doctor` | [Whning0513/deepseek-protocol-doctor](https://github.com/Whning0513/deepseek-protocol-doctor) · `package.json` | `0.1.2` | `43f6df8cbeb4` | incompatible | high |
| `codex-plugin-dsh` | [wingoo/codex-plugin-dsh](https://github.com/wingoo/codex-plugin-dsh) · `package.json` | `0.1.0` | `79fe7503390d` | compatible | high |
| `dsh-ccswitch-importer` | [wtiaw/dsh-ccswitch-importer](https://github.com/wtiaw/dsh-ccswitch-importer) · `package.json` | `0.1.2` | `bbb3e58c9bba` | compatible | high |
| `dsh-portable-tavern` | [XCNXNXNX/dsh-portable-tavern](https://github.com/XCNXNXNX/dsh-portable-tavern) · `package.json` | `0.3.0` | `113199e9b690` | unknown | high |
| `dsh-prompt-persona` | [Xilin3/dsh-prompt-persona](https://github.com/Xilin3/dsh-prompt-persona) · `package.json` | `0.1.0` | `1946101995e8` | unknown | high |
| `dsh-vision-plugin` | [Xin-Zhang-IceMan/dsh-vision-plugin](https://github.com/Xin-Zhang-IceMan/dsh-vision-plugin) · `package.json` | `1.4.0` | `18462b234669` | unknown | high |
| `dsh-side-panel` | [XYZ1024-alt/dsh-side-panel](https://github.com/XYZ1024-alt/dsh-side-panel) · `package.json` | `1.0.0` | `4714c7bf0e04` | unknown | medium |
| `deepseek-prism-dsh` | [YOGEMOW/DeepSeek_Prism](https://github.com/YOGEMOW/DeepSeek_Prism) · `archive/plugin-dsh-zero-patch/package.json` | `0.5.0` | `49bfc89101c6` | compatible | high |
| `dsh-pixel-whale` | [yoke233/dsh-pixel-whale](https://github.com/yoke233/dsh-pixel-whale) · `package.json` | `0.1.0` | `4178e9305461` | compatible | unknown |
| `dsh-eyecare` | [Yummyxl/dsh-eyecare](https://github.com/Yummyxl/dsh-eyecare) · `package.json` | `1.1.0` | `efeb92e1bcfe` | unknown | unknown |
| `dsh-meme` | [yyh-001/dsh-meme](https://github.com/yyh-001/dsh-meme) · `package.json` | `0.1.39` | `cce3fdc5877a` | unknown | high |
| `dsh-voice-mic` | [Zachary7456/dsh-voice-mic](https://github.com/Zachary7456/dsh-voice-mic) · `package.json` | `0.1.0` | `7ccba7da25d0` | compatible | high |
| `allinflash` | [zenx0x/allinluna](https://github.com/zenx0x/allinluna) · `plugins/deepseek-harness/package.json` | `0.2.0` | `723088a7c0d7` | compatible | high |
| `dsh-same-mode-sandbox-noop` | [zhangzujian/dsh-same-mode-sandbox-noop](https://github.com/zhangzujian/dsh-same-mode-sandbox-noop) · `package.json` | `0.1.4` | `d6f43662a5f8` | unknown | high |
| `dsh-subprocess-inherit-environment` | [zhangzujian/dsh-subprocess-inherit-environment](https://github.com/zhangzujian/dsh-subprocess-inherit-environment) · `package.json` | `0.1.1` | `3f4884f3fb5f` | unknown | high |

## 验证门

- Registry schema/duplicate/order checks: required.
- `npm run check`: required before commit.
- `npm run verify:registry-sources`: required before GitHub submission.
- GitHub PR/CI/merge, merged Raw Catalog and GitHub Pages readback: independent publication gates.
- Real DSH Profile: unchanged and unverified for this bulk admission.
