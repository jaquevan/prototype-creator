#!/usr/bin/env python3
"""Run model comparison for deterministic skills by validating fixture-based judges.

For each deterministic skill config (already set to Sonnet), runs all check judges
against every test case's fixture data, then logs results to MLflow.

Usage: python3 run-model-comparison.py
"""

import json
import os
import sys
from pathlib import Path

import mlflow
import yaml

HARNESS_ROOT = Path(__file__).resolve().parent.parent
CONFIGS_DIR = HARNESS_ROOT / "configs"
DATASETS_DIR = HARNESS_ROOT / "datasets"

DETERMINISTIC_SKILLS = [
    "eval-classify",
    "eval-consistency",
    "eval-nav-context",
    "eval-report",
    "eval-review",
]


def load_yaml(path: Path) -> dict:
    with open(path) as f:
        return yaml.safe_load(f) or {}


def build_outputs_from_fixtures(case_dir: Path) -> dict:
    files = {}
    fixtures_dir = case_dir / "fixtures"
    if fixtures_dir.is_dir():
        for f in fixtures_dir.iterdir():
            if f.is_file():
                try:
                    files[f.name] = f.read_text()
                except Exception:
                    pass

    annotations = {}
    ann_path = case_dir / "annotations.yaml"
    if ann_path.exists():
        annotations = load_yaml(ann_path)

    return {"files": files, "annotations": annotations, "case_dir": str(case_dir)}


def run_check_judge(check_code: str, outputs: dict, arguments: dict = None) -> tuple:
    local_ns = {"outputs": outputs, "arguments": arguments or {}}
    lines = check_code.strip().split("\n")
    indented = "\n".join("    " + l for l in lines)
    wrapper = f"def _judge(outputs, arguments):\n{indented}\nresult = _judge(outputs, arguments)"
    try:
        exec(wrapper, local_ns)
        return local_ns["result"]
    except Exception as e:
        return (False, f"Judge error: {e}")


def main():
    tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", "http://127.0.0.1:5000")
    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment("prototype-creator-eval")

    for skill_name in DETERMINISTIC_SKILLS:
        config_path = CONFIGS_DIR / f"{skill_name}.yaml"
        if not config_path.exists():
            print(f"SKIP: {skill_name} — config not found")
            continue

        config = load_yaml(config_path)
        skill_model = config.get("models", {}).get("skill", "unknown")

        dataset_path = DATASETS_DIR / skill_name.replace("eval-", "") / "cases"
        if not dataset_path.exists():
            alt_path = DATASETS_DIR / skill_name / "cases"
            if alt_path.exists():
                dataset_path = alt_path
            else:
                print(f"SKIP: {skill_name} — dataset not found at {dataset_path}")
                continue

        case_dirs = sorted([d for d in dataset_path.iterdir() if d.is_dir()])
        if not case_dirs:
            print(f"SKIP: {skill_name} — no test cases")
            continue

        print(f"\n{'=' * 60}")
        print(f"SKILL: {skill_name} (model: {skill_model})")
        print(f"Cases: {len(case_dirs)}")
        print(f"{'=' * 60}")

        check_judges = [j for j in config.get("judges", []) if j.get("check")]

        all_passed = 0
        all_failed = 0
        per_case_results = {}

        for case_dir in case_dirs:
            case_name = case_dir.name
            outputs = build_outputs_from_fixtures(case_dir)

            if not outputs["files"]:
                print(f"\n  {case_name}: (no fixtures, skipping)")
                continue

            print(f"\n  {case_name}:")
            case_passed = 0
            case_failed = 0

            for judge in check_judges:
                name = judge.get("name", "unknown")
                check = judge["check"]
                args = judge.get("arguments", {})

                ok, msg = run_check_judge(check, outputs, args)
                if ok:
                    case_passed += 1
                    print(f"    PASS {name}: {msg}")
                else:
                    case_failed += 1
                    print(f"    FAIL {name}: {msg}")

            all_passed += case_passed
            all_failed += case_failed
            per_case_results[case_name] = {
                "passed": case_passed,
                "failed": case_failed,
                "total": case_passed + case_failed,
            }

        total = all_passed + all_failed
        print(f"\n  TOTAL: {all_passed}/{total} judges passed across {len(case_dirs)} cases")

        with mlflow.start_run(run_name=f"{skill_name}-sonnet-validation") as run:
            mlflow.set_tag("run_type", "model-comparison")
            mlflow.set_tag("branch", "eval-harness-optimizations")
            mlflow.set_tag("skill", skill_name)
            mlflow.log_param("model", skill_model)
            mlflow.log_param("skill", skill_name)
            mlflow.log_param("cases_count", len(case_dirs))
            mlflow.log_metric("judges_passed", all_passed)
            mlflow.log_metric("judges_failed", all_failed)
            mlflow.log_metric("judges_total", total)
            if total > 0:
                mlflow.log_metric("judge_pass_rate", all_passed / total)

            for case_name, r in per_case_results.items():
                if r["total"] > 0:
                    mlflow.log_metric(
                        f"case/{case_name}/pass_rate",
                        r["passed"] / r["total"],
                    )

            print(f"  Logged to MLflow: {run.info.run_id}")

    print(f"\n{'=' * 60}")
    print("Model comparison complete.")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
