# 国内 AI/搜索爬虫周度抓取监控简报模板

> 用途：记录 DSH.Store 国际站公开日志中可观察到的国内 AI/搜索代理访问。每周人工复核后归档；不得把日志访问、robots 放行、搜索收录和 AI 引用混为同一结论。

## 1. 台账信息

| 字段 | 填写内容 |
| --- | --- |
| 统计周期 | `YYYY-MM-DD` 至 `YYYY-MM-DD` |
| 站点 | `https://dsh.store/` |
| 日志来源 | Nginx/Apache 文件名与导出时间 |
| 分析命令 | `python3 scripts/analyze-ai-crawler-logs.py --input <access.log> --output <report.md> --json-output <report.json> --period <period>` |
| 分析人 | 待填写 |
| 复核人 | 待填写 |
| 生成时间 | 待填写 |
| 数据状态 | 基线 / 可比复测 / 不可判定 |

## 2. 代理汇总

运行脚本后粘贴 Markdown 报告中的“代理汇总”表。10 个固定识别名为：

`Bytespider`、`KimiBot`、`Kimi-User`、`Kimi-SearchBot`、`DeepSeekBot`、`YuanBaoBot`、`ChatGLM-Spider`、`MiniMaxBot`、`PetalBot`、`Baiduspider`。

必须同时记录请求数、HTTP 200 数量、HTTP 200 比例、其他状态码和主要受访路径；没有匹配请求写“尚无数据”，不能写成“未抓取”或“已拒绝”。

## 3. 异常复核

| 时间/窗口 | 代理 | 路径 | 状态码 | 初步原因 | 复核证据 | 处置状态 |
| --- | --- | --- | ---: | --- | --- | --- |
| 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 源站/WAF/反代日志链接或摘要 | 待复核 |

## 4. 与 GEO 的分开记录

- robots.txt 公开可访问：待填写（HTTP 状态、读取时间、响应哈希）。
- 服务器日志观察到代理请求：待填写（仅以脚本聚合结果为准）。
- 搜索引擎收录：待填写；没有 Search Console、Bing、百度站长平台读回时写“尚无数据”。
- AI 消费端提及/引用：待填写；必须记录平台、入口、地区、语言、联网模式、时间、原始问题、原始回答和引用 URL。
- 本周结论：只描述可观察事实，不宣称排名提升、模型引用提升或“已完成 GEO”。

## 5. 合规与留档检查

- [ ] 原始日志留在受控位置，报告未包含客户端 IP、原始日志行或 URL 查询字符串。
- [ ] 10 个代理名称按本仓库 robots.txt 逐一核对。
- [ ] 非 200 响应已人工核查，未擅自修改 WAF/防火墙白名单。
- [ ] 首次运行已标记为“基线”；没有两个同条件时间点不写环比涨跌。
- [ ] 报告由责任人和复核人手动确认；`manual_publish_only=true`。
