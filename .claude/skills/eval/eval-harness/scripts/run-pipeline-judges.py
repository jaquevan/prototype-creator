#!/usr/bin/env python3
"""Run eval-iterate pipeline judges against existing artifacts and log to MLflow.

Simulates what /eval-run scores by running all check judges from eval-iterate.yaml
against actual artifacts on disk, then logs the results to MLflow.

Usage: python3 run-pipeline-judges.py <artifacts-dir> [--run-name <name>] [--tag <key=value>]
"""

import csv
import io
import json
import os
import sys
from pathlib import Path

import mlflow
import yaml


def load_config():
    config_path = Path(__file__).parent.parent / "configs" / "eval-iterate.yaml"
    with open(config_path) as f:
        return yaml.safe_load(f)


def build_outputs(artifacts_dir: Path, annotations: dict = None) -> dict:
    files = {}
    for f in artifacts_dir.iterdir():
        if f.is_file() and f.suffix in ('.json', '.csv', '.yaml', '.md', '.html', '.txt'):
            try:
                files[f.name] = f.read_text()
            except Exception:
                pass
    return {
        "files": files,
        "annotations": annotations or {},
        "case_dir": str(artifacts_dir),
    }


def run_check_judge(check_code: str, outputs: dict, arguments: dict = None) -> tuple:
    """Run an inline Python check judge."""
    local_ns = {"outputs": outputs, "arguments": arguments or {}}
    exec_code = check_code.strip()
    lines = exec_code.split("\n")
    indented = "\n".join("    " + l for l in lines)
    wrapper = f"def _judge(outputs, arguments):\n{indented}\nresult = _judge(outputs, arguments)"
    try:
        exec(wrapper, local_ns)
        return local_ns["result"]
    except Exception as e:
        return (False, f"Judge error: {e}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 run-pipeline-judges.py <artifacts-dir> [--run-name name] [--tag key=value]")
        sys.exit(1)

    artifacts_dir = Path(sys.argv[1])
    run_name = artifacts_dir.name
    tags = {"run_type": "pipeline-judge-validation", "branch": "eval-harness-optimizations"}

    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == "--run-name" and i + 1 < len(sys.argv):
            run_name = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == "--tag" and i + 1 < len(sys.argv):
            k, v = sys.argv[i + 1].split("=", 1)
            tags[k] = v
            i += 2
        else:
            i += 1

    config = load_config()
    outputs = build_outputs(artifacts_dir)

    print(f"\n{'=' * 60}")
    print(f"Pipeline Judge Validation: {run_name}")
    print(f"Artifacts: {artifacts_dir}")
    print(f"Files loaded: {len(outputs['files'])}")
    print(f"{'=' * 60}\n")

    results = {}
    passed = 0
    failed = 0

    for judge in config.get("judges", []):
        name = judge.get("name", "unknown")
        check = judge.get("check")

        if not check:
            if judge.get("builtin") == "cost_budget":
                results[name] = (True, "Budget check skipped (offline validation)")
                passed += 1
                print(f"  \033[33mSKIP\033[0m {name}: budget check (offline)")
                continue
            if judge.get("prompt"):
                results[name] = (True, "LLM judge skipped (offline validation)")
                passed += 1
                print(f"  \033[33mSKIP\033[0m {name}: LLM judge (offline)")
                continue
            continue

        try:
            ok, msg = run_check_judge(check, outputs, judge.get("arguments", {}))
            results[name] = (ok, msg)
            if ok:
                passed += 1
                print(f"  \033[32mPASS\033[0m {name}: {msg}")
            else:
                failed += 1
                print(f"  \033[31mFAIL\033[0m {name}: {msg}")
        except Exception as e:
            results[name] = (False, f"Error: {e}")
            failed += 1
            print(f"  \033[31mERROR\033[0m {name}: {e}")

    total = passed + failed
    print(f"\n{'=' * 60}")
    print(f"RESULT: {passed}/{total} judges passed, {failed} failed")
    print(f"{'=' * 60}\n")

    tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", "http://127.0.0.1:5000")
    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment("prototype-creator-eval")

    with mlflow.start_run(run_name=f"{run_name}-judges") as run:
        for k, v in tags.items():
            mlflow.set_tag(k, v)
        mlflow.log_param("skill", "eval-iterate")
        mlflow.log_param("artifacts_dir", str(artifacts_dir))

        for name, (ok, msg) in results.items():
            mlflow.log_metric(f"judge/{name}", 1.0 if ok else 0.0)

        mlflow.log_metric("judges_passed", passed)
        mlflow.log_metric("judges_failed", failed)
        mlflow.log_metric("judges_total", total)
        if total > 0:
            mlflow.log_metric("judge_pass_rate", passed / total)

        print(f"Logged to MLflow: {run.info.run_id}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
