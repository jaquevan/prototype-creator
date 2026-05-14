# Human Review Guide

After the CI pipeline generates prototypes, humans review and refine them using local mode — a metadata flag that skips Jira writes while keeping all artifacts in the same `.artifacts/` directory.

## Quick Start

```bash
# Switch a prototype to local mode
/prototype.pull PROJ-298

# Review it locally
/prototype.review

# Refine based on review feedback
/prototype.refine

# Reset to CI mode when ready
/prototype.push PROJ-298
```

## Directory Layout

All artifacts for a prototype live in a single directory:

```
.artifacts/PROJ-298/
├── prototype/           # Prototype code (HTML files or workspace changes)
│   ├── index.html
│   └── ...
├── reviews/             # Review scores and feedback
│   ├── completeness.md
│   ├── usability.md
│   ├── feasibility.md
│   ├── fidelity-match.md
│   └── summary.md
├── decisions/           # Design decisions made during creation
│   ├── decisions.json
│   ├── strategy-brief.md
│   └── decision-001.html
├── metadata.json        # Run metadata and mode (ci/local)
├── rfe-snapshot.md      # Original RFE content (read-only reference)
├── changeset.md         # Files created/modified (workspace mode)
└── workspace-analysis.json  # Target codebase analysis (workspace mode)
```

## Two Paths

After CI runs, each prototype gets one of two verdicts:

| CI Verdict | Label | What to Do |
|------------|-------|------------|
| Passed | `prototype-creator-rubric-pass` | Pull, review locally, submit if satisfied |
| Needs attention | `prototype-creator-needs-attention` | Pull, fix issues, refine, re-review, push back to CI |

### Path 1: Rubric Pass

The prototype scored well. You're reviewing for correctness, not fixing issues.

```bash
/prototype.pull PROJ-298          # Switch to local mode
# Open .artifacts/PROJ-298/prototype/index.html in your browser
# Read .artifacts/PROJ-298/reviews/summary.md for the review
/prototype.submit PROJ-298        # Publish it
```

### Path 2: Needs Attention

The prototype has issues flagged by the reviewers. Fix them, then push back.

```bash
/prototype.pull PROJ-298          # Switch to local mode
# Read the review summary to understand what needs fixing
/prototype.refine                  # AI helps fix the issues
/prototype.review                  # Re-score locally
# If passing now:
/prototype.push PROJ-298          # Reset to CI mode
# Then: /prototype.submit PROJ-298
```

## Local Mode

Skills detect local mode by reading `metadata.json` and checking the `mode` field:
- `"mode": "local"` — Jira label writes are skipped, pipeline label gates are skipped
- `"mode": "ci"` — Full CI behavior (Jira writes, label gates)

`/prototype.pull` sets mode to local. `/prototype.push` resets it to CI.

## Editing Prototypes Manually

Prototypes are just HTML files. You can edit them directly:

1. Open `.artifacts/{ID}/prototype/index.html` in your editor
2. Make changes
3. View in browser to verify
4. Run `/prototype.review` to re-score

## Decide Mode in Local Review

If you want to reconsider design decisions:

```bash
/prototype.create PROJ-298 --mode=decide --fidelity=medium
```

This re-runs creation in decide mode, surfacing each design decision for your judgment. Previous decisions from `.artifacts/PROJ-298/decisions/` are shown as defaults.

## Tips

- Always read the review summary before refining
- Focus on the dimensions that scored 0 or 1 first
- The completeness dimension is the most important — a beautiful prototype that doesn't address the RFE is useless
- For usability issues, the review file lists specific heuristic violations with recommendations
- You can edit the prototype HTML directly; the review will re-score on the actual content
