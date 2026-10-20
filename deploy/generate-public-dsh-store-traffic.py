#!/usr/bin/env python3
"""Create a deliberately small, public-safe DSH STORE traffic snapshot."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


BEIJING = timezone(timedelta(hours=8))
MAX_INPUT_BYTES = 8 * 1024 * 1024
MAX_SOURCE_AGE = timedelta(minutes=45)
MAX_CLOCK_SKEW = timedelta(minutes=5)


def parse_timestamp(value: object, name: str) -> datetime:
    if not isinstance(value, str) or len(value) > 64:
        raise ValueError(f"{name} is missing or malformed")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{name} is missing or malformed") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{name} must include a timezone")
    return parsed.astimezone(timezone.utc)


def metric_count(counts: dict, key: str) -> int:
    value = counts.get(key, 0)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{key} must be a non-negative integer")
    return value


def create_public_snapshot(payload: object, *, now: datetime | None = None) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("analytics payload must be an object")
    if (isinstance(payload.get("window_days"), bool)
            or not isinstance(payload.get("window_days"), int)
            or payload["window_days"] < 7):
        raise ValueError("analytics window must cover at least seven days")

    generated_at = parse_timestamp(payload.get("generated_at"), "generated_at")
    reports = payload.get("reports")
    if not isinstance(reports, dict):
        raise ValueError("analytics reports are missing")
    report = reports.get("dsh-store-cn")
    if not isinstance(report, dict) or report.get("key") != "dsh-store-cn":
        raise ValueError("the DSH STORE domestic report is missing")
    source_updated_at = parse_timestamp(report.get("source_generated_at"), "source_generated_at")
    daily = report.get("daily")
    if not isinstance(daily, dict):
        raise ValueError("the daily aggregate is missing")

    reference_now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    fresh = True
    for timestamp in (generated_at, source_updated_at):
        age = reference_now - timestamp
        if age < -MAX_CLOCK_SKEW or age > MAX_SOURCE_AGE:
            fresh = False

    today = generated_at.astimezone(BEIJING).date()
    dates = [today - timedelta(days=offset) for offset in range(6, -1, -1)]
    days = []
    for day in dates:
        counts = daily.get(day.isoformat(), {})
        if not isinstance(counts, dict):
            raise ValueError("a daily aggregate is malformed")
        days.append({
            "date": day.isoformat(),
            "pv": metric_count(counts, "human_pageviews"),
            "uv": metric_count(counts, "human_unique_ips"),
        })

    today_counts = days[-1]
    return {
        "schemaVersion": 1,
        "site": "dsh-store-cn",
        "timeZone": "Asia/Shanghai",
        "generatedAt": generated_at.astimezone(BEIJING).isoformat(timespec="seconds"),
        "sourceUpdatedAt": source_updated_at.astimezone(BEIJING).isoformat(timespec="seconds"),
        "fresh": fresh,
        "today": today_counts,
        "days": days,
    }


def write_atomically(path: Path, value: dict) -> None:
    if not path.parent.is_dir():
        raise ValueError("output directory does not exist")
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n"
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent,
            prefix=f".{path.name}.", suffix=".tmp", delete=False,
        ) as stream:
            temporary_path = Path(stream.name)
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary_path, 0o644)
        os.replace(temporary_path, path)
        temporary_path = None
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.input.resolve() == args.output.resolve():
            raise ValueError("input and output must be different files")
        if args.input.stat().st_size > MAX_INPUT_BYTES:
            raise ValueError("analytics input exceeds the size bound")
        payload = json.loads(args.input.read_text(encoding="utf-8"))
        snapshot = create_public_snapshot(payload)
        write_atomically(args.output, snapshot)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        print(f"public traffic snapshot failed: {type(exc).__name__}", file=sys.stderr)
        return 1
    print(f"public traffic snapshot updated: {'fresh' if snapshot['fresh'] else 'stale'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
