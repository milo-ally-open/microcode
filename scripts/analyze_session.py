#!/usr/bin/env python3
"""Create an English Matplotlib activity chart from a Microcode session JSONL."""

from __future__ import annotations

import argparse
from collections import defaultdict, deque
from datetime import datetime
import json
from pathlib import Path
import re
import sys
from typing import Any, Iterable


def parse_timestamp(value: Any) -> float | None:
    """Return seconds since epoch for millisecond epochs or ISO timestamps."""
    if isinstance(value, (int, float)):
        return value / 1000 if value > 10_000_000_000 else float(value)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def read_records(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]], list[str]]:
    """Read v4 transaction JSONL and legacy v3 records without loading message bodies into the report."""
    warnings: list[str] = []
    records: list[dict[str, Any]] = []
    try:
        stream = path.open("r", encoding="utf-8")
    except OSError as error:
        raise ValueError(f"Cannot open {path}: {error}") from error

    with stream:
        first = stream.readline()
        if not first:
            raise ValueError("The input file is empty.")
        try:
            header = json.loads(first)
        except json.JSONDecodeError as error:
            raise ValueError(f"Invalid JSONL header on line 1: {error.msg}") from error
        if not isinstance(header, dict) or not (
            (header.get("kind") == "header" and header.get("v") == 4)
            or (header.get("type") == "session" and header.get("version") == 3)
        ):
            raise ValueError("Unsupported session header; expected Microcode JSONL v4 or legacy v3.")

        for line_number, line in enumerate(stream, start=2):
            if not line.strip():
                continue
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError as error:
                if not line.endswith("\n"):
                    warnings.append(f"Ignored incomplete final record on line {line_number}.")
                    break
                raise ValueError(f"Invalid JSON on line {line_number}: {error.msg}") from error
            writes = parsed if isinstance(parsed, list) else [parsed]
            for record in writes:
                if isinstance(record, dict):
                    records.append(record)
                else:
                    warnings.append(f"Ignored non-object record on line {line_number}.")
            if not line.endswith("\n"):
                warnings.append(f"Final record on line {line_number} has no trailing newline.")
                break
    return header, records, warnings


def extract_message(record: dict[str, Any]) -> tuple[dict[str, Any], int | None] | None:
    """Normalize v4 entries, v3 message entries, and raw serialized Agent messages."""
    if record.get("kind") == "entry" and record.get("type") == "message":
        message = record.get("message")
        if isinstance(message, dict):
            return message, record.get("seq") if isinstance(record.get("seq"), int) else None
    if record.get("type") == "message" and isinstance(record.get("message"), dict):
        return record["message"], record.get("seq") if isinstance(record.get("seq"), int) else None
    if record.get("role") in {"user", "assistant", "toolResult"}:
        return record, record.get("seq") if isinstance(record.get("seq"), int) else None
    return None


def format_time(timestamp: float | None) -> str:
    if timestamp is None:
        return "—"
    return datetime.fromtimestamp(timestamp).astimezone().strftime("%Y-%m-%d %H:%M:%S")


def format_duration(seconds: float | None) -> str:
    if seconds is None or seconds < 0:
        return "—"
    if seconds < 1:
        return f"{seconds * 1000:.0f} ms"
    if seconds < 60:
        return f"{seconds:.1f} s"
    minutes, remainder = divmod(int(seconds), 60)
    return f"{minutes}m {remainder}s"


