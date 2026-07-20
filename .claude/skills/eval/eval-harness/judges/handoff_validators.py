"""
Artifact handoff validation judges for the eval pipeline.

These judges validate that data flowing between skills at handoff boundaries
has the correct schema and content. Import via eval.yaml module: judges.

Each function receives (outputs=dict, **kwargs) and returns (bool|number, str).
"""

import json
from typing import Any


def _find_artifact(outputs: dict, filename: str) -> str | None:
    """Find an artifact by filename suffix in outputs."""
    files = outputs.get("files", {})
    matches = [v for k, v in files.items() if k.endswith(filename)]
    return matches[0] if matches else None


def _parse_json(content: str) -> dict | list | None:
    try:
        return json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return None


def extract_to_classify(outputs: dict, **kwargs) -> tuple[bool, str]:
    """Validate extract-state.json has what eval-classify needs.
    Handles both field names: 'acceptance_criteria' and 'ac_list'."""
    content = _find_artifact(outputs, "extract-state.json")
    if not content:
        return (False, "extract-state.json not found")

    state = _parse_json(content)
    if not state:
        return (False, "extract-state.json is not valid JSON")

    acs = state.get("acceptance_criteria", state.get("ac_list", []))
    if not acs:
        return (False, "No acceptance_criteria or ac_list array")

    id_field = "id" if "id" in acs[0] else "criterion_id"
    for ac in acs:
        if id_field not in ac:
            return (False, f"AC missing '{id_field}' field: {ac}")
        if "text" not in ac:
            return (False, f"AC {ac[id_field]} missing 'text' field")

    return (True, f"Valid handoff: {len(acs)} ACs with {id_field}+text for classify")


def extract_to_verify(outputs: dict, **kwargs) -> tuple[bool, str]:
    """Validate extract-state.json + mr-delta.json have what eval-verify needs."""
    state_content = _find_artifact(outputs, "extract-state.json")
    delta_content = _find_artifact(outputs, "mr-delta.json")

    if not state_content:
        return (False, "extract-state.json not found")
    if not delta_content:
        return (False, "mr-delta.json not found")

    state = _parse_json(state_content)
    delta = _parse_json(delta_content)

    if not state or not delta:
        return (False, "Invalid JSON in extract-state or mr-delta")

    acs = state.get("acceptance_criteria", state.get("ac_list", []))
    journeys = state.get("journey_definitions", [])

    new_files = delta.get("new_files", [])
    mod_files = delta.get("modified_files", [])
    # Handle both flat list and categorized format
    if not new_files and not mod_files:
        cats = delta.get("categories", {})
        for cat_files in cats.values():
            if isinstance(cat_files, list):
                mod_files.extend(cat_files)
    files_changed = len(new_files) + len(mod_files)
    # Handle the files_changed: [{path, status, category}, ...] shape (another
    # historical eval-extract mr-delta.json variant, distinct from new_files/
    # modified_files and from categories).
    if files_changed == 0:
        fc = delta.get("files_changed", [])
        if isinstance(fc, list):
            files_changed = len(fc)

    problems = []
    if not acs:
        problems.append("no acceptance_criteria/ac_list")
    if files_changed == 0:
        problems.append("no files in mr-delta")

    if problems:
        return (False, f"Handoff issues: {', '.join(problems)}")

    return (True, f"Valid: {len(acs)} ACs, {len(journeys)} journeys, {files_changed} files")


def csv_to_exit_condition(outputs: dict, **kwargs) -> tuple[bool, str]:
    """Validate evaluation-report.csv Section 1 has verdict column for exit condition check.
    Stops parsing at Section 2 header to avoid treating usability rows as AC verdicts."""
    import csv
    import io

    content = _find_artifact(outputs, "evaluation-report.csv")
    if not content:
        return (False, "evaluation-report.csv not found")

    # Only parse Section 1 (stop at USABILITY DIMENSIONS header)
    section1_lines = []
    for line in content.splitlines():
        if "USABILITY DIMENSIONS" in line:
            break
        if line.strip() and not line.startswith("#"):
            section1_lines.append(line)

    if len(section1_lines) < 2:
        return (False, "CSV Section 1 has no data rows")

    reader = csv.DictReader(io.StringIO("\n".join(section1_lines)))
    rows = list(reader)

    if "verdict" not in (reader.fieldnames or []):
        return (False, "CSV missing 'verdict' column")

    verdicts = [r.get("verdict", "") for r in rows if r.get("verdict")]
    valid_verdicts = {"PASS", "FAIL", "FLAGGED"}
    invalid = [v for v in verdicts if v not in valid_verdicts]
    if invalid:
        return (False, f"Invalid verdicts in Section 1: {invalid}")

    return (True, f"Valid: {len(verdicts)} verdicts ({verdicts.count('PASS')}P/{verdicts.count('FAIL')}F/{verdicts.count('FLAGGED')}FL)")


