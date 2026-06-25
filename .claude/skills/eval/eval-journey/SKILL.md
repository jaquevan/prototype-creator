---
name: eval-journey
description: Run Playwright persona journey walkthroughs against the live prototype. Captures screenshots, logs step results, and writes AC verdicts.
user-invocable: false
allowed-tools: Read, Write, Bash, Glob, Grep
---

# eval-journey

Phase 2b of the eval pipeline. Executes Playwright walkthroughs for each journey defined by eval-extract. This skill ONLY runs Playwright — tier classification happens upstream in eval-classify.

## Inputs

| Input | Description | Required |
|-------|-------------|----------|
| `.artifacts/<KEY>/extract-state.json` | Journey definitions, persona selection, AC list | Yes |
| `.artifacts/<KEY>/evaluation-report.csv` | Tier-classified ACs from eval-classify (Section 1 with tiers, no verdicts) | Yes |
| `.artifacts/<KEY>/navigation-hints.json` | Selectors, routes, nav hierarchy from eval-hint | No (but strongly recommended) |
| `.artifacts/<KEY>/mr-delta.json` | Changed files (for nav gap detection, URL fallback hints) | No |
| Prototype URL | Live URL to test against (e.g., `http://localhost:4200`) | Yes |
| `--depth` | `deep` (default) | No |
| `--rerun-only` | Comma-separated AC IDs — only run journeys testing these ACs | No |
| `tests/fixtures/manifest.json` | Test fixtures for file uploads and chat input | No |

## Outputs

| File | Description |
|------|-------------|
| `.artifacts/<KEY>/journey-log.json` | Full Playwright step log with actions, results, screenshots, exploration |
| `.artifacts/<KEY>/journey-test.mjs` | Generated Playwright script (kept for re-runs) |
| `.artifacts/<KEY>/screenshots/` | Journey step screenshots |
| `.artifacts/<KEY>/evaluation-report.csv` | Updated Section 1 with verdicts (PASS/FAIL/FLAGGED per AC) |
| `.artifacts/<KEY>/refinement-suggestions.json` | FAIL criteria fix suggestions |

## Procedure

### Step 1: Setup Playwright

```bash
if ! npx playwright --version >/dev/null 2>&1; then
  npm init -y 2>/dev/null
  npm install --save-dev @playwright/test
  npx playwright install chromium
else
  echo "Playwright already installed, skipping setup"
fi
```

### Step 2: Prepare screenshots directory

```bash
rm -rf .artifacts/<KEY>/screenshots
mkdir -p .artifacts/<KEY>/screenshots
```

On re-iterations with `--rerun-only`, only clear screenshots for re-run journeys (preserve PASS journey screenshots).

### Step 3: Load navigation hints (when available)

If `.artifacts/<KEY>/navigation-hints.json` exists (produced by eval-hint), read it and use it to inform the Playwright script generation:

**From `nav_sections`:** Instead of brute-forcing all expandable sections, target the specific parent. If hints say `"Gen AI studio"` contains `"Playground"`, the script expands that section directly.

**From `selectors`:** Use the real CSS selectors from source code instead of generic patterns. If hints provide `".pf-chatbot__message-bar-attach"`, use that instead of guessing `button:has-text("Upload")`.

**From `routes`:** After a click-first navigation FAILS, use the route as the diagnostic `page.goto` URL. This distinguishes "orphaned page" from "page doesn't exist." Routes are NEVER used proactively — only as post-failure diagnostics.

**From `page_structure`:** Know what elements to verify on each page. If hints say the playground has `["textarea", "select", "input[type=file]"]`, the script knows what to look for after navigation succeeds.

If `navigation-hints.json` does not exist, fall back to generic selectors and brute-force nav expansion (the skill still works without hints, just less precisely).

### Step 3b: Journey skip check (when `--rerun-only` set)

For each journey, check if ANY of its `ac_ids` are in `--rerun-only`. If none are, skip the journey — carry forward its previous `journey-log.json` entry and screenshots.

### Step 4: Generate and run Playwright script

Generate `.artifacts/<KEY>/journey-test.mjs` with two phases in a single browser session:

**Phase 1 — Prescribed Journeys:**

For each journey from `extract-state.json > journey_definitions`:

1. Start at the prototype URL (ONLY acceptable `page.goto` — initial entry)
2. For each step: locate target via UI clicks, log the result
3. **Click-first rule:** Every navigation via visible UI elements only
4. If a step fails (element not found, timeout): mark `"FAIL"`, run `page.goto` as diagnostic ONLY
5. **NEVER mark a step PASS if it required `page.goto`** — a step needing direct URL = ALWAYS FAIL (orphaned page)

