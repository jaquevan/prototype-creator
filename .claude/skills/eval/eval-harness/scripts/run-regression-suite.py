#!/usr/bin/env python3
"""Run regression suite: validate all skill-level judges against real v6 artifacts.

For each skill config, runs all check judges against the appropriate artifact
files from real pipeline runs, then logs results to MLflow.

Usage: python3 run-regression-suite.py
"""

import json
import os
import sys
from pathlib import Path

import mlflow
import yaml

HARNESS_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = HARNESS_ROOT.parent.parent.parent.parent
ARTIFACTS_ROOT = PROJECT_ROOT / ".artifacts"
CONFIGS_DIR = HARNESS_ROOT / "configs"

V6_ARTIFACTS = [
    "RHAISTRAT-432-v6",
    "RHAISTRAT-1536-v6",
    "RHAISTRAT-133-v6",
    "RHAISTRAT-1474-v6",
    "RHAISTRAT-1535-v6",
    "RHAISTRAT-1740-v6",
]

SKILL_CONFIGS = [
    "eval-classify",
    "eval-consistency",
    "eval-discover",
    "eval-extract",
    "eval-fix",
    "eval-iterate",
    "eval-nav-context",
    "eval-report",
    "eval-review",
    "eval-verify",
]


def load_yaml(path: Path) -> dict:
    with open(path) as f:
        return yaml.safe_load(f) or {}


def build_outputs(artifacts_dir: Path) -> dict:
    files = {}
    for f in artifacts_dir.iterdir():
        if f.is_file() and f.suffix in ('.json', '.csv', '.yaml', '.md', '.html', '.txt'):
            try:
                files[f.name] = f.read_text()
            except Exception:
                pass
    return {"files": files, "annotations": {}, "case_dir": str(artifacts_dir)}


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

    total_skills = 0
    total_passed = 0
    total_failed = 0
    total_skipped = 0

    for skill_name in SKILL_CONFIGS:
        config_path = CONFIGS_DIR / f"{skill_name}.yaml"
        if not config_path.exists():
            continue

        config = load_yaml(config_path)
        skill_model = config.get("models", {}).get("skill", "unknown")
        check_judges = [j for j in config.get("judges", []) if j.get("check")]

        if not check_judges:
            continue

        total_skills += 1
        skill_passed = 0
        skill_failed = 0
        skill_skipped = 0

        print(f"\n{'=' * 60}")
        print(f"SKILL: {skill_name} (model: {skill_model}, {len(check_judges)} check judges)")
        print(f"{'=' * 60}")

        for run_name in V6_ARTIFACTS:
            ad = ARTIFACTS_ROOT / run_name
            if not ad.is_dir():
                continue

            outputs = build_outputs(ad)
            if not outputs["files"]:
                continue

            case_passed = 0
            case_failed = 0

            for judge in check_judges:
                name = judge.get("name", "unknown")
                ok, msg = run_check_judge(judge["check"], outputs, judge.get("arguments", {}))
                if ok:
                    case_passed += 1
                else:
                    case_failed += 1

            icon = "PASS" if case_failed == 0 else "FAIL"
            print(f"  {icon} {run_name}: {case_passed}/{case_passed + case_failed}")

            skill_passed += case_passed
            skill_failed += case_failed

        skill_total = skill_passed + skill_failed
        if skill_total > 0:
            rate = skill_passed / skill_total
            print(f"  -> {skill_name}: {skill_passed}/{skill_total} ({rate:.0%})")

            with mlflow.start_run(run_name=f"{skill_name}-regression") as run:
                mlflow.set_tag("run_type", "regression")
                mlflow.set_tag("branch", "eval-harness-optimizations")
                mlflow.set_tag("skill", skill_name)
                mlflow.log_param("model", skill_model)
                mlflow.log_param("skill", skill_name)
                mlflow.log_param("artifacts_count", len(V6_ARTIFACTS))
                mlflow.log_metric("judges_passed", skill_passed)
                mlflow.log_metric("judges_failed", skill_failed)
                mlflow.log_metric("judge_pass_rate", rate)

        total_passed += skill_passed
        total_failed += skill_failed

    grand_total = total_passed + total_failed
    print(f"\n{'=' * 60}")
    print(f"REGRESSION SUITE: {total_passed}/{grand_total} across {total_skills} skills")
    if grand_total > 0:
        print(f"Pass rate: {total_passed / grand_total:.1%}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
