.PHONY: test test-unit test-scripts setup clean clean-key context mlflow-smoke mlflow-smoke-all mlflow-poc7

# Run all tests
test:
	uv run pytest tests/ -v --tb=short

# Run only unit tests
test-unit:
	uv run pytest tests/ -v --tb=short -k "not integration and not e2e"

# Run script tests
test-scripts:
	uv run pytest tests/ -v --tb=short -k "test_frontmatter or test_scoring"

# Install dependencies
setup:
	uv sync

# Fetch context (design system + decision-kit + usability testing + consistency checker)
context:
	bash scripts/fetch-design-system-context.sh
	bash scripts/bootstrap-decision-kit.sh
	bash .claude/skills/eval/scripts/bootstrap-usability-testing.sh
	bash .claude/skills/eval/scripts/bootstrap-consistency-checker.sh

# Clean generated artifacts
clean:
	rm -rf .artifacts/ .context/
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# Generate pipeline report
report:
	uv run python3 scripts/generate-report.py

# Publish an evaluation report to GitLab Pages
# Usage: make publish-report KEY=RHAISTRAT-1536
publish-report:
	@if [ -z "$(KEY)" ]; then echo "Usage: make publish-report KEY=RHAISTRAT-1536"; exit 1; fi
	bash .claude/skills/eval/scripts/publish-report.sh .artifacts/$(KEY)/

# Clean artifacts for a single prototype key
# Usage: make clean-key KEY=RHAISTRAT-1742
clean-key:
	@if [ -z "$(KEY)" ]; then echo "Usage: make clean-key KEY=RHAISTRAT-1234"; exit 1; fi
	rm -rf .artifacts/$(KEY)/
	@echo "Cleared .artifacts/$(KEY)/"

# Point shell at POC7 hosted MLflow (run: eval "$(make mlflow-poc7)")
mlflow-poc7:
	@echo 'export MLFLOW_TRACKING_URI=https://mlflow-ux-eval.apps.rosa.uxdpoc7.9hji.p3.openshiftapps.com'
	@echo 'unset MLFLOW_TRACKING_AUTH'

# Log scorers for one prototype into MLFLOW_TRACKING_URI (default local :5000)
# Usage: see mlflow-run-cheatsheet.md
SCORERS ?= pipeline-output
MODEL ?= recommended-mix
mlflow-smoke:
	@if [ -z "$(KEY)" ]; then echo "Usage: make mlflow-smoke KEY=RHAISTRAT-432"; exit 1; fi
	@test -d .artifacts/$(KEY) || (echo "Missing .artifacts/$(KEY)"; exit 1)
	@echo "MLFLOW_TRACKING_URI=$${MLFLOW_TRACKING_URI:-http://127.0.0.1:5000}"
	uv run python3 .claude/skills/eval/scripts/mlflow-trace-eval.py \
		.artifacts/$(KEY)/ \
		--model $(MODEL) \
		--prototype-key $(KEY) \
		--experiment prototype-creator-eval \
		--scorers $(SCORERS) \
		$(if $(SKILLS),--skills $(SKILLS),)

mlflow-smoke-all:
	@$(MAKE) mlflow-smoke KEY=$(KEY) SCORERS=all MODEL=$(MODEL) SKILLS="$(SKILLS)"