#### Sidebar Navigation Strategy (PatternFly expandable nav)

PatternFly/RHOAI prototypes use collapsible nav sections. A link inside a collapsed section IS reachable — it just requires expanding the parent first. This is normal click-first navigation, NOT a failure.

**The generated Playwright script MUST include this nav expansion logic:**

```javascript
// navHints loaded from navigation-hints.json (if available)
const navHints = loadHintsOrNull('.artifacts/<KEY>/navigation-hints.json');

async function navigateViaSidebar(page, targetText) {
  // Strategy 1: Direct click — link is already visible
  let link = page.locator(`nav a:has-text("${targetText}")`).first();
  if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
    await link.click();
    return { success: true, method: 'direct' };
  }

  // Strategy 2: Use hints to expand the KNOWN parent section
  if (navHints?.nav_sections) {
    for (const [sectionName, info] of Object.entries(navHints.nav_sections)) {
      const children = info.children || info;
      if (Array.isArray(children) && children.includes(targetText)) {
        const selector = info.selector || `button:has-text("${sectionName}")`;
        const sectionBtn = page.locator(selector).first();
        if (await sectionBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await sectionBtn.click();
          await page.waitForTimeout(500);
          link = page.locator(`nav a:has-text("${targetText}")`).first();
          if (await link.isVisible({ timeout: 1500 }).catch(() => false)) {
            await link.click();
            return { success: true, method: 'hint_expand', section: sectionName };
          }
        }
      }
    }
  }

  // Strategy 3: Brute-force — expand all visible nav buttons
  const navButtons = page.locator('nav button');
  const btnCount = await navButtons.count();
  for (let i = 0; i < btnCount; i++) {
    const btn = navButtons.nth(i);
    const isVisible = await btn.isVisible().catch(() => false);
    const expanded = await btn.getAttribute('aria-expanded');
    if (isVisible && expanded === 'false') {
      await btn.click();
      await page.waitForTimeout(500);
      link = page.locator(`nav a:has-text("${targetText}")`).first();
      if (await link.isVisible({ timeout: 1500 }).catch(() => false)) {
        await link.click();
        const sectionText = await btn.textContent().catch(() => '');
        return { success: true, method: 'brute_expand', section: sectionText.trim() };
      }
    }
  }

  return { success: false, method: 'none' };
}
```

**When hints are available**, Strategy 2 fires first — the script knows exactly which section to expand (e.g., "Gen AI studio" for "Playground"). This eliminates the timeout from brute-forcing.

**When hints are NOT available**, Strategy 3 (brute force) still works but is slower and may time out on prototypes with many nav sections.

**This is NOT a `page.goto` fallback.** Expanding a parent section is legitimate user behavior — a real user clicks the section header to reveal sub-items. Score it as a PASS with a note about the expansion, not a FAIL.

