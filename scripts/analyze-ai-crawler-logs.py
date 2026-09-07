#!/usr/bin/env python3
"""Summarize named AI/search crawler requests without retaining client IPs.

The parser accepts common Nginx/Apache combined access-log lines. It only
emits aggregate counts and URL paths, never a raw log line or client address.
This is an analysis helper; it does not alter logs, WAF rules, or allowlists.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


BOT_NAMES = (
    "Bytespider",
    "KimiBot",
    "Kimi-User",
    "Kimi-SearchBot",
    "DeepSeekBot",
    "YuanBaoBot",
    "ChatGLM-Spider",
    "MiniMaxBot",
    "PetalBot",
    "Baiduspider",
)

# Request and status positions are stable in common combined log formats;
# user-agent is captured as the final quoted field.
LOG_RE = re.compile(
    r'^\S+\s+\S+\s+\S+\s+\[[^]]+\]\s+'
    r'"(?P<request>[^"\\]*(?:\\.[^"\\]*)*)"\s+'
    r'(?P<status>\d{3})\b.*\s+"(?P<user_agent>[^"\\]*(?:\\.[^"\\]*)*)"\s*$'
)
REQUEST_RE = re.compile(r"^(?P<method>[A-Z]+)\s+(?P<target>\S+)")


def empty_bot_stats() -> dict[str, object]:
    return {
        "requests": 0,
        "http200": 0,
        "http200Rate": None,
        "statusCounts": {},
        "topPaths": [],
    }


def path_only(target: str) -> str:
    # Query strings can contain credentials or personal data. They are not
    # needed for crawl-health reporting, so discard them before aggregation.
    path = target.split("?", 1)[0].split("#", 1)[0]
    if not path.startswith("/"):
        return "[non-path-target]"
    return path[:512]


def classify(user_agent: str) -> str | None:
    folded = user_agent.casefold()
    for bot in BOT_NAMES:
        if bot.casefold() in folded:
            return bot
    return None


def analyze(lines: list[str]) -> dict[str, object]:
    stats: dict[str, dict[str, object]] = {
        bot: empty_bot_stats() for bot in BOT_NAMES
    }
    malformed = 0
    matched = 0

    for line in lines:
        match = LOG_RE.match(line.rstrip("\n"))
        if not match:
            malformed += 1
            continue
        bot = classify(match.group("user_agent"))
        if bot is None:
            continue
        request = REQUEST_RE.match(match.group("request"))
        if not request:
            malformed += 1
            continue

        matched += 1
        status = match.group("status")
        bot_stats = stats[bot]
        bot_stats["requests"] = int(bot_stats["requests"]) + 1
        if status == "200":
            bot_stats["http200"] = int(bot_stats["http200"]) + 1
        status_counts = Counter(bot_stats["statusCounts"])
        status_counts[status] += 1
        bot_stats["statusCounts"] = dict(sorted(status_counts.items()))
        path_counts = Counter(dict(bot_stats.get("_pathCounts", {})))
        path = path_only(request.group("target"))
        path_counts[path] += 1
        bot_stats["_pathCounts"] = dict(path_counts)

    for bot_stats in stats.values():
        requests = int(bot_stats["requests"])
        bot_stats["http200Rate"] = round(int(bot_stats["http200"]) / requests, 4) if requests else None
        path_counts = Counter(bot_stats.pop("_pathCounts", {}))
        bot_stats["topPaths"] = [
            {"path": path, "requests": count}
            for path, count in path_counts.most_common(10)
        ]

    total_200 = sum(int(value["http200"]) for value in stats.values())
    total = sum(int(value["requests"]) for value in stats.values())
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "anonymization": "client IPs and query strings omitted; raw lines are never emitted",
        "recognizedBots": list(BOT_NAMES),
        "matchedRequests": matched,
        "http200": total_200,
        "http200Rate": round(total_200 / total, 4) if total else None,
        "malformedLines": malformed,
        "bots": stats,
    }


def markdown_report(report: dict[str, object], label: str) -> str:
    bots = report["bots"]
    lines = [
        "# 国内 AI/搜索爬虫周度抓取监控简报",
        "",
        f"- 统计周期：{label}",
        f"- 生成时间：{report['generatedAt']}",
        f"- 命中请求：{report['matchedRequests']}",
        f"- HTTP 200：{report['http200']}（{format_rate(report['http200Rate'])}）",
        f"- 无法解析行：{report['malformedLines']}",
        "- 脱敏边界：不输出客户端 IP、原始日志行或 URL 查询字符串。",
        "",
        "## 代理汇总",
        "",
        "| User-agent | 请求数 | HTTP 200 | HTTP 200 比例 | 状态码 |",
        "| --- | ---: | ---: | ---: | --- |",
    ]
    for bot in report["recognizedBots"]:
        item = bots[bot]
        statuses = ", ".join(f"{key}: {value}" for key, value in item["statusCounts"].items()) or "—"
        lines.append(
            f"| `{bot}` | {item['requests']} | {item['http200']} | "
            f"{format_rate(item['http200Rate'])} | {statuses} |"
        )

    lines.extend(["", "## 受访路径（每个代理最多 10 条）", ""])
    for bot in report["recognizedBots"]:
        item = bots[bot]
        lines.append(f"### `{bot}`")
        if not item["topPaths"]:
            lines.append("- 尚无匹配请求")
        else:
            lines.extend(f"- `{path['path']}`：{path['requests']} 次" for path in item["topPaths"])
    lines.extend([
        "",
        "## 复核结论",
        "",
        "- 本报表只说明访问日志中观察到的请求，不证明 robots 已被某代理读取，也不证明页面已被收录或引用。",
        "- 若出现非 200 响应，先按路径、时间窗口、WAF/反向代理和源站日志进行人工复核。",
        "- 首次运行标记为基线；至少有两个相同口径时间点后，才能描述环比变化。",
        "",
    ])
    return "\n".join(lines)


def format_rate(value: object) -> str:
    return "尚无数据" if value is None else f"{float(value) * 100:.2f}%"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="-", help="access log path, or - for stdin")
    parser.add_argument("--output", help="Markdown report path")
    parser.add_argument("--json-output", help="JSON report path")
    parser.add_argument("--period", default="未填写", help="human-readable reporting period")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.input == "-":
        lines = sys.stdin.readlines()
    else:
        lines = Path(args.input).read_text(encoding="utf-8", errors="replace").splitlines(True)
    report = analyze(lines)
    markdown = markdown_report(report, args.period)
    if args.output:
        Path(args.output).write_text(markdown, encoding="utf-8")
    else:
        sys.stdout.write(markdown)
    if args.json_output:
        Path(args.json_output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
