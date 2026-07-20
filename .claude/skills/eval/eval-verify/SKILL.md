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
| `--capture-only` | Re-walk journeys and capture screenshots without modifying verdicts or the CSV | No |
| `--all-journeys` | Run all journeys regardless of `--rerun-only` filter | No |
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

Use the browser setup from the **PF6 Script Template** section below (Firefox, viewport `1920x900`, `addInitScript` for localStorage pre-seeding, `navigateTo` for route navigation).

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

**Browser selection:** Use Firefox by default (more reliable CSS rendering for PatternFly expandable components). Fall back to Chromium if Firefox is not installed.

Use the browser setup from the **PF6 Script Template** section below. MANDATORY: 1920x900 viewport — default 800x600 truncates table columns, 1440 is insufficient for tables with 10+ columns.

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
// Use the browser/context/addInitScript setup from the PF6 Script Template section below.

await page.goto(`${baseUrl}${primaryRoute || ''}`);
const readySelector = componentMap?.content_ready_selector || 'body';
await page.waitForSelector(readySelector, { timeout: 8000 }).catch(() => null);
await page.waitForTimeout(2000);
await page.screenshot({ path: '.artifacts/<KEY>/screenshots/baseline-before.png', fullPage: false });
await context.close();
```

**If the page is still empty after content wait**, capture it anyway — it may indicate a build issue that the report should show. Do NOT use click-based project selection here — it opens a dropdown that can cover data rows. The `addInitScript` pre-seeding handles project selection before React mounts.

This baseline captures the prototype's main feature page before eval-fix applies any changes. It's used in the report's Fix History tab and Summary section for before/after comparison.

**Optimization:** The report's `buildBaselineComparison()` only renders the before/after when fixes were applied (`appliedFixes.length > 0`). If iteration 1 produces 0 FAILs and the fix loop will not run, the baseline-before screenshot is captured but never displayed. This is acceptable overhead (~2s) as the eval doesn't know at capture time whether fixes will be needed. The paired `baseline-after.png` (captured in eval-discover Step 7b) should be skipped if no fix loop ran — check `iteration-log.json` or `fix-log.json` existence before capturing.

### Step 2b: Source pre-scan — write component-map.json

**Before generating any Playwright script**, read the target component files from `mr-delta.json` and write a structured JSON file that the script generator MUST reference.

Read workspace source files and identify the UI type. Write a component-map.json with the appropriate schema for that UI type. The script generator reads `ui_type` to select the right interaction pool builder and `content_ready_selector` for page-load waits.

#### Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ui_type` | `"table"` \| `"form"` \| `"wizard"` \| `"dashboard"` \| `"mixed"` | Yes | Discriminator — determines which interaction pool builder and utilities the script generator uses |
| `target_page` | string | Yes | Route where the feature lives |
| `content_ready_selector` | string | Yes | What selector indicates page content has loaded |
| `table_columns` | string[] | Table only | Column header labels in order |
| `ac_element_mapping` | object | Yes | Maps each AC to the element it tests (selector + interaction_type) |
| `data_entries` | array | Yes | Generic array of visible data items (rows, cards, list items) |
| `interactive_elements` | array | Yes | Array of interactive components with type, selector, trigger |
| `initialization` | object | Yes | Pre-seed config: `local_storage`, `feature_flags`, `url_params` |
| `status_values` | array | No | Status indicators with value, selector, and optional label |

**`content_ready_selector` by UI type:**
- Table: `tbody tr`
- Form: `form input, form .pf-v6-c-form__group`
- Wizard: `.pf-v6-c-wizard__step-content`
- Dashboard: `.pf-v6-c-card`

**`interactive_elements[].type` values:** `tooltip`, `expandable_row`, `dropdown`, `toggle`, `modal`, `tab`, `accordion`, `checkbox`, `radio`, `text_input`, `select`, `slider`, `switch`, `link`, `popover`

#### Example 1: Table (deployment scheduling)

