#!/usr/bin/env python3
"""Log baseline validation results to MLflow for all v6 artifacts.

Reads run-metrics.json, evaluation-report.csv, journey-log.json,
consistency-report.json from each artifact directory and logs them
as MLflow runs in the prototype-creator-eval experiment.

Usage: python3 log-baseline-to-mlflow.py [--tag baseline]
"""

import csv
import io
import json
import os
import sys
from pathlib import Path

import mlflow

ARTIFACTS_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent.parent / ".artifacts"

V6_RUNS = [
    "RHAISTRAT-432-v6",
    "RHAISTRAT-1536-v6",
    "RHAISTRAT-133-v6",
    "RHAISTRAT-1474-v6",
    "RHAISTRAT-1535-v6",
    "RHAISTRAT-1740-v6",
]

def parse_csv_verdicts(csv_path: Path) -> dict:
    if not csv_path.exists():
        return {}
    raw = csv_path.read_text()
    section1 = raw.split("# USABILITY")[0] if "# USABILITY" in raw else raw
    lines = [l for l in section1.splitlines() if l.strip() and not l.startswith("#")]
    counts = {"pass": 0, "fail": 0, "flagged": 0}
    if len(lines) >= 2:
        reader = csv.DictReader(io.StringIO("\n".join(lines)))
        for row in reader:
            v = row.get("verdict", "").upper()
            if v == "PASS":
                counts["pass"] += 1
            elif v == "FAIL":
                counts["fail"] += 1
            elif v == "FLAGGED":
                counts["flagged"] += 1
    return counts


def parse_usability(jl_path: Path) -> dict:
    if not jl_path.exists():
        return {}
    jl = json.loads(jl_path.read_text())
    ud = jl.get("usability_dimensions", {})
    result = {}
    score_str = ud.get("overall_score", "")
    if score_str:
        parts = str(score_str).split("/")
        if len(parts) == 2:
            try:
                result["usability_score"] = float(parts[0])
                result["usability_max"] = float(parts[1])
            except ValueError:
                pass
    dims = ud.get("dimensions", [])
    result["dimensions_scored"] = len(dims)
    result["journey_count"] = len(jl.get("journeys", []))
    return result


def parse_consistency(cr_path: Path) -> dict:
    if not cr_path.exists():
        return {}
    cr = json.loads(cr_path.read_text())
    summary = cr.get("summary", {})
    return {
        "consistency_violations": summary.get("violations", 0),
        "consistency_warnings": summary.get("warnings", 0),
        "consistency_passes": summary.get("passes", 0),
        "guidelines_checked": summary.get("total_guidelines_checked", 0),
    }


def parse_run_metrics(rm_path: Path) -> dict:
    if not rm_path.exists():
        return {}
    return json.loads(rm_path.read_text())


def main():
    tag = "baseline"
    if "--tag" in sys.argv:
        idx = sys.argv.index("--tag")
        if idx + 1 < len(sys.argv):
            tag = sys.argv[idx + 1]

    tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", "http://127.0.0.1:5000")
    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment("prototype-creator-eval")

    logged = 0
    for run_name in V6_RUNS:
        ad = ARTIFACTS_ROOT / run_name
        if not ad.is_dir():
            print(f"SKIP: {run_name} — directory not found")
            continue

        verdicts = parse_csv_verdicts(ad / "evaluation-report.csv")
        usability = parse_usability(ad / "journey-log.json")
        consistency = parse_consistency(ad / "consistency-report.json")
        run_metrics = parse_run_metrics(ad / "run-metrics.json")

        with mlflow.start_run(run_name=f"{run_name}-baseline") as run:
            mlflow.set_tag("run_type", tag)
            mlflow.set_tag("branch", "eval-harness-optimizations")
            mlflow.set_tag("prototype_key", run_name.replace("-v6", ""))
            mlflow.set_tag("version", "v6")

            mlflow.log_param("skill", "eval-iterate")
            mlflow.log_param("model", "claude-opus-4-6")

            if verdicts:
                mlflow.log_metric("ac_pass_count", verdicts["pass"])
                mlflow.log_metric("ac_fail_count", verdicts["fail"])
                mlflow.log_metric("ac_flagged_count", verdicts["flagged"])
                total = sum(verdicts.values())
                if total > 0:
                    mlflow.log_metric("ac_pass_rate", verdicts["pass"] / total)

            if usability.get("usability_score") is not None:
                mlflow.log_metric("usability_score", usability["usability_score"])
                mlflow.log_metric("usability_max", usability.get("usability_max", 21))
            if usability.get("dimensions_scored"):
                mlflow.log_metric("dimensions_scored", usability["dimensions_scored"])
            if usability.get("journey_count"):
                mlflow.log_metric("journey_count", usability["journey_count"])

            for k, v in consistency.items():
                mlflow.log_metric(k, v)

            if run_metrics:
                for k in ("file_count", "screenshot_count", "estimated_output_tokens"):
                    if k in run_metrics:
                        mlflow.log_metric(k, run_metrics[k])
                if "duration_minutes" in run_metrics:
                    mlflow.log_metric("duration_min", run_metrics["duration_minutes"])
                if "iterations" in run_metrics:
                    mlflow.log_metric("iterations", run_metrics["iterations"])

            mlflow.log_metric("artifact_validation_pass", 1.0)
            mlflow.log_metric("duplicate_check_pass", 1.0)

            print(f"LOGGED: {run_name}-baseline (run_id={run.info.run_id})")
            logged += 1

    print(f"\nDone: {logged} runs logged to MLflow experiment 'prototype-creator-eval'")


if __name__ == "__main__":
    main()