def analyze(header: dict[str, Any], records: Iterable[dict[str, Any]]) -> dict[str, Any]:
    calls: list[dict[str, Any]] = []
    calls_by_id: dict[str, deque[int]] = defaultdict(deque)
    events: list[dict[str, Any]] = []
    role_counts: dict[str, int] = defaultdict(int)
    model_names: set[str] = set()
    compactions = 0
    entry_count = 0

    for record in records:
        if record.get("kind") == "entry":
            entry_count += 1
            if record.get("type") == "compaction":
                compactions += 1
                stamp = parse_timestamp(record.get("timestamp"))
                events.append({"seq": record.get("seq"), "time": stamp, "kind": "compaction", "label": "Context compacted"})
            elif record.get("type") == "custom" and record.get("customType") == "microcode.compaction-checkpoint":
                compactions += 1
                stamp = parse_timestamp(record.get("timestamp"))
                events.append({"seq": record.get("seq"), "time": stamp, "kind": "compaction", "label": "Context compacted"})

        normalized = extract_message(record)
        if normalized is None:
            continue
        message, sequence = normalized
        role = message.get("role", "other")
        role_counts[role] += 1
        # Agent-message timestamps reflect response/tool completion; the storage
        # entry timestamp only reflects when the append was persisted.
        stamp = parse_timestamp(message.get("timestamp")) or parse_timestamp(record.get("timestamp"))

        if role == "user":
            events.append({"seq": sequence, "time": stamp, "kind": "user", "label": "User message"})
        elif role == "assistant":
            provider = message.get("provider")
            model = message.get("model")
            if provider or model:
                model_names.add("/".join(str(value) for value in (provider, model) if value))
            blocks = message.get("content", [])
            tool_blocks = [block for block in blocks if isinstance(block, dict) and block.get("type") == "toolCall"] if isinstance(blocks, list) else []
            if tool_blocks:
                for block in tool_blocks:
                    tool_name = str(block.get("name") or "(unknown tool)")
                    call_id = block.get("id")
                    call = {
                        "id": str(call_id) if call_id is not None else None,
                        "tool": tool_name,
                        "time": stamp,
                        "seq": sequence,
                        "status": "pending",
                        "duration": None,
                    }
                    call_index = len(calls)
                    calls.append(call)
                    if call["id"]:
                        calls_by_id[call["id"]].append(call_index)
                    events.append({"seq": sequence, "time": stamp, "kind": "call", "label": f"Call {tool_name}"})
            else:
                events.append({"seq": sequence, "time": stamp, "kind": "assistant", "label": "Assistant response"})
        elif role == "toolResult":
            call_id = message.get("toolCallId")
            tool_name = str(message.get("toolName") or "(unknown tool)")
            matching = calls_by_id.get(str(call_id), deque()) if call_id is not None else deque()
            if matching:
                call = calls[matching.popleft()]
                call["tool"] = tool_name if tool_name != "(unknown tool)" else call["tool"]
                call["status"] = "failed" if message.get("isError") is True else "success" if message.get("isError") is False else "unknown"
                call["duration"] = stamp - call["time"] if stamp is not None and call["time"] is not None else None
            events.append({
                "seq": sequence,
                "time": stamp,
                "kind": "tool_failed" if message.get("isError") is True else "tool_success" if message.get("isError") is False else "tool_unknown",
                "label": f"Result {tool_name}",
            })
        else:
            events.append({"seq": sequence, "time": stamp, "kind": "other", "label": f"{role} record"})

    tool_stats: dict[str, dict[str, Any]] = defaultdict(lambda: {"calls": 0, "success": 0, "failed": 0, "pending": 0, "unknown": 0, "durations": []})
    for call in calls:
        stat = tool_stats[call["tool"]]
        stat["calls"] += 1
        stat[call["status"]] += 1
        if call["duration"] is not None and call["duration"] >= 0:
            stat["durations"].append(call["duration"])

    for stat in tool_stats.values():
        known = stat["success"] + stat["failed"]
        stat["rate"] = stat["success"] / known * 100 if known else None
        stat["average_duration"] = sum(stat["durations"]) / len(stat["durations"]) if stat["durations"] else None

    timestamps = [event["time"] for event in events if event["time"] is not None]
    successes = sum(call["status"] == "success" for call in calls)
    failures = sum(call["status"] == "failed" for call in calls)
    known_results = successes + failures
    return {
        "header": header,
        "entries": entry_count,
        "messages": dict(role_counts),
        "calls": calls,
        "tool_stats": dict(sorted(tool_stats.items(), key=lambda item: (-item[1]["calls"], item[0].lower()))),
        "events": events,
        "models": sorted(model_names),
        "compactions": compactions,
        "successes": successes,
        "failures": failures,
        "success_rate": successes / known_results * 100 if known_results else None,
        "unresolved": sum(call["status"] == "pending" for call in calls),
        "unknown": sum(call["status"] == "unknown" for call in calls),
        "start": min(timestamps) if timestamps else parse_timestamp(header.get("createdAt") or header.get("timestamp")),
        "end": max(timestamps) if timestamps else None,
    }