```json
{
  "ui_type": "table",
  "target_page": "/ai-hub/models/deployments",
  "content_ready_selector": "tbody tr",
  "table_columns": ["Name", "Project", "Status", "Queue", "Scheduling"],
  "ac_element_mapping": {
    "AC-1": { "selector": "thead th:nth-child(8)", "interaction_type": "verify_visible", "description": "Queue column header" },
    "AC-6": { "selector": ".scheduling-label", "interaction_type": "hover", "expected_content": "resource allocation details" }
  },
  "data_entries": [
    { "name": "Llama-3.1-8B", "selector": "tr:has-text('Llama-3.1-8B')", "properties": { "has_expandable": true } },
    { "name": "Granite-3B", "selector": "tr:has-text('Granite-3B')" }
  ],
  "interactive_elements": [
    { "type": "tooltip", "selector": ".pf-v6-c-tooltip__content", "trigger_selector": ".scheduling-label", "expected_content": "GPU, CPU, Memory" },
    { "type": "expandable_row", "selector": ".pf-v6-c-table__expandable-row-content", "trigger_selector": "td:first-child button" }
  ],
  "initialization": {
    "local_storage": { "selectedProject": "\"All projects\"" }
  },
  "status_values": [
    { "value": "Admitted", "selector": "[data-status='admitted']" },
    { "value": "Pending", "selector": "[data-status='pending']" }
  ]
}
```

#### Example 2: Form (role creation)

```json
{
  "ui_type": "form",
  "target_page": "/settings/roles/create",
  "content_ready_selector": "form .pf-v6-c-form__group",
  "ac_element_mapping": {
    "AC-1": { "selector": "#role-name-input", "interaction_type": "fill", "test_value": "Custom Admin" },
    "AC-2": { "selector": ".permission-checkboxes input[type='checkbox']", "interaction_type": "check", "description": "Permission checkboxes" },
    "AC-3": { "selector": "button[type='submit']", "interaction_type": "click", "description": "Submit button" }
  },
  "data_entries": [],
  "interactive_elements": [
    { "type": "text_input", "selector": "#role-name-input", "trigger_selector": null },
    { "type": "checkbox", "selector": ".permission-checkboxes input", "trigger_selector": null },
    { "type": "dropdown", "selector": ".pf-v6-c-select", "trigger_selector": ".pf-v6-c-select__toggle" },
    { "type": "modal", "selector": ".pf-v6-c-modal-box", "trigger_selector": "button:has-text('Confirm')" }
  ],
  "initialization": {},
  "status_values": []
}
```

#### Example 3: Wizard (multi-step creation)

```json
{
  "ui_type": "wizard",
  "target_page": "/pipelines/create",
  "content_ready_selector": ".pf-v6-c-wizard__step-content",
  "ac_element_mapping": {
    "AC-1": { "selector": ".pf-v6-c-wizard__step:nth-child(1)", "interaction_type": "verify_visible" },
    "AC-2": { "selector": ".pf-v6-c-wizard__nav-link", "interaction_type": "click", "description": "Step navigation" }
  },
  "data_entries": [],
  "interactive_elements": [
    { "type": "tab", "selector": ".pf-v6-c-wizard__nav-link", "trigger_selector": null },
    { "type": "text_input", "selector": "#pipeline-name", "trigger_selector": null },
    { "type": "select", "selector": ".runtime-select", "trigger_selector": ".pf-v6-c-select__toggle" }
  ],
  "initialization": {},
  "status_values": []
}
```

**The Playwright script generator in Step 3 MUST read `component-map.json` and use its data for:**
- Element selectors (never construct from domain terms — use `ac_element_mapping`)
- Interaction types (hover vs click vs fill — use `interactive_elements`)
- Page-load waits (use `content_ready_selector`)
- Target page route (use `target_page` for navigation)
- Initialization (use `initialization.local_storage` for pre-seeding)

**Validation:** If `component-map.json` does not exist when Step 3 starts, STOP and go back to Step 2b. Do not generate a script without a component map.

### Step 3: Generate and run Playwright script

**Preferred: use the deterministic script generator** to create the base `journey-test.mjs`:

```bash
node .claude/skills/eval/scripts/generate-journey-script.js .artifacts/<KEY>/ <prototype-url>
```

This reads `component-map.json` + `extract-state.json` and emits a complete `.mjs` file with unique interactions per journey (the Interaction Budget). Review the generated script — if any journey needs FLAGGED narrative logic or a custom interaction that the generator couldn't infer, edit the generated file before running it.

**Fallback:** If the generator fails or the component-map structure is unusual, generate `.artifacts/<KEY>/journey-test.mjs` manually using the component map from Step 2b and the PF6 script template below.

**Journey skip check (when `--rerun-only` set):** For each journey, check if ANY of its `ac_ids` are in `--rerun-only`. If none are, skip the journey — carry forward its previous `journey-log.json` entry and screenshots.

**Flag behavior:**
- `--capture-only`: Re-walk all journeys and capture screenshots without modifying verdicts or the CSV. Used by eval-iterate's N+1 final-state capture.
- `--all-journeys`: Run all journeys regardless of `--rerun-only` filter. Used with `--capture-only` to ensure complete screenshot coverage.

#### Journey Completeness Rule

The generated script MUST contain:
- **One journey function for EVERY entry** in `extract-state.json > journey_definitions`
- Each function MUST test the specific AC IDs listed in that journey's `ac_ids` array
- Each function MUST produce a verdict (PASS/FAIL) and log steps

Verify before running: `journey_count_in_script == len(extract-state.journey_definitions)`

#### Visual Differentiation Rule (MANDATORY)

**Each journey MUST produce a screenshot showing a UNIQUE visual state.** Never screenshot the same default table view for multiple journeys. Before capturing the final screenshot, each journey must perform at least one interaction that visibly changes the page.

**Only ONE journey may use the default table view.** All others — including "absence" checks and "error" checks — must perform a distinguishing interaction. An error-absence journey can hover a status label (proves the page is clean AND produces a unique screenshot). A feature-absence journey can scroll to a specific row.

| AC type | Required interaction before screenshot |
|---|---|
| Feature visibility (columns, labels) | Default table view — allowed for exactly ONE journey |
| Tooltip content ("hover over X") | `page.hover()` on a SPECIFIC status label → screenshot WITH tooltip visible |
| Expandable row ("details", "resource info") | Click expand toggle on a SPECIFIC row → screenshot showing expanded content |
| Feature absence ("when disabled") | Source verification → FLAGGED verdict. Still hover a DIFFERENT status label for the screenshot |
| Error absence ("no errors", "graceful degradation") | Check DOM for errors, then hover a DIFFERENT status label for the screenshot |
| Unmanaged/alternative state | Scroll to and highlight the specific row showing different state |
| Multiple resource types | Expand a DIFFERENT row than other expand journeys |

#### Interaction Budget (MANDATORY — do this BEFORE generating journey functions)

Before writing any journey function, build an **interaction assignment table** from `component-map.json`:

1. **Enumerate the interaction pool** from `component-map.json`:
   - One hover target per `interactive_elements` entry with `type: "tooltip"` (using its `trigger_selector`)
   - One expand target per entry in `data_entries` that has `properties.has_expandable: true`
   - One scroll target per `data_entries` entry without expandable
   - One default view (budget: 1)

2. **Assign each journey a unique interaction** from the pool:
   - Match by AC type first (tooltip AC → hover, expand AC → expand, column AC → default)
   - For "absence" and "error" ACs, assign an UNUSED hover target (the hover proves the page works AND produces a unique visual)
   - No two journeys may share the same interaction target

3. **Write the assignment as a comment block** at the top of `journey-test.mjs`:
   ```
   // INTERACTION BUDGET:
   // journey-1 (AC-1, visibility): DEFAULT VIEW (the one allowed)
   // journey-2 (AC-2, disabled): FLAGGED + hover first tooltip trigger
   // journey-3 (AC-3, alternative state): scroll to data_entry[1]
   // journey-4 (AC-5, RBAC): hover second tooltip trigger
   // journey-5 (AC-6, tooltip): hover third tooltip trigger
   // journey-6 (AC-1+7, expand): expand first data_entry row
   // journey-7 (AC-4+7, coverage): expand second data_entry row
   ```

