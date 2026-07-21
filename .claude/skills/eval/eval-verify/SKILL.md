---
name: eval-verify
description: Run Playwright walkthroughs against the live prototype in x-ray mode (Phase A, fast AC verification).
user-invocable: false
allowed-tools: Read, Write, Bash, Glob, Grep
---

# eval-verify

Executes Playwright walkthroughs for each journey defined by eval-extract. Operates in **x-ray mode** (Phase A only) — full workspace source access for fast AC verification. Persona-driven discovery walkthroughs are handled separately by `eval-discover` (Phase B).

## Inputs

| Input | Description | Required |
|-------|-------------|----------|
| `.artifacts/<KEY>/extract-state.json` | Journey definitions, persona selection, AC list | Yes |
| `.artifacts/<KEY>/evaluation-report.csv` | Tier-classified ACs from eval-classify (Section 1 with tiers, no verdicts) | Yes |
| `.artifacts/<KEY>/mr-delta.json` | Changed files (for nav gap detection) | No |
| Prototype URL | Live URL to test against (e.g., `http://localhost:4200`) | Yes |
| `--rerun-only` | Comma-separated AC IDs — only run journeys testing these ACs | No |
| `--capture-only` | Re-capture screenshots without changing verdicts | No |
| `--all-journeys` | Run all journeys (not just rerun set) | No |
| `tests/fixtures/manifest.json` | Test fixtures for file uploads and chat input | No |

## Outputs

| File | Description |
|------|-------------|
| `.artifacts/<KEY>/journey-log.json` | Full Playwright step log with actions, results, screenshots |
| `.artifacts/<KEY>/journey-test.mjs` | Generated Playwright script (kept for re-runs) |
| `.artifacts/<KEY>/screenshots/` | Journey step screenshots |
| `.artifacts/<KEY>/evaluation-report.csv` | Updated Section 1 with verdicts (PASS/FAIL/FLAGGED per AC) |
| `.artifacts/<KEY>/refinement-suggestions.json` | FAIL criteria fix suggestions |

## X-Ray Mode

The x-ray evaluator has full workspace access and uses it for speed. The goal is to verify acceptance criteria as fast as possible, not to test discoverability.

- Read workspace source files directly for selectors, routes, and page structure
- Use `page.goto` freely for navigation (speed over realism)
- Use CSS selectors from source code to locate elements
- No brute-force expansion, no persona simulation, no exploration phase
- Screenshots are evidence of PASS/FAIL only

```javascript
// Generated script MUST start with this setup:
const browser = await firefox.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 900 } });
const page = await context.newPage();

// Ensure "All projects" is selected (prototypes often default to an empty project)
async function ensureAllProjects(page) {
  const dropdown = page.locator('.pf-v6-c-menu-toggle, [data-testid="project-selector"]').first();
  if (await dropdown.isVisible({ timeout: 2000 }).catch(() => false)) {
    const currentText = await dropdown.textContent().catch(() => '');
    if (!currentText.includes('All projects')) {
      await dropdown.click();
      const allOpt = page.locator('text=All projects').first();
      if (await allOpt.isVisible({ timeout: 2000 }).catch(() => false)) {
        await allOpt.click();
        await page.waitForTimeout(1000);
      }
    }
  }
}

async function navigateInformed(page, route, selector) {
  await page.goto(`${baseUrl}${route}`);
  await page.waitForLoadState('domcontentloaded');
  if (selector) {
    await page.waitForSelector(selector, { timeout: 5000 }).catch(() => null);
  }
  await page.waitForTimeout(1000);
}
```

## Visual Truth Rule

Even in x-ray mode, the Playwright visual result is the SOURCE OF TRUTH for verdict assignment. This single rule resolves all verdict conflicts:

- **If Playwright shows it working → PASS** (screenshot proves it)
- **If Playwright shows empty/broken/missing → FAIL** (regardless of what source code says)
- Source code analysis can NEVER upgrade a visual FAIL to PASS
- If all screenshots show the same state, the feature was NOT demonstrated

The x-ray evaluator has code access for NAVIGATION speed, not for verdict override.

## Procedure

### Step 1: Setup Playwright

```bash
EVAL_SKILL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd || echo ".claude/skills/eval")"
if ! npx playwright --version >/dev/null 2>&1; then
  cd "$EVAL_SKILL_ROOT"
  npm install
  npx playwright install chromium firefox
  cd -
else
  echo "Playwright already installed, skipping setup"
fi
```

