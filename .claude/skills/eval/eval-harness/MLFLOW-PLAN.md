# MLflow Integration Plan

**Status:** Planning (execute Monday)
**Plan reference:** `/Users/ejaquez/.cursor/plans/p0-p2_fixes_+_mlflow_plan_527820a2.plan.md`

## Why MLflow

The eval harness (agent-eval-harness v1.4.0) already has full MLflow support built in -- `log_results.py`, `attach_feedback.py`, `from_traces.py`, `sync_dataset.py` are all implemented but not wired up. The `mlflow:` blocks are already in all 11 eval configs (`experiment: prototype-creator-eval`). We just need to start the server.

## What it gives us

1. **Experiment comparison**: Side-by-side run comparison across models/versions with auto-logged metrics. No more manually reading `run-log.json`.
2. **Trace visualization**: See tool calls, subagent spans, token usage per-step. Answers "where did the cost go?"
3. **Designer feedback loop**: Designers annotate runs in the MLflow UI. `attach_feedback.py --action pull` brings annotations into `review.yaml`, which `/eval-optimize` consumes for skill improvements.
4. **Dataset versioning**: Track which test cases were used for each run, detect when cases change.
5. **Cost trending**: Per-model token usage over time shows whether Sonnet is cheaper without quality loss.

## Monday Setup Steps

### 1. Install MLflow (5 min)

```bash
pip install mlflow
```

### 2. Start tracking server (2 min)

```bash
# SQLite backend for local use (no Postgres needed)
mlflow server \
  --backend-store-uri sqlite:///mlflow.db \
  --default-artifact-root ./mlruns \
  --port 5000

# Or simpler: just set the tracking URI to a local directory
export MLFLOW_TRACKING_URI=sqlite:///mlflow.db
```

### 3. Verify config blocks (already done)

All 11 configs have:
```yaml
mlflow:
  experiment: prototype-creator-eval
```

### 4. Run a baseline eval with MLflow logging

```bash
/eval-run --config .claude/skills/eval/eval-harness/configs/eval-classify.yaml
```

After the run, `log_results.py` auto-pushes to MLflow:
- Judge scores (pass_rate, mean)
- Run metadata (model, duration, cost)
- Per-case traces with tool calls

### 5. Verify in MLflow UI

Open `http://localhost:5000` and check:
- Experiment "prototype-creator-eval" exists
- Run appears with metrics
- Traces show tool call spans

## What to track per run

| Metric | Source | Type |
|--------|--------|------|
| ac_pass_count | evaluation-report.csv | integer |
| ac_fail_count | evaluation-report.csv | integer |
| ac_flagged_count | evaluation-report.csv | integer |
| usability_score | journey-log.json usability_dimensions | float |
| consistency_violations | consistency-report.json | integer |
| consistency_warnings | consistency-report.json | integer |
| screenshot_coverage_journey | journey-log.json | float (0-1) |
| screenshot_coverage_persona | persona-results.json | float (0-1) |
| pipeline_duration_min | eval-state.yaml | float |
| estimated_tokens | run-metrics.json | integer |
| ground_truth_match | manual annotation | boolean |

## Future: Production tracing

Use `claude-trace` CLI wrapper for real designer sessions:
```bash
claude-trace --experiment production-runs -- /eval-iterate RHAISTRAT-XXXX http://localhost:8080
```

This pushes traces to MLflow for cost/token analysis without the eval harness overhead. Combined with `from_traces.py`, production runs can seed new test cases organically.

## Future: Designer feedback flow

```
Designer reviews report → annotates in MLflow UI → pull feedback →
  /eval-optimize reads feedback → edits SKILL.md → re-runs → compares
```

This closes the loop between designer judgment and skill improvement.

## Dependencies

- Python 3.10+
- `pip install mlflow` (no other deps needed for local SQLite mode)
- VPN not required (local server)
- Estimated disk: ~50MB for SQLite + runs