**When to mark navigation as FAIL vs PASS:**
- Parent section exists but is collapsed → expand it → child link visible → click → **PASS** (normal nav)
- No parent section contains the target link, `page.goto` shows it exists → **FAIL** (orphaned page, genuine usability issue)
- No parent section AND `page.goto` fails → **FAIL** (page doesn't exist)
- Target link visible without expansion → **PASS** (ideal nav)

#### Verdict Assignment — FAIL vs FLAGGED

**FAIL means the feature is missing or broken.** Use FAIL when:
- The UI element, page, or flow described by the AC does not exist
- A form/button/control is supposed to be there but isn't
- Navigation is genuinely broken (orphaned page with no discoverable path)
- A flow starts but crashes/errors mid-way

**FLAGGED means the evaluator cannot make a confident judgment.** Use FLAGGED ONLY when:
- The AC requires comparing against an external reference that's unavailable (Tier 2)
- The AC requires backend/runtime verification (Tier 3)
- The AC is subjective and requires human judgment (Tier 4)
- Ambiguity in what the AC means makes automated judgment unreliable

**NEVER FLAG what should be FAIL.** If the Playwright walkthrough shows a feature is missing or a flow doesn't work, that's FAIL — don't hide it behind FLAGGED. A collapsed sidebar that can be expanded is PASS. A link that doesn't exist at all is FAIL. Neither is FLAGGED.

#### Journey Completeness Rule (MANDATORY)

The generated `journey-test.mjs` MUST contain:
- **One journey function for EVERY entry** in `extract-state.json > journey_definitions`
- If extract-state has 6 journeys, the script MUST have 6 journey functions
- Each function MUST test the specific AC IDs listed in that journey's `ac_ids` array
- Each function MUST produce a verdict (PASS/FAIL) and log steps to the journey-log

**After generating the script, verify before running:**
```
journey_count_in_script == len(extract-state.journey_definitions)
```
If they don't match, the script is incomplete. Add the missing journey functions before running.

Journey functions CAN be simple for Tier 3/4 criteria that can't be fully tested from UI:
```javascript
// Tier 3 journey: verify what's observable, FLAGGED for what isn't
async function runJourney5(page) {
  // Navigate to the page
  // Check if any UI elements related to this AC exist
  // If yes: note what's observable, FLAGGED for the backend part
  // If no: FAIL — not even the UI portion is implemented
}
```

But the function MUST exist and MUST produce a verdict. No journey definition may be skipped.

**Phase 2 — Exploratory Navigation** (when `.context/usability-testing/` present):

After prescribed journeys, same browser session:
1. Return to prototype entry URL
2. For each selected persona, plan 3-5 exploration paths not covered by prescribed journeys
3. Capture screenshots and log what the persona would see

**Parallel execution rules:**
- Same starting page = sequential
- Different starting pages = parallel (separate `browser.newContext()`)
- Journeys that modify state = sequential

Run the script:
```bash
node .artifacts/<KEY>/journey-test.mjs
```

### Step 5: Screenshot capture rules

Capture at key moments only:
- New view reached (after navigation settles)
- Form/modal opened (initial empty state)
- Form filled (completed, before submission)
- Input submitted (before=sub-step `a`, after=sub-step `b`)
- Step failure (what user sees when broken)
- Verify steps (AFTER scrolling target into view)

**Naming:** `screenshots/journey-{N}-step-{M}.png`, exploration: `explore-{persona}-step-{N}.png`

**Scroll before verify:** Always scroll target element into viewport before screenshot.

**Deduplicate:** If same URL and same failure, reuse previous screenshot path with `"screenshot_reused": true`.

**Narrations for designers:** Describe what a reviewer SEES, not DOM internals.

### Step 6: Assign verdicts (EVERY AC must get exactly one verdict)

After all journeys complete, assign verdicts for EVERY AC in the CSV using this precedence:

1. If a journey tested this AC and ALL related steps PASSED → **PASS**
2. If a journey tested this AC and ANY step FAILED → **FAIL** (with rationale citing the failed step)
3. If NO journey tested this AC (coverage gap) → **FAIL** with rationale "No journey tested this criterion"

**Tier 3 split verdict rule (prototypes are NOT backends):**

These are PROTOTYPES — they demonstrate UI flows, not backend logic. Tier 3 ACs have both a UI part and a backend/runtime part. The eval only judges the UI:

- If the UI part of a T3 AC passes (button exists, form validates, visual feedback present): verdict = **PASS** with a note: "UI component verified. Backend portion noted but not evaluable from prototype."
- If the UI part fails (no validation UI, no feedback element): verdict = **FAIL**
- Backend-ONLY ACs with NO UI component at all (e.g., "BFF accepts 50MB bodies", "catalog YAML schema"): verdict = **PASS (N/A)** with rationale "No UI component — backend-only requirement, noted for engineering."

Do NOT flag or fail ACs solely because their backend portion cannot be verified. The prototype's job is to demonstrate the UX, not implement the backend. Note backend requirements in the `human_action` column for engineering follow-up.

**Verdict rules:**
- Simulated/placeholder responses in prototypes = PASS (UI flow works)
- URL-fallback-reachable page = FAIL (page exists but is orphaned)
- Feature exists in source but unreachable via UI = FAIL
- DOM elements exist but are NOT visually rendered = FAIL (ghost elements)

**Every row in `evaluation-report.csv` Section 1 MUST have a non-empty `verdict` column after this step.** Verify by checking for empty verdict fields. If any AC has an empty verdict, the step is not done — assign a verdict before proceeding.

Update `evaluation-report.csv` Section 1 with verdicts, rationale, evidence, fix_action, fix_file.

### Step 7: Write journey-log.json

The output MUST match this exact schema. `render-report.js` reads these specific field names — any deviation produces a broken report with missing screenshots, empty journey sections, and no scores.

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
        },
        {
          "step": 2,
          "action": "verify",
          "target": "Kueue scheduling status labels",
          "result": "success",
          "timestamp_ms": 2100,
          "screenshot": "screenshots/journey-1-step-2.png",
          "narration": "Found 6 Kueue status labels: Admitted, Pending, Running, Suspended, Scaling. Color-coded per state."
        }
      ]
    }
  ],
  "exploration": []
}
```

#### CRITICAL FORMAT RULES (render-report.js will break without these)

- `journey.id` MUST be `"journey-N"` format (not "J1", not "journey_1", not "j-1")
- `journey.steps_completed` and `journey.steps_expected` MUST be present (integers)
- `journey.source` MUST be present (string referencing the AC or user story)
- Every step MUST have ALL of: `step` (number), `action`, `target`, `result` ("success" or "fail"), `screenshot`, `narration`
- `screenshot` paths MUST be `"screenshots/journey-N-step-M.png"` format exactly
- `narration` MUST be designer-readable (what a reviewer sees, not DOM internals)
- `result` MUST be exactly `"success"` or `"fail"` (not "ok", not "pass", not "PASS")
- Screenshot files MUST exist at the referenced paths in `.artifacts/<KEY>/screenshots/`

**If any field is missing, the report will render with blank sections, no embedded images, and broken path comparison tables.**

### Step 7b: Verify AC Coverage (BLOCKING)

After writing journey-log.json, verify every AC has been tested:

1. Read `extract-state.json > ac_list` — get all `criterion_id` values
2. Read `journey-log.json > journeys[].ac_ids` — collect all tested AC IDs (flatten across all journeys)
3. Compute: `untested_acs = ac_list_ids - tested_ac_ids`

**If `untested_acs` is not empty:**
- For each untested AC, check its tier from the CSV:
  - **Tier 1 untested:** assign verdict FAIL with rationale "No journey tested this criterion — coverage gap"
  - **Tier 3/4 untested:** assign verdict FLAGGED with rationale "Tier 3/4: requires backend/subjective verification, no UI journey applicable"
- Log a WARNING: `"AC coverage incomplete: {untested_acs} had no journey"`
- Update `evaluation-report.csv` with these verdicts

**This step is BLOCKING** — do not proceed to eval-usability until every AC in the CSV has a non-empty verdict.

### Step 8: Generate refinement suggestions for FAILs

For each FAIL verdict, write an entry to `.artifacts/<KEY>/refinement-suggestions.json`:

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

- NEVER use `page.goto` as a silent fallback that marks a step PASS
- Every navigation must happen via visible UI elements (click-first)
- If ALL journeys fail at step 1 (entry point unreachable), report "prototype unreachable" and exit
- Use `domcontentloaded` + explicit waits for SPAs (not `networkidle`)
- Modals/drawers are valid parts of a flow — continue the journey within them
- Post-action waits before screenshots (500ms minimum after state changes)
- Scroll chat containers to bottom before chat screenshots

### CRITICAL: Verify VISUAL presence, not just DOM presence

**NEVER use `locator.count() > 0` alone as proof that a feature works.** Elements can exist in the DOM but be visually invisible (zero height, overflow hidden, collapsed parent, CSS display issues). The screenshot is what the USER sees — if the screenshot shows an empty table but DOM has rows, that is a FAIL.

For every verify step, the generated script MUST check BOTH:

```javascript
const elements = page.locator('tbody tr');
const domCount = await elements.count();
const firstVisible = domCount > 0 && await elements.first().isVisible().catch(() => false);