**ESM module resolution:** The `playwright` package is installed in `.claude/skills/eval/node_modules/`. A committed symlink at the project root (`node_modules -> .claude/skills/eval/node_modules`) lets ESM `import` resolve `playwright` from scripts anywhere in the project tree. If the symlink is missing (e.g. checkout didn't preserve it), the eval-iterate setup step recreates it. Without this symlink, all `.mjs` scripts fail with `ERR_MODULE_NOT_FOUND`.

**Browser selection:** Use Firefox by default (more reliable CSS rendering for PatternFly expandable components). Fall back to Chromium if Firefox is not installed.

```javascript
import { firefox } from 'playwright';
const browser = await firefox.launch({ headless: true });
// MANDATORY: 1920x900 viewport. Default 800x600 truncates table columns. 1440 is insufficient for tables with 10+ columns (e.g., Kueue scheduling adds Queue + Scheduling + expand toggle).
const context = await browser.newContext({ viewport: { width: 1920, height: 900 } });
const page = await context.newPage();
```

**Viewport validation:** After generating `journey-test.mjs`, verify the script contains `viewport` before running it:
```bash
grep -q "viewport" .artifacts/<KEY>/journey-test.mjs || { echo "FATAL: Generated script missing viewport. Regenerate."; exit 1; }
```

### Step 2: Prepare screenshots directory and capture baseline

```bash
rm -rf .artifacts/<KEY>/screenshots
mkdir -p .artifacts/<KEY>/screenshots
```

On re-iterations with `--rerun-only`, only clear screenshots for re-run journeys (preserve PASS journey screenshots).

**Baseline screenshot (before any evaluation or fixes):** On iteration 1 only, navigate to the **primary page being tested** (not the homepage) and capture a screenshot as the "before" state.

Determine the primary page from `extract-state.json > journey_definitions` — find the route most journeys target:

```javascript
// Find the primary test page from journey definitions
const journeys = extractState.journey_definitions || [];
const firstSteps = journeys.map(j => (j.expected_path || [])[0]).filter(Boolean);
// Note: component-map.json may not exist yet on iteration 1. If not, infer the
// primary route from journey_definitions expected_path or from the Jira ticket's
// feature context (e.g., "Model Deployments Overview" → /ai-hub/models/deployments).
const primaryRoute = componentMap ? componentMap.target_page : inferPrimaryRoute(firstSteps);

// PAIRED with eval-discover Step 7b (baseline-after.png).
// Both captures MUST use identical addInitScript setup so the only
// visual difference is actual code changes, not browser state drift.
const context = await browser.newContext({ viewport: { width: 1920, height: 900 } });
const page = await context.newPage();
await page.addInitScript(() => {
  try { localStorage.setItem('selectedProject', JSON.stringify('All projects')); } catch {}
  try {
    const flags = JSON.parse(localStorage.getItem('featureFlags') || '{}');
    flags._lastModified = new Date().toISOString();
    localStorage.setItem('featureFlags', JSON.stringify(flags));
  } catch {}
});
await page.goto(`${baseUrl}${primaryRoute || ''}`);
await page.waitForSelector('tbody tr', { timeout: 8000 }).catch(() => null);
await page.waitForTimeout(2000);
await page.screenshot({ path: '.artifacts/<KEY>/screenshots/baseline-before.png', fullPage: false });
await context.close();
```

**If the page is still empty after content wait**, capture it anyway — it may indicate a build issue that the report should show. Do NOT use `ensureAllProjects()` here — the click-based approach opens a dropdown that can cover data rows. The `addInitScript` pre-seeding handles project selection before React mounts.

This baseline captures the prototype's main feature page before eval-fix applies any changes. It's used in the report's Fix History tab and Summary section for before/after comparison.

**Optimization:** The report's `buildBaselineComparison()` only renders the before/after when fixes were applied (`appliedFixes.length > 0`). If iteration 1 produces 0 FAILs and the fix loop will not run, the baseline-before screenshot is captured but never displayed. This is acceptable overhead (~2s) as the eval doesn't know at capture time whether fixes will be needed. The paired `baseline-after.png` (captured in eval-discover Step 7b) should be skipped if no fix loop ran — check `iteration-log.json` or `fix-log.json` existence before capturing.

### Step 2b: Source pre-scan — write component-map.json

**Before generating any Playwright script**, read the target component files from `mr-delta.json` and write a structured JSON file that the script generator MUST reference.

Read workspace source files (`modified_files` and `new_files` from `mr-delta.json`) and extract:

- **target_page**: The route where the feature lives (e.g., `/ai-hub/models/deployments`)
- **table_columns**: Actual `<Th>` labels or column config array values in order
- **ac_column_mapping**: For each AC, which column it actually maps to (AC text may say "Status column" but the feature is in "Scheduling")
- **interactive_elements**: Tooltips (`<Tooltip content=`), expandable rows (`<Tr isExpanded`), popovers, modals — with the component that wraps them
- **feature_flags**: Conditional rendering gates and what they show/hide
- **status_values**: Actual string values that appear as labels (from mock data or enums)

Write to `.artifacts/<KEY>/component-map.json`:

```json
{
  "target_page": "/ai-hub/models/deployments",
  "table_columns": ["Model deployment name", "Project", "Serving runtime", "Inference endpoints", "API protocol", "Last deployed", "Status", "Queue", "Scheduling"],
  "ac_column_mapping": {
    "AC-1": { "column": "Scheduling", "index": 8, "reason": "AC says Status column but Kueue states are in Scheduling" },
    "AC-6": { "interaction": "hover", "target": "Label in Scheduling column", "tooltip_wrapper": "Tooltip", "expected_content": "GPU, CPU, Memory" }
  },
  "feature_flags": { "kueueEnabled": "gates columns Queue + Scheduling + expandable row" },
  "status_values": ["Admitted", "Pending", "Running", "Suspended", "Scaling", "Unmanaged"],
  "interactive_elements": {
    "tooltips": [{ "wraps": "Label in Scheduling", "content": "resourceTooltip" }],
    "expandable_rows": [{ "content": "Queue Details, Resource Allocation, Timing" }]
  }
}
```

**The Playwright script generator in Step 3 MUST read `component-map.json` and use its data for:**
- Column indices (never guess from AC text — use `ac_column_mapping`)
- Interaction types (hover vs click — use `interactive_elements`)
- Expected values (use `status_values` to know what to look for)
- Target page route (use `target_page` for navigation)

**Validation:** If `component-map.json` does not exist when Step 3 starts, STOP and go back to Step 2b. Do not generate a script without a component map.

### Step 3: Generate and run Playwright script

Generate `.artifacts/<KEY>/journey-test.mjs` using the component map from Step 2b and the PF6 script template below.

**Journey skip check (when `--rerun-only` set):** For each journey, check if ANY of its `ac_ids` are in `--rerun-only`. If none are, skip the journey — carry forward its previous `journey-log.json` entry and screenshots.

#### Journey Completeness Rule

The generated script MUST contain:
- **One journey function for EVERY entry** in `extract-state.json > journey_definitions`
- Each function MUST test the specific AC IDs listed in that journey's `ac_ids` array
- Each function MUST produce a verdict (PASS/FAIL) and log steps

Verify before running: `journey_count_in_script == len(extract-state.journey_definitions)`

#### Visual Differentiation Rule (MANDATORY)

**Each journey MUST produce a screenshot showing a UNIQUE visual state.** Never screenshot the same default table view for multiple journeys. Before capturing the final screenshot, each journey must perform at least one interaction that visibly changes the page:

| AC type | Required interaction before screenshot |
|---|---|
| Feature visibility (columns, labels) | Default table view is acceptable for ONE journey only |
| Tooltip content ("hover over X") | `page.hover()` → screenshot WITH tooltip visible on screen |
| Expandable row ("details", "resource info") | Click expand toggle → screenshot showing expanded content |
| Feature absence ("when disabled", "no indicators") | Source verification → FLAGGED (can't toggle in prototype) |
| Error absence ("no errors", "graceful degradation") | Check DOM for errors → screenshot (can share default view if no errors) |
| Unmanaged/alternative state | Scroll to or highlight the specific row showing different state |
| Multiple resource types | Expand a row showing the specific type, or navigate to a detail view |

**Enforcement:** After generating the script, verify that no two journey functions produce screenshots at the same page state. If journeys 1, 3, and 4 all just call `navigateToDeployments()` and screenshot the same table, the script is INVALID — add interactions (hover, expand, scroll) to differentiate them.

#### PF6 Script Template

Use this tested template as the BASE of every generated `journey-test.mjs`. The agent fills in the journey-specific logic — do NOT write the boilerplate from scratch.

```javascript
import { firefox } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const BASE_URL = '<prototype-url>';
const ARTIFACTS = '.artifacts/<KEY>';
const SCREENSHOTS = `${ARTIFACTS}/screenshots`;
const componentMap = JSON.parse(readFileSync(`${ARTIFACTS}/component-map.json`, 'utf8'));

mkdirSync(SCREENSHOTS, { recursive: true });

const browser = await firefox.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 900 } });
const page = await context.newPage();

// --- PF6 UTILITIES (tested, do not modify) ---

// Pre-set project to "All projects" before React loads
await page.addInitScript(() => {
  try { localStorage.setItem('selectedProject', JSON.stringify('All projects')); } catch {}
});

async function navigateTo(route) {
  await page.goto(`${BASE_URL}${route}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  // Verify data loaded
  await page.waitForSelector('tbody tr', { timeout: 8000 }).catch(() => null);
}

async function expandRow(rowText) {
  const row = page.locator('tbody tr').filter({ hasText: rowText }).first();
  const toggle = row.locator('td:first-child button').first();
  if (await toggle.isVisible({ timeout: 2000 }).catch(() => false)) {
    await toggle.click();
    await page.waitForTimeout(800);
  }
}

async function hoverElement(selector) {
  const el = page.locator(selector).first();
  if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
    await el.hover();
    await page.waitForTimeout(600);
  }
}