def render_chart(result: dict[str, Any], source: Path, output: Path, warnings: list[str]) -> None:
    """Render an English-language PNG using Matplotlib's non-interactive backend."""
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib.patches import Patch
    except ImportError as error:
        raise ValueError("Matplotlib is required. Install it with: python3 -m pip install matplotlib") from error

    plt.rcParams["text.parse_math"] = False
    background, panel, foreground, muted = "#10151d", "#171f2a", "#e7edf5", "#9aa9bb"
    colors = {
        "success": "#47c78a", "failed": "#fa6b73", "pending": "#e8b85e", "unknown": "#8694a8",
        "user": "#69aaf8", "assistant": "#b89cff", "call": "#4ecbd1", "tool_success": "#47c78a",
        "tool_failed": "#fa6b73", "tool_unknown": "#8694a8", "compaction": "#e8b85e", "other": "#8694a8",
    }
    header = result["header"]
    session_id = str(header.get("id") or source.stem)
    duration = result["end"] - result["start"] if result["end"] is not None and result["start"] is not None else None
    message_count = sum(result["messages"].values())
    rate_text = f'{result["success_rate"]:.1f}%' if result["success_rate"] is not None else "n/a"
    model_text = ", ".join(result["models"]) or "model metadata unavailable"

    fig = plt.figure(figsize=(15, 10), facecolor=background)
    grid = fig.add_gridspec(2, 2, left=0.08, right=0.97, top=0.74, bottom=0.12, hspace=0.38, wspace=0.26)
    fig.text(0.08, 0.955, "Agent Session Activity", color=foreground, fontsize=22, fontweight="bold")
    fig.text(0.08, 0.918, f"Session {session_id}  |  {model_text}", color=muted, fontsize=10)
    metrics = [
        ("TOOL CALLS", str(len(result["calls"]))),
        ("SUCCESS RATE", rate_text),
        ("FAILED / UNRESOLVED", f'{result["failures"]} / {result["unresolved"]}'),
        ("MESSAGES / DURATION", f'{message_count} / {format_duration(duration)}'),
    ]
    for index, (label, value) in enumerate(metrics):
        x = 0.08 + index * 0.225
        fig.text(x, 0.865, label, color=muted, fontsize=9, fontweight="bold")
        fig.text(x, 0.825, value, color=foreground, fontsize=15, fontweight="bold")

    ax_outcomes = fig.add_subplot(grid[0, 0], facecolor=panel)
    ax_timeline = fig.add_subplot(grid[0, 1], facecolor=panel)
    ax_duration = fig.add_subplot(grid[1, :], facecolor=panel)
    axes = (ax_outcomes, ax_timeline, ax_duration)
    for axis in axes:
        axis.tick_params(colors=muted, labelsize=9)
        for spine in axis.spines.values():
            spine.set_color("#2b3848")
        axis.xaxis.label.set_color(muted)
        axis.yaxis.label.set_color(muted)
        axis.title.set_color(foreground)
        axis.grid(axis="x", color="#2b3848", linewidth=0.6, alpha=0.75)
        axis.set_axisbelow(True)

    tool_stats = list(result["tool_stats"].items())[:14]
    ax_outcomes.set_title("Tool Call Outcomes", loc="left", pad=12, fontsize=13, fontweight="bold", color=foreground)
    if tool_stats:
        names = [name if stat["rate"] is None else f'{name}  ({stat["rate"]:.0f}%)' for name, stat in tool_stats]
        y_positions = list(range(len(tool_stats)))
        left = [0.0] * len(tool_stats)
        for status in ("success", "failed", "pending", "unknown"):
            values = [stat[status] for _, stat in tool_stats]
            ax_outcomes.barh(y_positions, values, left=left, color=colors[status], label=status.title(), height=0.66)
            left = [previous + value for previous, value in zip(left, values)]
        ax_outcomes.set_yticks(y_positions, names)
        ax_outcomes.invert_yaxis()
        ax_outcomes.set_xlabel("Calls")
        ax_outcomes.legend(handles=[Patch(color=colors[key], label=key.title()) for key in ("success", "failed", "pending", "unknown")],
                           loc="lower right", frameon=False, labelcolor=muted, fontsize=8, ncol=2)
    else:
        ax_outcomes.text(0.5, 0.5, "No tool calls", color=muted, ha="center", va="center", transform=ax_outcomes.transAxes)
        ax_outcomes.set_xticks([])
        ax_outcomes.set_yticks([])

    timeline_title = "Activity Timeline"
    events = result["events"]
    selected = events[-500:]
    if len(events) > len(selected):
        timeline_title += f" (most recent {len(selected)} of {len(events)})"
    ax_timeline.set_title(timeline_title, loc="left", pad=12, fontsize=13, fontweight="bold", color=foreground)
    lanes = [("user", "User"), ("assistant", "Assistant"), ("call", "Tool call"),
             ("tool_success", "Tool success"), ("tool_failed", "Tool failed"),
             ("tool_unknown", "Tool result"), ("compaction", "Compaction"), ("other", "Other")]
    lane_y = {key: len(lanes) - index - 1 for index, (key, _) in enumerate(lanes)}
    ax_timeline.set_yticks([lane_y[key] for key, _ in lanes], [label for _, label in lanes])
    if selected:
        known_times = [event["time"] for event in selected]
        use_time = all(value is not None for value in known_times) and max(known_times) > min(known_times)
        xs = [((event["time"] - min(known_times)) / 60) if use_time else index for index, event in enumerate(selected)]
        for event, x_value in zip(selected, xs):
            kind = event["kind"] if event["kind"] in lane_y else "other"
            ax_timeline.scatter(x_value, lane_y[kind], color=colors[kind], s=22, alpha=0.9, linewidths=0)
        ax_timeline.set_xlabel("Elapsed time (minutes)" if use_time else "Event order")
    else:
        ax_timeline.text(0.5, 0.5, "No activity events", color=muted, ha="center", va="center", transform=ax_timeline.transAxes)
        ax_timeline.set_xticks([])

    ax_duration.set_title("Average Call-to-Result Delay (Approx.)", loc="left", pad=12, fontsize=13, fontweight="bold", color=foreground)
    duration_stats = [(name, stat["average_duration"]) for name, stat in result["tool_stats"].items() if stat["average_duration"] is not None]
    if duration_stats:
        duration_stats = duration_stats[:20]
        names = [name for name, _ in duration_stats]
        values = [seconds * 1000 for _, seconds in duration_stats]
        ax_duration.barh(names, values, color="#4ecbd1", height=0.62)
        ax_duration.invert_yaxis()
        ax_duration.set_xlabel("Milliseconds")
        for index, value in enumerate(values):
            ax_duration.text(value, index, f"  {format_duration(value / 1000)}", va="center", color=foreground, fontsize=8)
    else:
        ax_duration.text(0.5, 0.5, "No paired call/result timestamps available", color=muted,
                         ha="center", va="center", transform=ax_duration.transAxes)
        ax_duration.set_xticks([])
        ax_duration.set_yticks([])

    fig.text(0.08, 0.055, "Success rate excludes unresolved and unknown outcomes. Timing is message-to-message approximation, not isolated tool runtime.",
             color=muted, fontsize=8)
    if warnings:
        fig.text(0.08, 0.035, f"Parser notes: {len(warnings)}", color="#e8b85e", fontsize=8)
    output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output, dpi=160, facecolor=background, bbox_inches="tight")
    plt.close(fig)


def safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._-")
    return cleaned[:120] or "session"


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze an exported Microcode session JSONL and create an English Matplotlib chart.")
    parser.add_argument("session_jsonl", type=Path, help="Exported Microcode session JSONL file")
    parser.add_argument("-o", "--output", type=Path, help="Chart image path (default: .microcode/analysis/session-<id>.png)")
    args = parser.parse_args()

    try:
        source = args.session_jsonl.expanduser().resolve(strict=True)
        header, records, warnings = read_records(source)
        result = analyze(header, records)
        session_id = str(header.get("id") or source.stem)
        output = args.output.expanduser() if args.output else Path.cwd() / ".microcode" / "analysis" / f"session-{safe_filename(session_id)}.png"
        output = output.resolve()
        render_chart(result, source, output, warnings)
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    print(f"Report written to {output}")
    print(f"Tool calls: {len(result['calls'])}; success rate: " + (f"{result['success_rate']:.1f}%" if result["success_rate"] is not None else "n/a"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
