#!/usr/bin/env python3
"""
journey-to-extract.py

Transforms Amplitude journey/funnel data (see samples/sample-journey-funnel.json
for the expected input shape) into fragments matching eval-extract's
extract-state.json schema:

  - journey_definitions[] entries (Phase A input, consumed by eval-verify /
    scripts/generate-journey-script.js)
  - a risk_weight hint list keyed by step pair, derived from funnel drop-off,
    meant to bias eval-discover's Step 1c-routes task-to-route mapping toward
    steps where real users actually struggle

This is a SCHEMA DEMONSTRATION, not a production transform — it is not wired
into eval-extract. See ../README.md "Mapping strategy" for the full rationale
and the caveats about event-name -> action-type heuristics being lossy.

Usage:
    python3 journey-to-extract.py samples/sample-journey-funnel.json --out /tmp/amplitude-journey-seed.json
    python3 journey-to-extract.py samples/sample-journey-funnel.json   # prints to stdout
"""

import argparse
import json
import re
import sys


# Heuristics for mapping an Amplitude event name to a Playwright-style action.
# This is intentionally simple — Amplitude event names are free text, not a
# controlled vocabulary, so this will misclassify some events. Flag low-confidence
# mappings rather than guessing silently (see classify_event's "confidence" field).
NAVIGATE_HINTS = ("viewed", "page view", "opened", "navigated")
CLICK_HINTS = ("clicked", "selected", "submitted", "created", "run selected")
VERIFY_HINTS = ("complete", "success", "completed", "finished")


def classify_event(event_name: str):
    name = event_name.lower()
    if any(h in name for h in VERIFY_HINTS):
        return {"action": "verify", "confidence": "medium"}
    if any(h in name for h in CLICK_HINTS):
        return {"action": "click", "confidence": "medium"}
    if any(h in name for h in NAVIGATE_HINTS):
        return {"action": "navigate", "confidence": "medium"}
    # Unclassifiable — default to navigate but flag low confidence so a human
    # (or eval-verify) knows this step needs review, not blind trust.
    return {"action": "navigate", "confidence": "low"}


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def path_to_journey(path: dict, index: int) -> dict:
    seq = path.get("sequence", [])
    steps = []
    for i, evt in enumerate(seq, start=1):
        event_name = evt.get("event", "unknown event")
        cls = classify_event(event_name)
        steps.append({
            "step": i,
            "action": cls["action"],
            "target": event_name,
            "properties": evt.get("properties", {}),
            "source": "amplitude",
            "confidence": cls["confidence"],
        })

    return {
        "id": f"amplitude-{path.get('path_id', f'path-{index}')}",
        "title": f"Real user path starting at '{path.get('starting_event', 'unknown')}' "
                 f"(observed {path.get('frequency', '?')}x)",
        "persona": "unknown — Amplitude has no persona/segment mapping to eval personas yet",
        "source": "Amplitude journey map (real usage, not inferred from Jira text)",
        "ac_ids": [],
        "expected_path": steps,
        "completed_funnel": path.get("completed_funnel"),
        "frequency": path.get("frequency"),
        "needs_human_review": any(s["confidence"] == "low" for s in steps) or not path.get("completed_funnel", True),
    }


def funnel_to_risk_weights(funnel: dict) -> list:
    """Turn step-to-step drop-off into a risk_weight hint per transition.

    High drop-off between step N and N+1 means real users struggle at that
    transition — eval-discover's Step 1c-routes should prioritize testing
    that transition over ones with near-100% conversion.
    """
    steps = funnel.get("steps", [])
    weights = []
    for i in range(1, len(steps)):
        prev, cur = steps[i - 1], steps[i]
        drop_rate = cur.get("drop_off_rate", 0.0)
        if drop_rate >= 30:
            risk = "high"
        elif drop_rate >= 10:
            risk = "medium"
        else:
            risk = "low"
        weights.append({
            "from_event": prev.get("event"),
            "to_event": cur.get("event"),
            "drop_off_rate": drop_rate,
            "risk_weight": risk,
            "sample_size": prev.get("count"),
            "low_confidence_sample": prev.get("count", 0) < 30,
        })
    return weights


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", help="Path to Amplitude journey/funnel JSON (see samples/)")
    ap.add_argument("--out", default=None, help="Write result JSON here instead of stdout")
    args = ap.parse_args()

    with open(args.input) as f:
        data = json.load(f)

    is_mocked = "_meta" in data and "MOCKED" in data["_meta"].get("status", "")

    journeys = [
        path_to_journey(p, i)
        for i, p in enumerate(data.get("unique_paths", []), start=1)
    ]
    risk_weights = funnel_to_risk_weights(data.get("funnel", {}))

    result = {
        "_provenance": {
            "input_is_mocked": is_mocked,
            "note": data.get("_meta", {}).get("status", "unlabeled input — verify before trusting"),
        },
        "journey_definitions_fragment": journeys,
        "risk_weights": risk_weights,
    }

    out = json.dumps(result, indent=2)
    if args.out:
        with open(args.out, "w") as f:
            f.write(out)
        print(f"[journey-to-extract] wrote {args.out}", file=sys.stderr)
        print(f"[journey-to-extract] {len(journeys)} journey(s), "
              f"{sum(1 for j in journeys if j['needs_human_review'])} flagged for human review",
              file=sys.stderr)
    else:
        print(out)


if __name__ == "__main__":
    main()
