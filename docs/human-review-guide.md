# Human Review Guide

After the CI pipeline generates prototypes, humans review and refine them in a local workspace that doesn't interfere with CI.

## Quick Start

```bash
# Pull a prototype into your local workspace
/prototype.pull PROJ-298

# Review it locally
/prototype.review

# Refine based on review feedback
/prototype.refine

# Push back to CI when satisfied
/prototype.push PROJ-298
```

## Directory Layout

```
local/
├── prototypes/           # Pulled prototypes
│   └── PROJ-298/
│       ├── index.html
│       └── metadata.json
├── prototype-reviews/    # Review scores and feedback
├── prototype-originals/  # Original RFE snapshots (read-only reference)
└── decisions/            # Design decisions made during creation
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
/prototype.pull PROJ-298          # Get it locally
# Open local/prototypes/PROJ-298/index.html in your browser
# Read local/prototype-reviews/PROJ-298-summary.md for the review
/prototype.submit PROJ-298        # Publish it
```

### Path 2: Needs Attention

The prototype has issues flagged by the reviewers. Fix them, then push back.

```bash
/prototype.pull PROJ-298          # Get it locally
# Read the review summary to understand what needs fixing
/prototype.refine                  # AI helps fix the issues
/prototype.review                  # Re-score locally
# If passing now:
/prototype.push PROJ-298          # Send back to CI
# Then: /prototype.submit PROJ-298
```

## Local Mode Auto-Detection

Skills detect when files are in `local/` and adjust behavior:
- Jira label writes are skipped
- Pipeline label gates are skipped
- All reads and writes target `local/` instead of `artifacts/`

## Editing Prototypes Manually

Prototypes are just HTML files. You can edit them directly:

1. Open `local/prototypes/{ID}/index.html` in your editor
2. Make changes
3. View in browser to verify
4. Run `/prototype.review` to re-score

## Decide Mode in Local Review

If you want to reconsider design decisions:

```bash
/prototype.create PROJ-298 --mode=decide --fidelity=medium
```

This re-runs creation in decide mode, surfacing each design decision for your judgment. Previous decisions from `local/decisions/` are shown as defaults.

## Tips

- Always read the review summary before refining
- Focus on the dimensions that scored 0 or 1 first
- The completeness dimension is the most important — a beautiful prototype that doesn't address the RFE is useless
- For usability issues, the review file lists specific heuristic violations with recommendations
- You can edit the prototype HTML directly; the review will re-score on the actual content