// ONLY pass if elements are both present AND visible
const result = (domCount > 0 && firstVisible) ? 'success' : 'fail';
const narration = !firstVisible && domCount > 0
  ? `Found ${domCount} elements in DOM but they are NOT visually rendered — possible CSS/rendering issue`
  : firstVisible
    ? `Found ${domCount} visible elements`
    : 'No elements found';
```

This prevents the "ghost elements" problem where Playwright reports success but the screenshot shows an empty page. The verdict must match what the screenshot shows — if a human looking at the screenshot would say "I don't see it," the verdict is FAIL regardless of DOM state.

### NEVER use page.evaluate() or .textContent() as proof of visibility

`page.evaluate(() => document.querySelector(...).textContent)` reads text from INVISIBLE elements. PatternFly's `<Tr isExpanded={false}>` renders rows with zero height — they have text content in the DOM but are invisible to users.

**Banned patterns:**
```javascript
// BAD — reads invisible DOM text
const text = await page.evaluate(() => document.querySelector('td').textContent);
if (text) result = 'success'; // WRONG — element may be invisible

// BAD — counts elements without visibility check
const count = await page.locator('tr').count();
if (count > 0) result = 'success'; // WRONG — rows may have zero height
```

**Required pattern:**
```javascript
// GOOD — Playwright's isVisible() checks computed CSS
const row = page.locator('tbody tr').first();
const visible = await row.isVisible().catch(() => false);
if (visible) {
  const text = await row.textContent(); // Safe — element IS visible
  result = 'success';
}
```

The generated script MUST use Playwright's `.isVisible()` before treating any element as present. If the script uses `page.evaluate()` for verification, it MUST also confirm visibility with Playwright's API.