async function getTooltipText() {
  const tooltip = page.locator('.pf-v6-c-tooltip__content').first();
  if (await tooltip.isVisible({ timeout: 2000 }).catch(() => false)) {
    return await tooltip.textContent();
  }
  return null;
}

async function getColumnHeaders() {
  return await page.locator('thead th').allTextContents();
}

async function checkNoErrors() {
  const errors = await page.locator('.pf-v6-c-alert--danger, [role="alert"]').count();
  const bodyText = await page.locator('body').textContent().catch(() => '');
  return errors === 0 && !bodyText.includes('403') && !bodyText.includes('Forbidden');
}

async function screenshot(name) {
  await page.screenshot({ path: `${SCREENSHOTS}/${name}`, fullPage: false });
}

// --- JOURNEYS (agent fills these in using component-map.json) ---

// EXAMPLE journey showing visual differentiation:
// Journey for tooltip AC: navigate → hover over element → screenshot WITH tooltip
// Journey for expand AC: navigate → click expand → screenshot WITH expanded content
// Journey for absence AC: navigate → verify no elements → screenshot (FLAGGED if can't toggle)

// <AGENT FILLS IN JOURNEY FUNCTIONS HERE>
// Each journey function MUST:
// 1. Call navigateTo(componentMap.target_page)
// 2. Perform a UNIQUE interaction (hover, expand, scroll, filter)
// 3. Call screenshot('journey-N-final.png') AFTER the interaction
// 4. Return { id, title, ac_ids, verdict, steps }