4. **Validate: count unique interaction targets.** If `unique_targets < journey_count`, the budget is invalid — reassign until every journey has a distinct target.

**Enforcement:** After generating the script, verify uniqueness:
```bash
# Count unique screenshot contexts (must equal journey count)
grep -c "screenshot(" .artifacts/<KEY>/journey-test.mjs
# Verify no two journey functions have identical interaction sequences
```

If journeys share the same default table view screenshot, the script is INVALID. Go back to the interaction budget and reassign.

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

// Pre-seed initialization from component map
const initLS = componentMap.initialization?.local_storage || {};
await page.addInitScript((ls) => {
  for (const [key, value] of Object.entries(ls)) {
    try { localStorage.setItem(key, value); } catch {}
  }
}, initLS);

async function navigateTo(route) {
  await page.goto(`${BASE_URL}${route}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  const readySelector = componentMap.content_ready_selector || 'body';
  await page.waitForSelector(readySelector, { timeout: 8000 }).catch(() => null);
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
  console.log('All journeys complete.');
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

Every step MUST be necessary to verify the AC. If an AC describes a disabled/alternative state (e.g., "when feature X is not enabled"):
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

**Default-state ACs:** If an AC describes what should happen when a feature is absent or disabled (e.g., "no feature indicators when disabled", "normal state with no extra indicators", "no error indicators"), and the current prototype state matches that description, the verdict is **PASS** — not FLAGGED. The AC is satisfied by the current visible state. Only FLAG if the AC requires demonstrating a STATE TRANSITION (enabled → disabled) that the prototype can't toggle.

**Example:** AC-3 says "Items without the feature display normal default status with no extra indicators." If the UI shows items in their default state without the feature's indicators, that IS the AC being satisfied — PASS, not FLAGGED.

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

**If the generated script already wrote `journey-log.json`** (deterministic script generator does this automatically), skip to the verdict cross-checking step below. Only build journey-log manually if using the fallback LLM-generated script.

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

**If using the deterministic script generator**, `journey-log.json` is written automatically by the generated script. Only write manually if using the fallback LLM-generated script.

The output MUST match this exact schema. `render-report.js` reads these specific field names.

```json
{
  "depth": "deep",
  "prototype_url": "http://localhost:9000",
  "evaluated_at": "2026-06-25T14:30:00Z",
  "journeys": [
    {
      "id": "journey-1",
      "title": "Verify primary feature visibility on target page",
      "persona": "End User",
      "source": "Inferred from AC-1: Given the feature is enabled...",
      "ac_ids": ["AC-1", "AC-4"],
      "verdict": "PASS",
      "steps_expected": 4,
      "steps_completed": 3,
      "steps": [
        {
          "step": 1,
          "action": "navigate",
          "target": "Target page from component-map",
          "result": "success",
          "timestamp_ms": 0,
          "screenshot": "screenshots/journey-1-step-1.png",
          "narration": "Navigated to target page. Content loaded and feature elements are visible."
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

**Plain-language rule for `human_action` (FLAGGED items):** When writing the `human_action` column in the CSV for FLAGGED verdicts, write for a designer, not an engineer. The designer reading this has no terminal access and may not know Kubernetes terminology. Use action-oriented language describing what to do in the UI.

| Bad (too technical) | Good (plain language) |
|---|---|
| Verify feature flag correctly hides optional columns when disabled | Go to Settings, toggle the feature off, and check that the extra columns disappear from the table |
| Validate RBAC graceful degradation with 403 response | Check that the page loads normally for a user who doesn't have admin permissions |
| Confirm WebSocket real-time updates within 5s | Watch the status labels — do they update automatically when something changes, or do you need to refresh? |

For each FAIL verdict, write to `.artifacts/<KEY>/refinement-suggestions.json`:

**Note:** This file may already exist from eval-consistency (source mode). Append to the existing array, don't overwrite it. If the file doesn't exist, create it as a new JSON array.

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