def journey_to_report(outputs: dict, **kwargs) -> tuple[bool, str]:
    """Validate journey-log.json + persona-results.json have what eval-report needs."""
    jl_content = _find_artifact(outputs, "journey-log.json")
    pr_content = _find_artifact(outputs, "persona-results.json")

    if not jl_content:
        return (False, "journey-log.json not found")

    jl = _parse_json(jl_content)
    if not jl:
        return (False, "journey-log.json is not valid JSON")

    journeys = jl.get("journeys", [])
    if not journeys:
        return (False, "No journeys in journey-log.json")

    for j in journeys:
        if "id" not in j:
            return (False, f"Journey missing 'id': {j.get('title', '?')}")
        if "verdict" not in j:
            return (False, f"Journey {j['id']} missing 'verdict'")
        if "steps" not in j:
            return (False, f"Journey {j['id']} missing 'steps'")

    usability = jl.get("usability_dimensions")
    if pr_content and not usability:
        return (False, "persona-results.json exists but journey-log missing usability_dimensions")

    if usability:
        if "personas_evaluated" not in usability:
            return (False, "usability_dimensions missing personas_evaluated")
        dims = usability.get("dimensions", [])
        for d in dims:
            if "composite_score" not in d:
                return (False, f"Dimension {d.get('id','?')} missing composite_score")

    msg = f"Valid: {len(journeys)} journeys"
    if usability:
        msg += f", {len(usability.get('dimensions', []))} usability dimensions"
    return (True, msg)


def verify_to_fix(outputs: dict, **kwargs) -> tuple[bool, str]:
    """Validate refinement-suggestions.json has what eval-fix needs.
    Accepts ac_failure, ac_flagged, consistency, and usability types."""
    content = _find_artifact(outputs, "refinement-suggestions.json")
    if not content:
        return (False, "refinement-suggestions.json not found")

    suggestions = _parse_json(content)
    if suggestions is None:
        return (False, "refinement-suggestions.json is not valid JSON")

    if not isinstance(suggestions, list):
        return (False, f"Expected array, got {type(suggestions).__name__}")

    valid_types = {"ac_failure", "ac_flagged", "consistency", "usability"}
    for s in suggestions:
        stype = s.get("type", "")
        if stype not in valid_types:
            return (False, f"Invalid suggestion type: {stype}")

    by_type = {}
    for s in suggestions:
        t = s.get("type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1

    return (True, f"Valid: {len(suggestions)} suggestions ({by_type})")


def fix_to_iterate(outputs: dict, **kwargs) -> tuple[bool, str]:
    """Validate fix-log.json has what eval-iterate needs for iteration tracking.
    fix-log.json is optional — it only exists when eval-fix actually ran."""
    content = _find_artifact(outputs, "fix-log.json")
    if not content:
        iter_content = _find_artifact(outputs, "iteration-log.json")
        if iter_content:
            iter_log = _parse_json(iter_content)
            if iter_log:
                exit_reason = iter_log.get("exit_reason", "")
                fixes_applied = iter_log.get("total_criteria_fixed", 0)
                if fixes_applied == 0 or exit_reason in ("flagged_unfixable", "no_fix", "no_iterate"):
                    return (True, f"No fix-log.json — no fixes applied (exit: {exit_reason})")
        return (False, "fix-log.json not found and fixes may have been expected")

    log = _parse_json(content)
    if not log:
        return (False, "fix-log.json is not valid JSON")

    # Canonical field is "applied" (validate-fix-log.js), but "fixes_applied" has
    # shown up in some historical runs — accept either rather than hard-failing.
    if "applied" not in log and "fixes_applied" not in log:
        return (False, "fix-log.json missing 'applied' array")
    if "skipped" not in log:
        return (False, "fix-log.json missing 'skipped' array")

    applied = log.get("applied", log.get("fixes_applied", []))
    skipped = log.get("skipped", [])
    deferred = log.get("deferred_to_human", [])

    return (True, f"Valid: {len(applied)} applied, {len(skipped)} skipped, {len(deferred)} deferred")


def vendored_context_freshness(**kwargs) -> tuple[bool, str]:
    """Check that vendored .context/ repos haven't drifted from what the pipeline expects.
    Validates usability-testing personas and consistency-checker guidelines exist."""
    import os
    issues = []

    usability_path = ".context/usability-testing"
    if os.path.isdir(usability_path):
        personas_dir = os.path.join(usability_path, "personas")
        if not os.path.isdir(personas_dir):
            issues.append("usability-testing exists but personas/ missing")
        else:
            yamls = [f for f in os.listdir(personas_dir) if f.endswith('.yaml')]
            if len(yamls) < 2:
                issues.append(f"Only {len(yamls)} persona YAML files (expected 2+)")
        rubric = os.path.join(usability_path, "prompts", "evaluate-flow.md")
        if not os.path.isfile(rubric):
            issues.append("usability-testing missing prompts/evaluate-flow.md rubric")
    else:
        issues.append("usability-testing not bootstrapped")

    checker_path = ".context/consistency-checker"
    if os.path.isdir(checker_path):
        guidelines = os.path.join(checker_path, "guidelines")
        if not os.path.isdir(guidelines):
            issues.append("consistency-checker exists but guidelines/ missing")
    else:
        issues.append("consistency-checker not bootstrapped")

    if issues:
        return (False, f"Context drift: {issues}")
    return (True, "Vendored contexts present and structured correctly")