// --- MAIN ---
async function main() {
  await navigateTo(componentMap.target_page);
  await screenshot('baseline-before.png');

  // <AGENT CALLS EACH JOURNEY FUNCTION HERE>

  await browser.close();

  // Write results to journey artifacts
  writeFileSync(`${ARTIFACTS}/journey-results.json`, JSON.stringify(results, null, 2));
}

main().catch(console.error);
```

**The agent's job:** Read `component-map.json`, then for each journey, write a function body that:
1. Navigates to the target page (already done by the template)
2. Performs the AC-specific interaction (hover, expand, scroll, check absence)
3. Captures a screenshot AFTER the interaction
4. Records the verdict

Do NOT rewrite the utilities. Do NOT change the browser/context setup. Only fill in the journey functions.

#### Journey Step Relevance Rule

Every step MUST be necessary to verify the AC. If an AC describes a disabled/alternative state (e.g., "when Kueue is not enabled"):
- Verify the conditional rendering exists in source code
- Mark the journey **FLAGGED** — cannot visually verify disabled state in this prototype

#### Verdict Assignment

**FAIL means the feature is missing or broken.** Use FAIL when the UI element, page, or flow does not exist, is broken, or is orphaned (reachable only via direct URL).

**FLAGGED means the evaluator cannot make a confident judgment.** Use FLAGGED ONLY for: external reference comparisons (T2), subjective quality judgments (T4), or genuine ambiguity. NEVER flag what should be FAIL.

**T3 criteria (backend-only):** Pre-assigned PASS at classify time. Do not generate journey steps for T3 ACs.

**For ACs classified T1 that mention backend concepts:** Evaluate by UI manifestation only. If the UI demonstrates the feature, it's PASS — the backend portion is noted but irrelevant to the verdict. The prototype's job is to demonstrate UX, not implement backends.

| Situation | Verdict |
|---|---|
| UI feature exists and works visually | PASS |
| UI feature missing or broken | FAIL |
| Needs external reference, unavailable | FLAGGED |
| Backend-only, no UI surface (T3) | PASS (pre-assigned) |
| Subjective quality judgment (T4) | FLAGGED |
| Source code confirms but screenshot shows nothing | FAIL |
| AC describes absent/disabled state AND current UI matches | PASS |
| No errors/403s on page when AC tests graceful degradation | PASS |

**Default-state ACs:** If an AC describes what should happen when a feature is absent or disabled (e.g., "no Kueue indicators when disabled", "normal status with no Kueue indicators", "no error indicators"), and the current prototype state matches that description, the verdict is **PASS** — not FLAGGED. The AC is satisfied by the current visible state. Only FLAG if the AC requires demonstrating a STATE TRANSITION (enabled → disabled) that the prototype can't toggle.

**Example:** AC-3 says "InferenceService with no associated Workload CR displays normal KServe-derived status with no Kueue indicators." If the table has rows showing "Unmanaged" with standard status and no Kueue columns for that row, that IS the AC being satisfied — PASS, not FLAGGED.

Run the script:
```bash
node .artifacts/<KEY>/journey-test.mjs
```

### Step 4: Screenshot and visual verification

**One screenshot per AC.** eval-verify captures only the final verification state for each AC — not multi-step navigation screenshots. Persona walkthroughs (eval-discover) provide the detailed step-by-step visual evidence.

**Naming:** `screenshots/journey-{N}-final.png` (one per journey, capturing the post-verification state)

**Wait for CONTENT, not containers:**

```javascript
async function captureVerification(page, filepath, waitForSelector) {
  if (waitForSelector) {
    await page.waitForSelector(waitForSelector, { timeout: 8000 }).catch(() => null);
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: filepath, fullPage: false });
}
```

Wait selector rules: tables → `tbody tr`, lists → `ul li`, forms → input/label, page nav → primary heading.

**Verify VISUAL presence, not just DOM presence.** Always use `.isVisible()`:

```javascript
const elements = page.locator('tbody tr');
const domCount = await elements.count();
const firstVisible = domCount > 0 && await elements.first().isVisible().catch(() => false);
const result = (domCount > 0 && firstVisible) ? 'success' : 'fail';
```

Never use `page.evaluate()` or `.textContent()` alone as proof — PatternFly's `<Tr isExpanded={false}>` renders rows with zero height that have text but are invisible.

**Screenshot budget:** `baseline-before.png` + 1 per AC = typically 8-10 total screenshots for eval-verify. This is significantly fewer than the 15+ persona screenshots from eval-discover.

### Step 5: Determine final verdicts and write to BOTH CSV and journey-log

**CRITICAL: The CSV is the source of truth for the report.** The report renders verdicts from the CSV, not the journey-log. If the CSV says FAIL but journey-log says PASS, the report shows FAIL.

**Verdict determination flow (do NOT write to CSV until all judgment is complete):**

1. Run Playwright script → collect raw results (element found/not found, visible/invisible)
2. Apply ALL verdict rules to the raw results:
   - Visual Truth Rule (screenshots show it working → PASS)
   - Default-state ACs (visible state matches AC description → PASS)
   - Source analysis (component-map confirms feature exists → informs verdict)
   - Error/RBAC detection (no errors on page → PASS for graceful degradation ACs)
3. Produce a FINAL verdict per AC — this is the verdict AFTER judgment, not the raw Playwright result
4. Write the FINAL verdict to BOTH:
   - `evaluation-report.csv` Section 1 (verdicts, rationale, evidence columns)
   - `journey-log.json` journey verdict fields
5. **Both files MUST have identical verdicts for every AC.** If you write PASS to journey-log, you MUST also write PASS to the CSV.

**NEVER write raw Playwright results to the CSV.** The CSV gets the final judged verdict only. If Playwright selectors timed out but screenshots show the feature working, the verdict is PASS (Visual Truth Rule) — and PASS goes to both files.

**AC verdict precedence (applied AFTER all judgment rules):**
1. Journey AC-critical steps ALL passed (visually confirmed) → **PASS**
2. Any AC-critical step FAILED (visually confirmed missing/broken) → **FAIL**
3. No journey tested this AC → **FAIL** ("coverage gap")

**BLOCKING CROSS-CHECK:** After writing both files, verify they are consistent:

```bash
node .claude/skills/eval/scripts/validate-verdicts.js .artifacts/<KEY>/
```

If violations found (any AC has different verdicts in CSV vs journey-log), fix BOTH files to match before proceeding.

### Step 6: Verify AC Coverage (BLOCKING)

Verify every AC has a non-empty verdict:

1. Read `extract-state.json > ac_list` — get all `criterion_id` values
2. Read `journey-log.json > journeys[].ac_ids` — collect all tested AC IDs
3. Any untested T1 AC → assign FAIL ("coverage gap")
4. Any untested T3 → should already have PASS from classify
5. Any untested T4 → assign FLAGGED ("needs human judgment")

**This step is BLOCKING** — do not proceed until every AC has a verdict.

### Step 7: Write journey-log.json

The output MUST match this exact schema. `render-report.js` reads these specific field names.

```json
{
  "depth": "deep",
  "prototype_url": "http://localhost:9000",
  "evaluated_at": "2026-06-25T14:30:00Z",
  "journeys": [
    {
      "id": "journey-1",
      "title": "View Kueue Scheduling Status on Model Deployments",
      "persona": "Platform Operator",
      "source": "Inferred from AC-1: Given Kueue is enabled...",
      "ac_ids": ["AC-1", "AC-4"],
      "verdict": "PASS",
      "steps_expected": 4,
      "steps_completed": 3,
      "steps": [
        {
          "step": 1,
          "action": "navigate",
          "target": "AI Hub > Models > Deployments",
          "result": "success",
          "timestamp_ms": 0,
          "screenshot": "screenshots/journey-1-step-1.png",
          "narration": "Navigated to Model Deployments overview. Table shows 6 rows with Kueue status labels."
        }
      ]
    }
  ]
}
```

**FORMAT RULES (render-report.js breaks without these):**
- `journey.id` = `"journey-N"` format
- `steps_completed` and `steps_expected` present (integers)
- `source` present (string referencing AC or user story)
- Every step has ALL of: `step` (number), `action`, `target`, `result` ("success" or "fail"), `screenshot` (relative path), `narration` (designer-readable)
- Screenshot files MUST exist at referenced paths

### Step 8: Generate refinement suggestions for FAILs

For each FAIL verdict, write to `.artifacts/<KEY>/refinement-suggestions.json`:

```json
{
  "type": "ac_failure",
  "criterion_id": "AC-3",
  "criterion_text": "<verbatim AC>",
  "verdict": "FAIL",
  "rationale": "<why it failed>",
  "fix_action": "<suggested fix>",
  "fix_file": "<likely file to change>",
  "confidence": "high"
}
```

## Rules

- In x-ray mode, `page.goto` is fine for navigation speed — but a step that ONLY works via `page.goto` (no click path exists) is still FAIL (orphaned page)
- If ALL journeys fail at step 1 (entry point unreachable), report "prototype unreachable" and exit
- Use `domcontentloaded` + explicit waits for SPAs (not `networkidle`)
- Modals/drawers are valid parts of a flow — continue the journey within them
- Post-action waits before screenshots (500ms minimum after state changes)

### Locator Strategy Hierarchy

Prefer strategies higher in this list:

1. **data-testid:** `page.locator('[data-testid="deploy-agent-btn"]')`
2. **Role + name:** `page.getByRole('button', { name: 'Deploy agent' })`
3. **Row-scoped:** `page.locator('tr').filter({ hasText: 'my-agent' }).locator('button')`
4. **Text content:** `page.getByText('Deploy agent', { exact: true })`
5. **CSS class (PF-prefixed):** `page.locator('.pf-v6-c-button.pf-m-primary')`
6. **Element ID (last resort):** `page.locator('#deploy-btn')`

For tables/lists, ALWAYS scope to the target row first. On timeout, try the next strategy before failing.
