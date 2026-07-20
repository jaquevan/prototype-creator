#!/usr/bin/env python3
"""
Track run metrics (timing, token usage, cost estimates) across eval runs.
Reads eval-state.yaml for timing, estimates tokens from artifact sizes.

Usage: python3 track-run-metrics.py <artifacts-dir> [--append-to <run-log.json>]
"""

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path


def compute_metrics(artifacts_dir: str) -> dict:
    """Compute run metrics from artifacts."""
    ad = Path(artifacts_dir)
    metrics = {
        "artifacts_dir": str(ad),
        "computed_at": datetime.utcnow().isoformat() + "Z",
    }

    # File inventory
    all_files = []
    total_size = 0
    for f in ad.iterdir():
        if f.is_file():
            size = f.stat().st_size
            all_files.append({"name": f.name, "size": size})
            total_size += size
    
    screenshots_dir = ad / "screenshots"
    screenshot_count = 0
    screenshot_size = 0
    if screenshots_dir.is_dir():
        for f in screenshots_dir.iterdir():
            if f.suffix == ".png":
                screenshot_count += 1
                screenshot_size += f.stat().st_size

    metrics["file_count"] = len(all_files)
    metrics["total_size_bytes"] = total_size
    metrics["total_size_kb"] = round(total_size / 1024)
    metrics["screenshot_count"] = screenshot_count
    metrics["screenshot_size_kb"] = round(screenshot_size / 1024)

    # Timing from eval-state.yaml
    eval_state_path = ad / "eval-state.yaml"
    if eval_state_path.exists():
        state = {}
        for line in eval_state_path.read_text().splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                state[k.strip()] = v.strip()
        
        start = state.get("pipeline_start", "")
        end = state.get("pipeline_end", "")
        if start and end:
            try:
                t0 = datetime.fromisoformat(start.replace("Z", "+00:00"))
                t1 = datetime.fromisoformat(end.replace("Z", "+00:00"))
                metrics["duration_seconds"] = (t1 - t0).total_seconds()
                metrics["duration_minutes"] = round(metrics["duration_seconds"] / 60, 1)
            except:
                pass
        
        metrics["iterations"] = int(state.get("iteration", 0))
        metrics["exit_reason"] = state.get("exit_reason", "unknown")
        metrics["phase"] = state.get("phase", "unknown")

    # Token estimation from text artifact sizes
    text_files = [f for f in all_files if f["name"].endswith((".json", ".csv", ".md", ".yaml", ".txt"))]
    text_size = sum(f["size"] for f in text_files)
    estimated_tokens = text_size // 4  # rough 4 bytes per token
    metrics["text_artifact_size_kb"] = round(text_size / 1024)
    metrics["estimated_output_tokens"] = estimated_tokens

    # Journey/persona counts
    jl_path = ad / "journey-log.json"
    if jl_path.exists():
        try:
            jl = json.loads(jl_path.read_text())
            metrics["journey_count"] = len(jl.get("journeys", []))
            ud = jl.get("usability_dimensions", {})
            metrics["usability_score"] = ud.get("overall_score", "")
            metrics["dimensions_scored"] = len(ud.get("dimensions", []))
        except:
            pass

    pr_path = ad / "persona-results.json"
    if pr_path.exists():
        try:
            pr = json.loads(pr_path.read_text())
            if isinstance(pr, list):
                metrics["persona_task_count"] = len(pr)
                metrics["total_trace_steps"] = sum(len(e.get("trace", [])) for e in pr)
        except:
            pass

    return metrics


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 track-run-metrics.py <artifacts-dir> [--append-to <run-log.json>]")
        sys.exit(1)

    artifacts_dir = sys.argv[1]
    metrics = compute_metrics(artifacts_dir)

    # Print summary
    key = Path(artifacts_dir).name
    print(f"\n{'='*60}")
    print(f"Run Metrics: {key}")
    print(f"{'='*60}")
    print(f"  Files: {metrics.get('file_count', 0)} ({metrics.get('total_size_kb', 0)} KB)")
    print(f"  Screenshots: {metrics.get('screenshot_count', 0)} ({metrics.get('screenshot_size_kb', 0)} KB)")
    print(f"  Text artifacts: {metrics.get('text_artifact_size_kb', 0)} KB (~{metrics.get('estimated_output_tokens', 0)} tokens)")
    if "duration_minutes" in metrics:
        print(f"  Duration: {metrics['duration_minutes']} min")
    print(f"  Iterations: {metrics.get('iterations', '?')}")
    print(f"  Exit: {metrics.get('exit_reason', '?')}")
    if "journey_count" in metrics:
        print(f"  Journeys: {metrics['journey_count']}")
    if "persona_task_count" in metrics:
        print(f"  Persona tasks: {metrics['persona_task_count']} ({metrics.get('total_trace_steps', 0)} trace steps)")
    if "usability_score" in metrics and metrics["usability_score"]:
        print(f"  Usability: {metrics['usability_score']}")

    # Append to run log if requested
    if "--append-to" in sys.argv:
        log_path = sys.argv[sys.argv.index("--append-to") + 1]
        if os.path.exists(log_path):
            log = json.load(open(log_path))
            for run in log.get("runs", []):
                if run.get("key") == key or key in run.get("id", ""):
                    run["metrics"] = metrics
                    break
            with open(log_path, "w") as f:
                json.dump(log, f, indent=2)
            print(f"\n  Appended to {log_path}")

    # Also write standalone metrics file
    metrics_path = os.path.join(artifacts_dir, "run-metrics.json")
    with open(metrics_path, "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"  Metrics saved to {metrics_path}")


if __name__ == "__main__":
    main()
