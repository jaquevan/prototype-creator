# Eval Harness Integration

Per-subskill and pipeline-level evaluation using the [agent-eval-harness](https://github.com/opendatahub-io/agent-eval-harness) plugin.

## Structure

```
eval-harness/
├── configs/                    # eval.yaml per subskill
│   ├── eval-extract.yaml
│   ├── eval-classify.yaml
│   ├── eval-verify.yaml
│   ├── eval-discover.yaml
│   ├── eval-consistency.yaml
│   ├── eval-nav-context.yaml
│   ├── eval-fix.yaml
│   ├── eval-report.yaml
│   ├── eval-review.yaml
│   ├── eval-generate-report.yaml
│   └── eval-iterate.yaml       # pipeline-level (integration test)
├── datasets/                   # test cases per subskill
│   ├── eval-extract/cases/
│   ├── eval-classify/cases/
│   └── ...
├── judges/                     # shared handoff validation judges
│   └── handoff_validators.py
└── README.md
```

## Quick Start

```bash
# Run eval for a specific subskill
/eval-run --config .claude/skills/eval/eval-harness/configs/eval-extract.yaml

# Run the full pipeline eval
/eval-run --config .claude/skills/eval/eval-harness/configs/eval-iterate.yaml
```

## Strategy

Following Roland's per-subskill + pipeline-level approach:

1. **Per-subskill evals** (unit tests) isolate each skill, test with known inputs, judge outputs
2. **Artifact handoff judges** validate data flowing between skills at boundaries
3. **Pipeline-level eval** (integration test) runs eval-iterate end-to-end

## Evaluation Tiers

| Tier | Skills | Prerequisites |
|------|--------|---------------|
| 1 (Foundation) | eval-extract, eval-classify | Jira access, fixtures |
| 2 (Core) | eval-verify, eval-consistency, eval-nav-context, eval-fix | Live prototype |
| 3 (Phase B) | eval-discover, eval-report, eval-review, eval-generate-report | Personas, complete artifacts |
| 4 (Integration) | eval-iterate | All of the above |

## Failure Attribution

Each test case can include `annotations.yaml` with expected values at each pipeline stage. Conditional judges use these to blame the correct subskill when the pipeline fails:

- Extract failed? Check `expected_ac_count` vs actual
- Classify wrong? Check `expected_tiers` vs actual
- Verify wrong? Check `expected_verdicts` vs actual (but only if extract + classify passed)
