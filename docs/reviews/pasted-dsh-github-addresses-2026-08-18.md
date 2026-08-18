# 粘贴 DSH GitHub 地址审核（2026-08-18）

范围：用户粘贴材料中的 99 个 GitHub 地址。审核采用固定 Commit、完整 Bundle 契约、许可证、入口唯一性、受保护组件与运行路径静态边界门禁。

结果：已收录 19；本次新增上架 19；不收录 61。

新增项目均为 `user-reviewed` 高权限条目：商城仅生成固定 SHA 的本机安装计划，且会展示文件、网络、Shell 与凭据风险；不会静默安装。未执行第三方代码、official DSH 命令或真实 Profile 写入。

| 项目 / 来源 | 固定 Commit | 版本 | 热门 | 有用 | 有趣 | 结论与证据 |
|---|---|---:|---:|---:|---:|---|
| [@1e0zj/dsh-plugin-mall](https://github.com/1e0zj/dsh-plugin-mall) | `d1a4b8796adc` | 0.3.1 | — | — | — | 不收录：profile-mutation-signal、critical-supply-chain-signal |
| [chicheng-cron](https://github.com/534119219/chicheng-cron) | `31a8627ebf9a` | 0.1.1 | 4.4 | 8 | 8 | 上架；★2 / Fork 0 / 最近推送 2026-08-16 |
| [无有效包](https://github.com/534119219/dsh-messaging) | `f1c3399ef40e` | — | — | — | — | 不收录：manifest-http-404 |
| [dsh-vision-web](https://github.com/54xkeee/dsh-vision) | `f8b26198aff8` | 0.1.0 | — | — | — | 不收录：main-http-404 |
| [dsh-youreyes](https://github.com/54xkeee/dsh-youreyes) | `86f02fa124cd` | 0.1.0 | — | — | — | 不收录：main-http-404 |
| [@a9i5k4/dsh-auto-memory](https://github.com/Aik358/dsh-auto-memory) | `f1d90a907ec0` | 0.1.26 | — | — | — | 不收录：profile-mutation-signal |
| [@anionex/dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) | `29850a83871d` | 0.1.7 | — | — | — | 已在 catalog，不重复上架 |
| [dsh-theme-plugin](https://github.com/BeiZi6/dsh-theme-plugin) | `b3e7e143532c` | 0.1.0 | — | — | — | 不收录：package-already-cataloged |
| [dsh-remote](https://github.com/Blank-not-black/dsh-Remote) | `dba811f4440f` | 0.6.0 | — | — | — | 不收录：license-missing-or-unlicensed、manifest-repository-not-canonical-match、bundle-patch-contract-invalid、bundle-entry-id-missing、runtime-main-missing |
| [dsh-remote-link](https://github.com/BotonJ/dsh-remote-link) | `b282cb91de5a` | 0.1.0 | — | — | — | 不收录：manifest-repository-not-canonical-match |
| [无有效包](https://github.com/Ceelog/dsh-plugins/tree/main/src/plugins/dsh-plugin-setting-mcp) | — | — | — | — | — | 不收录：transport:TypeError |
| [dsh-free-search](https://github.com/DDDMUC/dsh-free-search) | `7c093e6d59b8` | 0.4.6 | 7.7 | 8 | 8 | 上架；★17 / Fork 2 / 最近推送 2026-08-18 / Release v0.4.6 |
| [dshmarketplace-plugin](https://github.com/DshMarketPlace/dsh-plugins-store) | `a771a77e22a9` | 0.1.4 | — | — | — | 不收录：main-http-404 |
| [@dsh-community/plugin-panel](https://github.com/Dylan37670/dsh-plugin-panel) | `c7875a6b869f` | 0.6.13 | — | — | — | 不收录：profile-mutation-signal |
| [dsh-free-vision](https://github.com/FuzzySoul/dsh-free-vision) | `ac9052d6c18b` | 1.0.7 | — | — | — | 不收录：install-lifecycle-script |
| [dsh-plugin-deepseek-vision](https://github.com/GOU-GEE/deepseek-vision/tree/main/plugins/dsh-plugin-deepseek-vision) | `b524d6aedf7b` | 0.4.1 | — | — | — | 已在 catalog，不重复上架 |
| [@dsh-cowork/chatnode-wechat](https://github.com/Jesse-njx/dsh-chatnode-wechat) | `a724da34b5c7` | 0.1.0 | — | — | — | 不收录：lifecycle-requires-disposable-install-evidence |
| [@dsh-memory/bundle](https://github.com/Jesse-njx/dsh-memory) | `2eed97da7f95` | 0.1.0 | — | — | — | 不收录：catalog-entry-id-collision、main-http-404 |
| [dsh-plugin-manager](https://github.com/Jesse-njx/dsh-plugin-manager) | `2da969ab638d` | 0.1.0 | — | — | — | 不收录：manifest-repository-not-canonical-match、bundle-patch-contract-invalid、bundle-entry-id-missing、license-file-missing、runtime-main-missing |
| [@dsh-routines/bundle](https://github.com/Jesse-njx/dsh-routines) | `f59b4f03e7b3` | 0.1.0 | 3.9 | 9 | 6 | 上架；★1 / Fork 0 / 最近推送 2026-08-13 |
| [dsh-image-gen](https://github.com/LeemanCheung/dsh-image-gen) | `88c74323a5a0` | 0.2.0 | 4.4 | 8 | 8 | 上架；★2 / Fork 0 / 最近推送 2026-08-16 / Release v0.2.0 |
| [dsh-task-dag](https://github.com/LeemanCheung/dsh-task-dag) | `256cfdab272e` | 1.2.0 | 5.3 | 8 | 8 | 上架；★5 / Fork 0 / 最近推送 2026-08-15 / Release v1.1.0 |
| [dsh-agent-conductor](https://github.com/MJorgin/dsh-agent-conductor) | `f954ae7f368e` | 0.2.0 | — | — | — | 不收录：manifest-repository-not-canonical-match |
| [dsh-themes](https://github.com/MangMax/dsh-themes) | `85fe103cc279` | 0.1.8 | — | — | — | 不收录：manifest-repository-not-canonical-match、main-http-404 |
| [@max-null/dsh-plugin-center](https://github.com/Max-Null/dsh-plugin-center) | `ebc3c0d2cd72` | 0.1.5 | 3.9 | 8 | 6 | 上架；★1 / Fork 0 / 最近推送 2026-08-17 |
| [@michengai/dsh-automation](https://github.com/MichengAI/dsh-automation) | `482a5cf9ccd0` | 0.1.5 | — | — | — | 已在 catalog，不重复上架 |
| [@michengai/dsh-im-connect](https://github.com/MichengAI/dsh-im-connect) | `b38c8df6db2c` | 0.1.10 | — | — | — | 不收录：main-http-404 |
| [dsh-llm-codex](https://github.com/NOirBRight/dsh-llm-codex) | `816e994e4bfa` | 0.2.0 | 3 | 8 | 8 | 上架；★0 / Fork 0 / 最近推送 2026-08-18 / Release v0.1.1 |
| [dsh-llm-grok](https://github.com/NOirBRight/dsh-llm-grok) | `964d0871ce51` | 0.2.0 | 4 | 8 | 8 | 上架；★0 / Fork 2 / 最近推送 2026-08-18 / Release v0.1.2 |
| [@nonamelego/dsh-catppuccin](https://github.com/NoNameLeGo/dsh-catppuccin-theme) | `46134262e180` | 0.2.7 | — | — | — | 不收录：lifecycle-requires-disposable-install-evidence |
| [@deepseek-ai/dsh-plugin-console](https://github.com/Noob-stupid/dsh-plugin-hub) | `f35258c59cc9` | 0.1.0-rc.6 | — | — | — | 已在 catalog，不重复上架 |
| [@dsh-feishu/dsh-feishu](https://github.com/PGZXB/dsh-feishu) | `f99de8f3bd79` | 0.2.0 | — | — | — | 不收录：manifest-repository-not-canonical-match、main-http-404 |
| [dsh-background-agents](https://github.com/PerryLink/dsh-background-agents) | `2c9436f5b8a7` | 0.5.2 | — | — | — | 不收录：catalog-entry-id-collision |
| [dsh-memento](https://github.com/PerryLink/dsh-memento) | `ad3d7d791e13` | 0.4.0 | 8.3 | 8 | 6 | 上架；★57 / Fork 0 / 最近推送 2026-08-18 / Release v0.4.0 |
| [无有效包](https://github.com/Relistencode/dsh-extension-hub) | — | — | — | — | — | 不收录：固定源证据不足 |
| [无有效包](https://github.com/RevolutionLA/dsh-dream-skin) | — | — | — | — | — | 不收录：transport:TypeError |
| [dsh-tavily](https://github.com/SZMY-haruhi/dsh-tavily) | `bc6609963814` | 0.3.1 | — | — | — | 已在 catalog，不重复上架 |
| [@sanqi-normal/dsh-webui-market-plugin](https://github.com/Sanqi-normal/dsh-webui-market-plugin) | `0a09c21bae41` | 0.5.2 | — | — | — | 已在 catalog，不重复上架 |
| [dsh-whale-musume](https://github.com/Sutera-Diffusus/dsh-whale-musume) | `032ff113d751` | 1.4.1 | 7.7 | 8 | 6 | 上架；★17 / Fork 2 / 最近推送 2026-08-18 / Release v1.4.1 |
| [@tonydua/dsh-web-search-exa](https://github.com/TonyDua/dsh-web-search-exa) | `083706bae60a` | 0.1.3 | 6.5 | 8 | 8 | 上架；★6 / Fork 2 / 最近推送 2026-08-14 |
| [dsh-pilot](https://github.com/Viger1/dsh-pilot) | `65340d67a4de` | 0.1.1 | — | — | — | 已在 catalog，不重复上架 |
| [dsh-preview](https://github.com/Viger1/dsh-preview) | `ac08fa218b90` | 0.1.1 | — | — | — | 已在 catalog，不重复上架 |
| [@wnjxyk/dsh-codex-oauth](https://github.com/WNJXYK/dsh-codex-oauth) | `06bc69cea6e9` | 0.4.2 | — | — | — | 已在 catalog，不重复上架 |
| [dsh-codex-subscription](https://github.com/WSL043/dsh-codex-subscription) | `b5d19ee0fafd` | 1.0.0 | — | — | — | 已在 catalog，不重复上架 |
| [dsh-auth-tunnel](https://github.com/ai-eks/dsh-auth-tunnel) | `e4793a1a153d` | 0.1.0-rc.6 | — | — | — | 不收录：official-component-disable |
| [@anweat/dsh-browser](https://github.com/anweat/dsh-browser) | `570ac8b54bd1` | 0.1.3 | — | — | — | 不收录：catalog-entry-id-collision |
| [dsh-web-search-pro](https://github.com/anweat/dsh-web-search-pro) | `f8f388c75d11` | 0.1.2 | — | — | — | 不收录：catalog-entry-id-collision |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | `08f067d8355f` | 0.1.0 | — | — | — | 不收录：bundle-patch-contract-invalid、bundle-entry-id-missing、runtime-main-missing |
| [dsh-find-plugin](https://github.com/awesome-dsh-plugin/dsh-find-plugin) | `e75dc2e865c3` | 0.3.6 | 8.9 | 8 | 6 | 上架；★56 / Fork 1 / 最近推送 2026-08-14 |
| [dsh-omni-bridge](https://github.com/baisama-cloud/dsh-omni-bridge) | `cdb51787173b` | 0.2.0 | 3.9 | 8 | 6 | 上架；★1 / Fork 0 / 最近推送 2026-08-17 / Release v0.2.0 |
| [dsh-plugin-marketplace](https://github.com/bradeGithub/DSH-Plugins-Marketplace) | `38be45297055` | 1.5.3 | — | — | — | 不收录：profile-mutation-signal、critical-supply-chain-signal |
| [dsh-mobile](https://github.com/cindyguyuehu123/dsh-mobile) | `33415c77045c` | 0.1.0 | 5.1 | 8 | 8 | 上架；★4 / Fork 0 / 最近推送 2026-08-15 |
| [@dickpy/dsh-imagegen](https://github.com/dickpy/dsh-imagegen) | `3cb80565dcd0` | 1.0.7 | — | — | — | 不收录：main-http-404 |
| [dshmarket](https://github.com/dsh-market/dsh-market) | `beb8576cebc4` | 1.7.0 | — | — | — | 已在 catalog，不重复上架 |
| [dsh-plugin-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) | `965b12de27fe` | 0.1.5 | — | — | — | 不收录：license-file-missing |
| [dsh-taskswarm](https://github.com/february2015/dsh-taskswarm) | `032e2c9d228c` | 0.2.38 | — | — | — | 不收录：lifecycle-requires-disposable-install-evidence |
| [dsh-codex-connect](https://github.com/franksong2702/dsh-codex-connect) | `ed7eaf2da664` | 0.1.0-alpha.4.10 | — | — | — | 已在 catalog，不重复上架 |
| [dsh-mobile-remote](https://github.com/good-boy4069/dsh-mobile-remote) | `f0ce76aeac09` | 0.1.0 | 3 | 8 | 8 | 上架；★0 / Fork 0 / 最近推送 2026-08-16 |
| [dsh-pilot](https://github.com/guo6x/dsh-pilot) | `9103a2d6ef20` | 0.4.1 | — | — | — | 不收录：package-already-cataloged、catalog-entry-id-collision |
| [@hellosz/dsh-pets](https://github.com/hellosz/dsh-pets) | `bae5bab8ca71` | 0.3.1 | — | — | — | 已在 catalog，不重复上架 |
| [dsh-knowledge-base](https://github.com/htcqp802/dsh-knowledge-base) | `c084a21afe28` | 0.1.5 | — | — | — | 已在 catalog，不重复上架 |
| [dsh-store](https://github.com/huguangyu666/dsh-store) | `1f7c63c4e168` | 0.5.2 | — | — | — | 不收录：main-http-404 |
| [dsh-team](https://github.com/huxint/dsh-team) | `59706e16c37a` | 0.2.3 | — | — | — | 不收录：manifest-repository-not-canonical-match |
| [dsh-everything-oauth](https://github.com/kam74515-boop/dsh-everything-oauth) | `fe7b691f52bc` | 0.1.0 | — | — | — | 不收录：lifecycle-requires-disposable-install-evidence |
| [dsh-claude-cli](https://github.com/katsos/dsh-claude-cli) | `3a3a57f22a3e` | 0.1.0 | — | — | — | 不收录：manifest-repository-not-canonical-match |
| [dsh-plugin-market](https://github.com/kimiya1010/dsh-plugin-market) | `200decd5ed84` | 0.1.0 | — | — | — | 不收录：license-file-missing |
| [dsh-plugin-subhub](https://github.com/kinoward/dsh-plugin-subhub) | `92d578d73480` | 1.0.0 | — | — | — | 不收录：manifest-repository-not-canonical-match |
| [dsh-remote](https://github.com/liguobao/deepseek-harness-remote) | `ff6fb3e58a42` | 0.3.5 | — | — | — | 不收录：manifest-repository-not-canonical-match、license-file-missing |
| [无有效包](https://github.com/lninghaha/dsh-coding-subscription-oauth) | — | — | — | — | — | 不收录：transport:TimeoutError |
| [dsh-workshop](https://github.com/loguhan/dsh-workshop) | `cf36f61f7081` | 0.1.0 | — | — | — | 不收录：lifecycle-requires-disposable-install-evidence |
| [dsh-memory-palace](https://github.com/lovezi0/dsh-memory-palace) | `7f59740e9c76` | 1.1.4 | — | — | — | 不收录：manifest-repository-not-canonical-match |
| [dsh-self-improved](https://github.com/madage/dsh-self-improved) | `4f134c9a93db` | 0.1.1 | — | — | — | 不收录：manifest-repository-not-canonical-match |
| [@memorylake/dsh-plugin](https://github.com/memorylake-ai/memorylake-harness/tree/main/dsh-plugin) | `30e7c661dd8c` | 0.1.0 | — | — | — | 不收录：runtime-main-missing |
| [dsh-plugin-market](https://github.com/nanshan1995/DSH-Plugin-Market) | `cb79579df4f4` | 1.2.4 | — | — | — | 不收录：profile-mutation-signal |
| [nowledge-mem-deepseek-harness](https://github.com/nowledge-co/nowledge-mem-deepseek-harness) | `b75629b10823` | 0.1.2 | — | — | — | 不收录：license-file-missing |
| [@dsh-external/dsh-deep-research](https://github.com/omdsh-dev/dsh-deep-research) | `c0b329e02cd0` | 0.1.0 | — | — | — | 不收录：manifest-repository-not-canonical-match |
| [dsh-lark-channel](https://github.com/omdsh-dev/dsh-lark) | `bffc7306d087` | 0.0.6 | — | — | — | 不收录：catalog-entry-id-collision |
| [dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon) | `ade5a7b395f2` | 0.1.4 | — | — | — | 已在 catalog，不重复上架 |
| [dsh-searxng](https://github.com/rogerdigital/dsh-searxng) | `c071ff26737b` | 0.1.1 | — | — | — | 不收录：main-http-404 |
| [dsh-vision-subagent](https://github.com/ruby1304/dsh-vision-subagent) | `0e55e84bde9d` | 0.3.1 | — | — | — | 不收录：main-http-404 |
| [dsh-plugin-wallpaper-engine](https://github.com/ruijiaang-lab/dsh-wallpaper-engine) | `1646b3568a5f` | 0.1.6 | — | — | — | 不收录：manifest-repository-not-canonical-match、license-file-missing |
| [dsh-desktop-pet](https://github.com/sereinmono/dsh-desktop-pet) | `d35e0981b373` | 0.1.0 | — | — | — | 不收录：manifest-repository-not-canonical-match、license-file-missing、main-http-404 |
| [dsh-pocket](https://github.com/shaobeichen/dsh-pocket) | `d0ff1f2b812c` | 1.4.8 | — | — | — | 已在 catalog，不重复上架 |
| [dsh-chatgpt-subscription](https://github.com/songoao25/dsh-chatgpt-subscription) | `317d54153795` | 0.1.0 | 4.4 | 8 | 6 | 上架；★2 / Fork 0 / 最近推送 2026-08-16 / Release v0.1.0 |
| [@springbrand/dsh-plugin-marketplace](https://github.com/springbrand-lab/dsh-plugin-market) | `183527a7c700` | 1.0.8 | — | — | — | 不收录：main-http-404 |
| [dsh-agent-team-gui](https://github.com/toolclub/dsh-agent-team-gui) | `bd2a04bee712` | 0.5.0 | — | — | — | 不收录：lifecycle-requires-disposable-install-evidence |
| [dsh-dingtalk-channel](https://github.com/ttmouse/dsh-dingtalk-channel) | `49a9152340a1` | 0.1.0 | — | — | — | 已在 catalog，不重复上架 |
| [@openviking/dsh-memory-plugin](https://github.com/volcengine/OpenViking/tree/main/examples/dsh-memory-plugin) | `e3c8e56fea81` | 0.1.0 | — | — | — | 不收录：source-transport:TimeoutError |
| [dsh-weixin](https://github.com/wendayuan/dsh-weixin) | `02e9ab2da91a` | 0.1.0 | — | — | — | 不收录：manifest-repository-not-canonical-match |
| [dsh-builtin-browser](https://github.com/wqty123/dsh-browser) | `9ffe5d6c0d78` | 0.1.15 | — | — | — | 已在 catalog，不重复上架 |
| [dsh-weixin](https://github.com/xiaoshihou514/dsh-weixin) | `5c4880ea037a` | 0.1.0 | — | — | — | 不收录：lifecycle-requires-disposable-install-evidence |
| [dsh-draw-router](https://github.com/xiaozhe7772222/dsh-draw-router) | `4da1e76a4178` | 0.1.0 | 5.4 | 8 | 8 | 上架；★2 / Fork 2 / 最近推送 2026-08-15 |
| [@xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) | `7b369187f80b` | 0.7.2 | — | — | — | 已在 catalog，不重复上架 |
| [dsh-vision-router](https://github.com/ysr666/dsh-vision-router) | `30d890e7b964` | 1.6.1 | — | — | — | 不收录：protected-entry-shadow、profile-mutation-signal |
| [@ysyyhhh/dsh-pet](https://github.com/ysyyhhh/dsh-pet) | `a17346b9c41e` | 0.3.0 | — | — | — | 不收录：manifest-repository-not-canonical-match |
| [@dsh-external/dsh-plugin-workshop](https://github.com/yyyyukari/dsh-plugin-workshop) | `f53a7e466948` | 1.6.2 | — | — | — | 不收录：manifest-repository-not-canonical-match |
| [无有效包](https://github.com/zdx8637-gitdog/dshmobile) | `392db5f37970` | — | — | — | — | 不收录：manifest-http-404 |
| [dsh-subscribe](https://github.com/zoahdev/dsh-subscribe/tree/main/plugin) | `dadfb28660cb` | 0.3.1 | 3.9 | 8 | 8 | 上架；★1 / Fork 0 / 最近推送 2026-08-18 / Release v0.3.1 |
| [dsh-mobile-pwa](https://github.com/zylzyqzz/dsh-mobile-pwa) | `258607721a76` | 0.1.0 | 3.6 | 8 | 8 | 上架；★0 / Fork 1 / 最近推送 2026-08-15 |
