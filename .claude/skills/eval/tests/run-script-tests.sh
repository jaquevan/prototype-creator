#!/usr/bin/env bash
# run-script-tests.sh — Quick self-check for the three deterministic scripts.
# Runs each script against its fixture and validates output.
# No framework needed, just node + bash.
#
# Usage: bash .claude/skills/eval/tests/run-script-tests.sh

set -euo pipefail

EVAL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURES="${EVAL_ROOT}/tests/fixtures"
PASS=0
FAIL=0

echo "=== Eval Pipeline Script Tests ==="
echo ""

# ── Test 1: compute-patience-drain.js ──────────────────────────────────
echo "Test 1: compute-patience-drain.js"
TMPDIR=$(mktemp -d)
# Extract persona_results from fixture input
node -e "
  const input = require('${FIXTURES}/case-patience-drain/input.json');
  const expected = require('${FIXTURES}/case-patience-drain/expected.json');
  require('fs').writeFileSync('${TMPDIR}/persona-results.json', JSON.stringify(input.persona_results, null, 2));
"
node "${EVAL_ROOT}/scripts/compute-patience-drain.js" "${TMPDIR}/" > /dev/null 2>&1
RESULT=$(node -e "
  const actual = require('${TMPDIR}/persona-results.json');
  const expected = require('${FIXTURES}/case-patience-drain/expected.json');
  let ok = true;
  for (let i = 0; i < expected.results.length; i++) {
    if (actual[i].patience_end !== expected.results[i].patience_end) {
      console.log('FAIL: ' + actual[i].persona + ' task-' + actual[i].task_index + ': expected ' + expected.results[i].patience_end + ', got ' + actual[i].patience_end);
      ok = false;
    }
  }
  if (ok) console.log('PASS');
")
echo "  ${RESULT}"
if [[ "${RESULT}" == "PASS" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
rm -rf "${TMPDIR}"

# ── Test 2: classify-ac-tier.js ────────────────────────────────────────
echo "Test 2: classify-ac-tier.js"
TMPDIR=$(mktemp -d)
node -e "
  const input = require('${FIXTURES}/case-classify-tier/input.json');
  require('fs').writeFileSync('${TMPDIR}/extract-state.json', JSON.stringify(input.extract_state, null, 2));
  require('fs').writeFileSync('${TMPDIR}/component-map.json', JSON.stringify(input.component_map, null, 2));
"
node "${EVAL_ROOT}/scripts/classify-ac-tier.js" "${TMPDIR}/" > /dev/null 2>&1
RESULT=$(node -e "
  const actual = require('${TMPDIR}/tier-overrides.json');
  const expected = require('${FIXTURES}/case-classify-tier/expected.json');
  const expectedIds = new Set(expected.overrides.map(o => o.criterion_id));
  const actualIds = new Set(actual.map(o => o.criterion_id));
  const missing = [...expectedIds].filter(id => !actualIds.has(id));
  if (missing.length > 0) {
    console.log('FAIL: Missing T1 overrides for: ' + missing.join(', '));
  } else if (actual.some(o => o.forced_tier !== 'T1')) {
    console.log('FAIL: Non-T1 override found');
  } else {
    console.log('PASS');
  }
")
echo "  ${RESULT}"
if [[ "${RESULT}" == "PASS" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
rm -rf "${TMPDIR}"

# ── Test 3: generate-journey-script.js (verify mode) ──────────────────
echo "Test 3: generate-journey-script.js --mode=verify"
TMPDIR=$(mktemp -d)
node -e "
  const input = require('${FIXTURES}/case-journey-gen/input.json');
  require('fs').writeFileSync('${TMPDIR}/extract-state.json', JSON.stringify(input.extract_state, null, 2));
  require('fs').writeFileSync('${TMPDIR}/component-map.json', JSON.stringify(input.component_map, null, 2));
"
node "${EVAL_ROOT}/scripts/generate-journey-script.js" "${TMPDIR}/" --mode=verify > /dev/null 2>&1
RESULT=$(node -e "
  const fs = require('fs');
  const expected = require('${FIXTURES}/case-journey-gen/expected.json');
  const script = fs.readFileSync('${TMPDIR}/journey-test.mjs', 'utf8');
  let ok = true;
  for (const pattern of expected.verify_mode.required_patterns) {
    if (!new RegExp(pattern).test(script)) {
      console.log('FAIL: Missing pattern: ' + pattern);
      ok = false;
      break;
    }
  }
  for (const pattern of expected.verify_mode.forbidden_patterns) {
    if (new RegExp(pattern).test(script)) {
      console.log('FAIL: Found forbidden pattern: ' + pattern);
      ok = false;
      break;
    }
  }
  const funcCount = (script.match(/async function journey_\d+/g) || []).length;
  if (funcCount !== expected.verify_mode.journey_count) {
    console.log('FAIL: Expected ' + expected.verify_mode.journey_count + ' journey functions, found ' + funcCount);
    ok = false;
  }
  if (ok) console.log('PASS');
")
echo "  ${RESULT}"
if [[ "${RESULT}" == "PASS" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

# ── Test 4: Cache hit on re-run ───────────────────────────────────────
echo "Test 4: generate-journey-script.js cache hit"
CACHE_OUTPUT=$(node "${EVAL_ROOT}/scripts/generate-journey-script.js" "${TMPDIR}/" --mode=verify 2>&1)
if echo "${CACHE_OUTPUT}" | grep -q "Cache hit"; then
  echo "  PASS"
  PASS=$((PASS+1))
else
  echo "  FAIL: Second run did not hit cache"
  FAIL=$((FAIL+1))
fi
rm -rf "${TMPDIR}"

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="
exit "${FAIL}"
