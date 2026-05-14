.PHONY: test test-unit test-scripts setup clean context

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

# Fetch context (design system + decision-kit)
context:
	bash scripts/fetch-design-system-context.sh
	bash scripts/bootstrap-decision-kit.sh

# Clean generated artifacts
clean:
	rm -rf .artifacts/ .context/
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# Generate pipeline report
report:
	uv run python3 scripts/generate-report.py
