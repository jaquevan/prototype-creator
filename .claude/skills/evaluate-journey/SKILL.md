---
name: evaluate-journey
description: Classify acceptance criteria into tiers, run Playwright persona journey walkthroughs, and check design consistency. Second phase of the prototype evaluation pipeline.
user-invocable: false
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# evaluate-journey

Phase 2 of the prototype-evaluate pipeline. Classifies acceptance criteria into evaluation tiers, runs Playwright persona journey walkthroughs against the live prototype, and checks design consistency against PatternFly guidelines.

### Tier Quick Reference

Every AC is classified into a tier that determines *how* to evaluate it — not *whether* to evaluate it. Every criterion gets a verdict regardless of tier.

| Tier | What it means | Verdict options | Example |
|------|--------------|-----------------|---------|
| **T1** | Checkable from prototype source code | PASS or FAIL | "A form-based UI for defining roles" |
| **T2** | Needs external reference to compare against | PASS, FAIL, or FLAG | "Align with ACM role creation UI" |
| **T3** | Needs runtime/backend to fully verify | Split: UI part (PASS/FAIL) + backend part (FLAG) | "Validate inputs for valid RBAC" |
| **T4** | Subjective/interpretive | Provide evidence, then FLAG | "Translate K8s terms to user-friendly" |

## Inputs

| Input | Description | Required |
|-------|-------------|----------|
| `.artifacts/<KEY>/extract-state.json` | Output from evaluate-extract: `{ ac_list, journey_definitions, breadcrumb, persona_selection }` | Yes |
| Prototype URL | Live URL to test against (e.g., `http://localhost:4200`) | Yes |
| `--depth` flag | `quick` (default) or `thorough` | No |
| `--rerun-only` | Comma-separated AC IDs to re-evaluate (e.g., `AC-3,AC-5`) | No |

## Outputs

| File | Description |
|------|-------------|
| `.artifacts/<KEY>/journey-log.json` | Full Playwright step log with actions, results, screenshots |
| `.artifacts/<KEY>/journey-test.mjs` | Generated Playwright script (kept for re-runs) |
| `.artifacts/<KEY>/screenshots/` | Journey step screenshots |
| `.artifacts/<KEY>/consistency-report.json` | Design guideline violations (if `.context/consistency-checker/` exists) |
| `.artifacts/<KEY>/evaluation-report.csv` | AC section with tier, verdict, evidence |

> **Schema enforcement:** The CSV output MUST conform to the schema defined in `config/csv-schema.yaml`. The Section 1 header MUST be exactly:
> ```
> # ACCEPTANCE CRITERIA
> criterion_id,source,tier,criterion_text,verdict,rationale,evidence,fix_action,fix_file,human_action
> ```
> All 10 columns are required. Use empty string for columns that don't apply (e.g., `fix_action` is empty for PASS/FLAGGED items, `human_action` is empty for PASS/FAIL items).
>
> After evaluate-usability runs, it will APPEND Section 2 (USABILITY DIMENSIONS) to this file. Do not overwrite it.

## Configuration

Reads `config/product-overlay.yaml` for MR mappings and nav file conventions.

---

### Selective Re-evaluation (when `--rerun-only` is set)

When `--rerun-only` is passed (used by `prototype-iterate` on re-iterations):

1. **Read the previous evaluation-report.csv** from `.artifacts/<KEY>/evaluation-report.csv`
2. **Carry forward PASS verdicts** for criteria NOT in the `--rerun-only` list. Copy their rows verbatim from the previous CSV.
3. **Only re-evaluate criteria in the `--rerun-only` list.** Run tier classification, Playwright journeys, and consistency checks ONLY for these criteria.
4. **Only re-run Playwright journeys that test `--rerun-only` criteria.** Check each journey's `ac_ids` array — if none of its ACs are in `--rerun-only`, skip it and carry forward its previous journey-log.json entry.
5. **Merge results**: combine carried-forward verdicts with fresh re-evaluation results into the new evaluation-report.csv.

This optimization reduces Playwright execution time proportionally to the number of passing criteria. If 8/12 criteria passed on iteration 1, iteration 2 only re-runs journeys for the 4 failing criteria.

**When `--rerun-only` is NOT set**, all criteria are evaluated normally (full evaluation, no carry-forward).

## Step 2: Classify and Evaluate Each Criterion

Not all acceptance criteria are equally checkable. Before judging, classify each criterion into a tier that determines *how* to evaluate it.

### Tier Classification

**Tier 1: Self-evident from the prototype**
Criteria about UI elements, forms, components, or flows that exist (or don't) in the source code.

> Example: "A form-based UI in RHOAI for defining custom roles"
> → Grep for form elements, check if they exist. PASS or FAIL.

**Tier 2: Requires external reference material**
Criteria that reference another product, system, or standard that must be compared against.

> Example: "The interface should align with the ACM role creation UI"
> → Check Supporting Documentation for a reference URL. If found, fetch and compare. If not, FLAG.

**Tier 3: Requires runtime/backend verification**
Criteria about validation logic, API behavior, or backend state that cannot be proven from UI source alone.

> Example: "The UI must validate inputs to ensure the resulting RBAC is valid"
> → Split: "validation UI exists" (checkable) + "validation logic is correct" (FLAG).

**Tier 4: Subjective/interpretive**
Criteria about readability, user-friendliness, or qualitative characteristics.

> Example: "Kubernetes technical terms should be translated into user-friendly concepts"
> → Scan for raw k8s terms in the UI, note specific instances, provide evidence, FLAG for human judgment on whether the translations are adequate.

### Evaluation Flow

For each criterion:

1. **Classify** — which tier is this?
2. **Tier 1** → evaluate immediately from prototype source. Verdict: PASS or FAIL.
3. **Tier 2** → check Supporting Documentation for reference material.
  - Reference URL found? → fetch it (if accessible), compare structure/patterns, provide a tentative assessment + FLAG for human confirmation.
  - Reference in a linked Jira ticket? → use `searchJiraIssuesUsingJql` to pull it.
  - No reference anywhere? → FLAG with reason: "Cannot access [X] to verify. Needs human comparison."
4. **Tier 3** → evaluate what's observable in the UI (does the validation UI exist? are error messages present?). FLAG the parts that require runtime verification.
5. **Tier 4** → provide concrete evidence (list of raw terms found, specific UI text), state your observation, FLAG for human judgment.

**Never block.** Every criterion gets a verdict. The evaluation runs to completion regardless of how many items are flagged. Flagged items accumulate in a "Human Review Queue" at the end of the report.

### Verdict Definitions

- **PASS** — The criterion is clearly satisfied. You can point to specific UI elements, flows, or behaviors that fulfill it.
- **FAIL** — The criterion is clearly NOT satisfied. The required element, flow, or behavior is missing or broken.
- **FLAGGED** — You cannot make a confident judgment. State why (missing reference, requires runtime, subjective) and what evidence you *did* find. Include the tier classification so the human reviewer knows what kind of verification is needed.

**Prototype response rule:** When a criterion involves "the model returns a response" or "a response is displayed," the prototype uses simulated/placeholder responses. If ANY response element renders in the chat after the user action (even if it says "This is a simulated response"), that is a **PASS** — the UI flow works. Only mark FAIL if literally no response appears (the UI is broken, not just simulated). The evaluator is testing whether the prototype demonstrates the feature flow, not whether a real AI model responded.

### How to Check (Tier 1 and observable parts of Tier 2-4)

**If MR delta data is available** (from Step 0b), use it to focus the search:

1. **Check changed files FIRST.** Read `mr-delta.json` and start with the new/modified files listed there. Most AC evidence will be in the changed code.
2. **Flag pre-existing vs new.** If an AC relates to a component that exists but was NOT in the MR diff, note: "This component exists but was NOT part of this MR — may be pre-existing functionality."
3. **Check nav registration.** If `mr-delta.json` shows `nav_changes: false` but new pages were added, flag it immediately: "New pages added but sidebar navigation was NOT updated — pages may be orphaned." This predicts the Playwright nav failure before Step 3 even runs.
4. **Check feature flag wiring.** If `feature_flag_changes: false` but new components reference feature flags, flag: "Component references feature flags but no flag changes in this MR — may be hidden behind inactive flags."

**General checking (with or without delta data):**

1. Search for relevant UI elements, text, components, routes
2. Trace the user flow if the criterion describes an interaction
3. Note the specific evidence (file, line, element) that supports your verdict
4. For Tier 2 with a reference URL in Supporting Documentation: fetch the URL if accessible, compare component structure, layout patterns, or workflow steps

If the prototype is only accessible via URL (no local source), state what you can observe from the URL structure and any accessible pages, and flag criteria that require deeper interaction.

## Step 3: Persona Journey Walkthroughs (Playwright)

Run each persona journey defined in Step 1c as a Playwright walkthrough — clicking through the UI step-by-step, never shortcutting via direct URL navigation.

### Setup

Check if Playwright is already installed before running setup. This avoids redundant npm/browser installs on re-iterations (saves 10-30 seconds per iteration).

```bash
# Check if Playwright is already available
if ! npx playwright --version >/dev/null 2>&1; then
  npm init -y 2>/dev/null
  npm install --save-dev @playwright/test
  npx playwright install chromium
else
  echo "Playwright already installed, skipping setup"
fi
```

On re-iterations within prototype-iterate, the workspace retains its `node_modules/` from the previous iteration. This check prevents reinstalling ~50MB of dependencies on every loop.

### Depth Modes

The `--depth` flag controls how far each journey goes:

- `**--depth=quick**` (default) — verify the flow exists and is navigable. Click through to the target view/form and confirm it renders. No data entry, no submission.
- `**--depth=thorough**` — full end-to-end walkthrough. Fill forms with realistic test data, submit, and verify the result appears in the UI (e.g., new item in table).

### Journey Execution

For each journey defined in Step 1c, generate and run a Playwright walkthrough:

**Journey skip check (when `--rerun-only` is set):** Before generating the Playwright script for a journey, check if ANY of the journey's `ac_ids` are in the `--rerun-only` list. If none are, skip this journey entirely — carry forward its previous `journey-log.json` entry and screenshots. Log: "Journey <N> skipped — all tested criteria (AC-X, AC-Y) already PASS."

### Parallel Journey Execution

When multiple journeys need to run, group them by independence and execute non-overlapping flows concurrently. Playwright supports multiple browser contexts in a single browser instance.

**Grouping rules:**
1. **Same starting page = sequential.** Journeys that begin at the same URL (e.g., both start at "Gen AI Studio > Playground") must run sequentially — they share page state (model selection, chat history).
2. **Different starting pages = parallel.** Journeys that navigate to entirely different sections (e.g., one goes to "Models > Registry" while another goes to "Settings > User Management") can run in parallel browser contexts.
3. **Journeys that modify state = sequential after them.** If journey N creates a resource (registers a provider, deploys a model), and journey N+1 verifies it appears in a list, they must be sequential.

**Implementation in the generated Playwright script (`journey-test.mjs`):**

For parallel-eligible journeys, use Playwright's `browser.newContext()` to create isolated browser contexts:

```javascript
// Group journeys by start page
const groups = groupJourneysByStartPage(journeys);

for (const group of groups) {
  if (group.length === 1 || group.some(j => j.modifiesState)) {
    // Sequential: run one at a time in the same context
    for (const journey of group) {
      await runJourney(page, journey);
    }
  } else {
    // Parallel: each journey gets its own browser context
    await Promise.all(group.map(async (journey) => {
      const context = await browser.newContext();
      const parallelPage = await context.newPage();
      await parallelPage.goto(prototypeUrl);
      await runJourney(parallelPage, journey);
      await context.close();
    }));
  }
}
```

**Screenshot naming:** Parallel journeys use the same `screenshots/journey-{N}-step-{M}.png` convention. Since each journey has a unique N, there are no naming conflicts.

**Error isolation:** A failure in one parallel journey does not affect others. Each context is independent.

**When NOT to parallelize:**
- When `--rerun-only` is set and only 1-2 journeys are being re-run (overhead of parallel contexts exceeds the benefit)
- When the prototype uses shared server-side state (session cookies, database) that would cause race conditions
- When `--depth=thorough` and journeys submit forms that create real resources in the prototype

**Click-first rule**: Every navigation must happen via visible UI elements (links, buttons, tabs, menu items). If a step cannot be completed via click, it is a **failure** — log the blocked step and continue to the next journey.

**URL fallback is DIAGNOSTIC ONLY — NEVER marks a step as PASS.** The generated Playwright script must follow these rules strictly:

1. Try to reach the target via UI clicks (sidebar nav, buttons, tabs, links).
2. If the click times out or the element isn't found, the step result is `"FAIL"` with `"error": "Element not found via UI navigation"`.
3. AFTER marking the step as FAIL, attempt `page.goto(url)` as a diagnostic check.
4. If `page.goto` succeeds, add `"url_fallback": "reachable"` to the step — this means the page EXISTS but is orphaned (not discoverable by users). This is a **critical usability failure**.
5. If `page.goto` also fails, add `"url_fallback": "unreachable"` — the page doesn't exist at all.
6. **NEVER use `page.goto` as a silent fallback that marks the step PASS.** The generated script must NOT have a try/catch that swallows nav failures and falls back to direct URL navigation while reporting success. This is the single most important rule for Playwright honesty.

**Per-step logging**: Every Playwright action is logged with full context:

```json
{
  "journey": "Register an External Provider",
  "persona": "Model Deployer",
  "step": 3,
  "action": "click",
  "target": "button#providers-register-button",
  "label": "Register provider",
  "result": "success",
  "timestamp_ms": 4520,
  "url_before": "/ai-hub/models?tab=providers",
  "url_after": "/ai-hub/models?tab=providers",
  "screenshot": "screenshots/journey-1-step-3.png"
}
```

### Screenshot Capture

Capture screenshots at **key moments only** (not every single action):

- **New view reached** — after navigation settles on a new page/tab/route
- **Form/modal opened** — shows the initial empty state of a form
- **Form filled** (thorough mode) — shows the completed form before submission
- **Input submitted** (thorough mode) — take TWO screenshots: one showing the input attached/typed (before send = sub-step `a`), one showing the response (after send = sub-step `b`). Label as `step-3a`, `step-3b`.
- **Step failure** — captures exactly what the user sees when something breaks
- **Verify steps** — MUST screenshot AFTER scrolling the target element into view

**Post-action wait rules (critical for timing):**

Before taking any screenshot after an action, wait for the interesting state to render:

```javascript
// After file upload: wait for the attachment to appear in chat
await page.waitForSelector(
  '.pf-chatbot__message img, [data-testid="attachment"], .attachment-preview, .pf-chatbot__message-attachment',
  { timeout: 5000 }
).catch(() => {}); // proceed even if timeout — capture whatever state exists
await page.waitForTimeout(500);

// After message send: wait for assistant response to render
// IMPORTANT: Prototypes use simulated/placeholder responses. ANY new message
// element appearing after send = PASS. Do not FAIL because the response content
// is generic or simulated. Only FAIL if literally nothing appears (broken UI).
await page.waitForSelector(
  '.pf-chatbot__message--assistant:last-child, [data-role="assistant"]:last-child, .message-assistant:last-of-type, .pf-chatbot__message:last-child:not([data-role="user"])',
  { timeout: 10000 }
).catch(() => {});
await page.waitForTimeout(500); // extra wait for simulated streaming to finish

// After modal/form open: wait for body content
await page.waitForFunction(
  () => document.querySelector('[class*="modal"] [class*="body"], .pf-v6-c-modal-box__body')?.children.length > 0,
  { timeout: 5000 }
).catch(() => {});
await page.waitForTimeout(300);
```

**Before any chat-area screenshot:** Scroll the chat container to the bottom so the latest message (with uploaded file or response) is visible:

```javascript
await page.evaluate(() => {
  const chat = document.querySelector('.pf-chatbot__content, [class*="chat-scroll"], [class*="messages-scroll"], .scrollable');
  if (chat) chat.scrollTop = chat.scrollHeight;
});
await page.waitForTimeout(300);
```

Without this, screenshots will show the top of the chat (old messages) instead of the latest action. Every screenshot of a chat interaction MUST scroll to bottom first.

Save screenshots to `.artifacts/<KEY>/screenshots/journey-<N>-step-<N>.png` (e.g., `screenshots/journey-1-step-2.png`). Use sub-step numbering (3a, 3b) when capturing before/after states or when a verify step follows the main step on the same page.

**Narrations must be written for designers, not developers.** The narration field on each step appears in the report and is read by non-technical reviewers. Rules:

- Describe what a reviewer SEES, not DOM internals. Say "Catalog shows 30 starter kit cards but none have descriptions" not "Found 30 card elements total in DOM. Descriptions present: false."
- When capturing a click, note WHAT was clicked — the visible text of the element. Say `Clicked "Customer Support Agent" starter kit` not "Clicked on a starter kit card."
- Avoid character counts, boolean checks, and CSS selector language in narrations. Those belong in the journey-log.json data fields, not the human-facing narration.
- If a verify step finds missing content, explain the impact: "Detail page is mostly empty — a user can't evaluate this kit before deploying" not "Detail page has 118 chars of content."

**Scroll screenshots must be distinct.** Before capturing a scroll-verify screenshot, check if the page is actually scrollable (`document.body.scrollHeight > window.innerHeight`). If not, merge the verify into the previous step as a sub-step (2b, 3b) rather than producing a duplicate screenshot. When scrolling, scroll to a specific element (`lastCard.scrollIntoViewIfNeeded()`) rather than a pixel offset — this ensures the screenshot shows different content.

**Scroll before verify screenshots.** When a verify step checks a specific element on the page (e.g., a tools section, a deployment requirements panel, a specific form field), the generated script MUST scroll that element into the viewport before taking the screenshot:

```javascript
// For verify steps: scroll target into view, wait for render, then screenshot
const target = page.locator('selector-for-what-we-are-verifying');
await target.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await page.screenshot({ path: `screenshots/journey-${journeyIdx}-step-${stepIdx}.png`, fullPage: false });
```

Without this, multiple verify steps on the same page produce identical screenshots that don't show what's being verified. Each screenshot must visually demonstrate the element the step claims to check.

**Deduplicate identical screenshots.** Before saving a new screenshot, compare the current page state to the previous step:
1. Check if `page.url()` is the same as the previous step's URL
2. If URL is the same AND the step failed for the same reason (e.g., element not found), reuse the previous screenshot path instead of saving a new file
3. In the journey-log.json, set `"screenshot": "screenshots/journey-N-step-M.png"` pointing to the previous step's file and add `"screenshot_reused": true`
4. The render script already merges steps that share a screenshot (see `mergedSteps` logic). This deduplication ensures the merged behavior works correctly.

This prevents the report from showing the same empty table or stuck page 5+ times when Playwright gets stuck on repeated failures. The report will show one screenshot with a note like "Steps 4-8 showed identical state" instead of 5 identical images.

**Visible vs total element counts.** When verifying element counts (e.g., "cards in a catalog"), report BOTH the total DOM count and the visible-in-viewport count. Use this in the narration: "Found 66 elements total in DOM (6 visible in current viewport)." Do not claim all elements are visible when only a few are on screen.

Clear and recreate the screenshots directory before running to prevent stale screenshots from a previous iteration persisting:

```bash
rm -rf .artifacts/<KEY>/screenshots
mkdir -p .artifacts/<KEY>/screenshots
```

Screenshots are embedded in the evaluation report inside the collapsible journey `<details>` sections (see Step 4).

### Test Script

Generate the script at `.artifacts/<KEY>/journey-test.mjs` and run it:

```bash
node .artifacts/<KEY>/journey-test.mjs
```

The script has two phases in a **single Playwright browser session**:

**Phase 1 — Prescribed Journeys** (always runs):

1. Start at the prototype URL (this is the ONLY acceptable use of `page.goto` — the initial entry point)
2. For each journey step: locate the target element via UI clicks, log the result
3. If a step fails (element not found, timeout): mark result as `"FAIL"`, run `page.goto` ONLY as a diagnostic (record `url_fallback: "reachable"` or `"unreachable"`), then move to next journey
4. **NEVER mark a step PASS if it required `page.goto` to reach.** A step that needed direct URL navigation is ALWAYS a FAIL — the page is orphaned.

**Phase 2 — Exploratory Navigation** (runs when `--usability=deep|thorough` or `.context/usability-testing/` is present):

After all prescribed journeys complete, the **same browser session** continues with an exploratory phase. This eliminates the need for Zack's skill (or Step 3c) to launch a separate Playwright session.

1. Return to the prototype entry URL (`page.goto` is allowed here — exploration starts from home)
2. For each selected persona, plan 3–5 exploration paths that prescribed journeys did NOT cover:
  - Pages visible in the sidebar that no prescribed journey visited
  - Settings, admin, or configuration areas relevant to the feature
  - Related features the persona would naturally discover while pursuing their goal
  - Pages flagged in `mr-delta.json` that no prescribed journey tested
3. For each exploration step, capture a screenshot and log what the persona would see and do
4. Use the same screenshot naming: `explore-<persona>-step-<N>.png`
5. Log exploration steps to `journey-log.json` under the `exploration` key (see Output below)

**Why one session matters:** Two separate Playwright sessions can see different page states (cached data, feature flags, session state). Running both phases in one session guarantees they see identical state. It also halves the browser startup overhead and produces a consistent screenshot set.

After both phases: output the unified log as JSON

### Quick Mode Behavior

In `--depth=quick`, each journey verifies:

- Can the user navigate to the target view? (click path exists)
- Does the target view render the expected elements? (form fields, table, detail panel)
- Stop before data entry — no filling forms, no submitting

### Thorough Mode Behavior

In `--depth=thorough`, each journey additionally:

- Fills form fields with realistic test data derived from the RFE domain (e.g., provider name: "OpenAI", endpoint: "[https://api.openai.com/v1](https://api.openai.com/v1)")
- Submits the form
- Verifies the result appears in the UI (new row in table, updated status, confirmation message)
- Tests error states if the journey involves validation (submit empty form, check error messages)
- Uses test fixtures for file uploads and chat input (see below)

### Test Fixtures (Thorough Mode)

Test fixtures provide realistic input files for Playwright journeys that involve file uploads or chat prompts. They live in the project root at `tests/fixtures/` with a manifest at `tests/fixtures/manifest.json`.

**At the start of thorough-mode execution**, read `tests/fixtures/manifest.json` from the project root. This manifest maps fixture types to files with `use_when` keywords and `content_hint` metadata.

#### File Upload Steps

When a journey step involves uploading a file (image, audio, PDF):

1. Match the journey's AC context to a fixture using the `use_when` field (e.g., AC mentions "vision model" + "image upload" → match `"use_when": "vision, image analysis"`)
2. Resolve the fixture path: `<project-root>/tests/fixtures/<file>`
3. Upload the file using this multi-strategy approach (modern React apps rarely expose a static `input[type="file"]`):

   **Strategy A — Click trigger, then find dynamic file input:**
   Most React upload components create an `<input type="file">` only after the user clicks a trigger button. Use Playwright's `fileChooser` event:
   ```javascript
   const [fileChooser] = await Promise.all([
     page.waitForEvent('filechooser'),
     page.locator('[data-testid="upload-button"], button:has-text("Upload"), button:has-text("Attach"), .pf-chatbot__message-bar-attach').click()
   ]);
   await fileChooser.setFiles(fixturePath);
   ```

   **Strategy B — Find existing file input (hidden or visible):**
   Some components have a persistent hidden input. Try this if Strategy A times out:
   ```javascript
   const fileInput = page.locator('input[type="file"]');
   if (await fileInput.count() > 0) {
     await fileInput.setInputFiles(fixturePath);
   }
   ```

   **Strategy C — Drag and drop simulation:**
   If no file input exists and no fileChooser event fires, simulate a drag-and-drop:
   ```javascript
   const dropZone = page.locator('.pf-chatbot__message-bar, .upload-zone, [data-dropzone]');
   const dataTransfer = await page.evaluateHandle(() => {
     const dt = new DataTransfer();
     return dt;
   });
   await dropZone.dispatchEvent('drop', { dataTransfer });
   ```

   **Strategy D — Clipboard paste (for images):**
   As a last resort for image uploads, simulate a paste event:
   ```javascript
   await page.evaluate(async (filePath) => {
     const response = await fetch(filePath);
     const blob = await response.blob();
     const item = new ClipboardItem({ [blob.type]: blob });
     const event = new ClipboardEvent('paste', {
       clipboardData: new DataTransfer()
     });
     event.clipboardData.items.add(new File([blob], 'test-image.png', { type: blob.type }));
     document.activeElement.dispatchEvent(event);
   }, fixturePath);
   ```

   **Try strategies in order A → B → C → D.** Log which strategy succeeded in the journey narration. If all fail, mark the step as `"upload_method": "none_found"` and continue — the upload UI existence was already verified in quick mode.

4. Wait for the file to appear in the UI (inline preview, filename badge, thumbnail, or a loading indicator)
5. Screenshot after attachment is visible
6. If the journey requires submitting the file (sending the message), use the Combined flow below

#### Combined File Upload + Chat Message (most common pattern)

When the journey requires sending a file WITH a text prompt (e.g., "upload image and ask the model about it"), the ordering is critical:

1. **FIRST — Attach the file** using Strategy A/B/C/D above
2. **WAIT — Verify attachment preview appears** in the message composition area:
   - Look for: img thumbnail, filename badge, attachment indicator near the text input
   - Wait up to 3 seconds: `await page.waitForSelector('.pf-chatbot__message-attachment, [class*="attachment"], img[class*="preview"]', { timeout: 3000 }).catch(() => null)`
   - If NO preview appears within 3 seconds, the upload may have failed silently — log this and try an alternative strategy
   - **Screenshot this state (sub-step `a`)** — this proves the file is attached before sending
3. **THEN — Type the text prompt** into the message input field
4. **SEND — Click the send button** (or press Enter)
5. **WAIT — For the assistant response** to appear (scroll chat to bottom first):
   ```javascript
   await page.evaluate(() => { const c = document.querySelector('.pf-chatbot__content, [class*="chat-scroll"]'); if (c) c.scrollTop = c.scrollHeight; });
   await page.waitForSelector('.pf-chatbot__message--assistant:last-child, [data-role="assistant"]:last-child', { timeout: 10000 }).catch(() => null);
   await page.waitForTimeout(500);
   ```
6. **Screenshot the response (sub-step `b`)** — should show user message WITH image/file + assistant reply

**The critical ordering is: attach FIRST, verify preview, type SECOND, send THIRD.**

Do NOT type and send the prompt before the file is attached. The user message must contain both the file AND the text prompt together.

#### Chat/Prompt Input Steps (text-only, no file)

When a journey step involves ONLY typing into a chat (no file upload):

1. Select the appropriate text fixture from `text_prompts` in the manifest based on the journey context
2. Read the fixture file contents
3. Type or fill the text into the message input field
4. Submit (click send or press Enter) and wait for the response (loading indicator disappears, assistant message appears)
5. Screenshot the response

#### Sequential Image Testing (multi-image conversations)

For acceptance criteria that test multiple images in a single conversation (e.g., AC-7 pattern):

1. Read `sequences.multi-image-conversation` from the manifest
2. Execute each step in order:
   - Upload the first image using the file upload procedure above
   - Type the associated prompt and send
   - Wait for model response
   - Upload the second image
   - Type the follow-up prompt (which references the first image) and send
3. Verify both images are visible in the conversation history (look for `<img>` elements or thumbnail previews)
4. Screenshot the final state showing both images in context

#### Error Testing (oversized files)

For acceptance criteria that test file size validation:

1. Select the fixture with `"triggers_error": true` from the manifest
2. Attempt the upload using the same multi-strategy approach (A → B → C → D) from the file upload section above
3. After the upload attempt, look for an error alert, notification banner, or validation message in the DOM (e.g., `[class*="alert"], [role="alert"], .pf-v6-c-alert`)
4. Screenshot the error state
5. Verify the file was NOT submitted (no loading indicator, no assistant response)
6. If the upload method succeeded but no error appeared, note this as "file accepted without size validation" — this is a finding

#### Narration and Evidence

Use the manifest's `content_hint` and `expected_transcript` fields to inform your narration:
- For images: describe what the fixture shows (e.g., "Uploaded a bar chart showing Q1-Q4 revenue")
- For audio: reference the expected content (e.g., "Uploaded a 4-second WAV audio sample")
- For PDFs: reference the document content (e.g., "Uploaded a single-page invoice from Acme Corp, total $4,250")

This provides reviewers with concrete evidence that the prototype handled real input rather than just verifying upload UI existence.

### Interpreting Results

**Journey PASS** — all steps completed successfully. The persona can achieve their goal via the expected click path.

**Journey FAIL** — one or more steps could not be completed. Log which step failed and why:

- Element not found → feature not implemented or navigation broken
- Timeout → page unresponsive or SPA routing issue
- URL fallback succeeded → page exists but is orphaned (critical usability failure)

**Journey PARTIAL** — some steps succeeded, the journey was partially completable. This happens when an optional sub-flow (like multi-provider weights) is missing but the core flow works.

### Severity Levels


| Result                             | Severity | Report Treatment                  |
| ---------------------------------- | -------- | --------------------------------- |
| All steps pass via click           | None     | Journey PASS                      |
| Steps pass but slow (>3s per step) | Warning  | Note in report                    |
| Step fails — element not found     | High     | Journey FAIL, link to relevant AC |
| Step reachable ONLY via URL        | Critical | Journey FAIL, orphaned page       |
| Step causes crash/error            | Critical | Journey FAIL, broken flow         |


### Output

Save the full journey log to `.artifacts/<KEY>/journey-log.json`.

**CRITICAL: Every step that has a screenshot MUST include a `"screenshot"` field** with the path relative to the artifacts directory (e.g., `"screenshots/journey-1-step-1.png"`). Also include a `"narration"` field with a brief explanation of what the step shows. The render script uses these to embed screenshots as base64 in the HTML report. If screenshot paths are missing, the report will have no images.

```json
{
  "depth": "thorough",
  "prototype_url": "http://localhost:9000",
  "evaluated_at": "2026-06-11T14:54:00Z",
  "journeys": [
    {
      "id": "journey-1",
      "title": "Register an External Provider",
      "persona": "Model Deployer",
      "source": "Story 1 + Decision 3",
      "ac_ids": ["AC-1", "AC-2"],
      "verdict": "PASS",
      "steps_expected": 6,
      "steps_completed": 6,
      "steps": [
        { "step": 1, "action": "navigate", "target": "/ai-hub/models", "result": "success", "timestamp_ms": 0, "screenshot": "screenshots/journey-1-step-1.png" },
        { "step": 2, "action": "click", "target": "Tab > External providers", "result": "success", "timestamp_ms": 3102, "screenshot": "screenshots/journey-1-step-2.png", "narration": "Tab loaded with providers table visible" }
      ]
    }
  ],
  "exploration": [
    {
      "persona": "deena-junior",
      "persona_name": "Deena - Junior Data Scientist",
      "goal": "Register an external model provider so the team can start using it",
      "paths_planned": 4,
      "paths_covered": ["Settings > Model catalog settings", "Gen AI studio > AI asset endpoints", "Models > Registry > Register model"],
      "prescribed_gap": "Prescribed journeys only tested the External Providers tab. This exploration covers the 3 other UI sections a real user would discover.",
      "steps": [
        {
          "step": 1,
          "action": "click",
          "target": "Sidebar > Settings > Model catalog settings",
          "result": "success",
          "screenshot": "screenshots/explore-deena-junior-step-1.png",
          "narration": "Navigated to Model catalog settings. Found 'Add a source' button and existing sources (Hugging Face, YAML).",
          "persona_reaction": "This looks like where I'd add a provider — but only Hugging Face and YAML are options?"
        }
      ]
    }
  ]
}
```

The `exploration` array is populated by Phase 2 of the unified Playwright script. Each entry represents one persona's exploratory navigation. The `prescribed_gap` field explains WHY this exploration was needed — what the prescribed journeys didn't cover.

### Error Handling

- If Playwright cannot start (e.g., prototype URL is unreachable), note this in the report header and skip the journey section. Do not fail the whole evaluation.
- If the prototype uses client-side routing (SPA), use `domcontentloaded` + explicit waits rather than `networkidle` (which never fires with HMR/websocket connections).
- If a click opens a modal/drawer instead of navigating, record it as a "view" and continue the journey within it — modals are valid parts of a flow.
- If all journeys fail at step 1 (can't reach entry point), report "prototype unreachable" and skip to Step 4.

## Step 3e: Design Consistency Check (Optional)

Run Beau Morley's [consistency-checker](https://gitlab.cee.redhat.com/bmorley/consistency-checker) against the prototype. This catches PatternFly and RHOAI design pattern violations (CTA placement, icon style, empty state structure, pagination) that are cheap to fix and should be addressed before iterating on the heavier AC/usability scoring.

**If `.context/consistency-checker/` does not exist, skip this step entirely.** Add a note: "Design consistency checks skipped. Run `bash scripts/bootstrap-consistency-checker.sh` to enable."

### Source Code Mode (fast — seconds)

Runs when a `--workspace` path is available. Executes Beau's grep-based analysis against the prototype source code.

**Scope to MR deltas:** When `.artifacts/<KEY>/mr-delta.json` exists, run source-mode analysis ONLY against the files listed in `new_files` and `modified_files`. This focuses findings on what actually changed rather than flagging pre-existing issues in the entire codebase:

```bash
# Build file list from delta
FILES=$(cat .artifacts/<KEY>/mr-delta.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(' '.join(d.get('new_files',[]) + d.get('modified_files',[])))")

# Run analysis scoped to changed files
python3 .context/consistency-checker/scripts/analyze.py --src=<workspace-path> --files="$FILES"
```

If `mr-delta.json` does not exist (no workspace), run against the full source:

```bash
python3 .context/consistency-checker/scripts/analyze.py --src=<workspace-path>
```

Parse the output. Each violation maps to a guideline ID, file path, line number, severity (`error` or `warning`), and description.

If the workspace is not available (standalone HTML prototype), skip source mode and note `"ran": false` in the output.

### Visual Mode (required when screenshots exist)

**Visual mode is NOT optional when screenshots exist.** It cross-references captured screenshots against PatternFly guidelines to catch visual violations (icon style, layout patterns, empty states, CTA placement) that source-mode grep cannot detect. If the journey produced screenshots, visual mode MUST run.

Runs against the screenshots already captured by Step 3's unified Playwright session. **No new browser session.**

1. Collect all unique screenshots from `journey-log.json` — both prescribed journey steps and exploration steps that have a `screenshot` field.
2. Read the guideline markdown files from `.context/consistency-checker/guidelines/`. Each guideline has frontmatter with `id`, `title`, `category`, `severity`, and a `## Rule` section describing what to check.
3. For each screenshot, read it alongside the applicable guidelines and return a verdict per guideline: `PASS`, `VIOLATION`, or `NOT_APPLICABLE`.
4. This uses the same AI visual analysis approach as Beau's visual mode — Claude reads the screenshot + guideline text and evaluates. The difference is we skip his Playwright extraction step since we already have the screenshots.

**Deduplication:** If the same violation appears on multiple screenshots (e.g., sidebar icon issue on every page), collapse to one finding with a `seen_on` list of screenshot paths. Only report each unique guideline violation once.

### Output

**Required fields for every violation (source-mode and visual-mode):**

Every violation entry MUST include these fields for the report modal to render correctly:
- `guideline_id` — unique identifier for the guideline
- `guideline_title` — human-readable title
- `category` — grouping (icons, tables, layouts, navigation, etc.)
- `severity` — `error` or `warning`
- `description` — what's wrong (for source-mode: the offending code line; for visual-mode: what's visually incorrect)
- `suggestion` — how to fix it
- `pf_doc_url` — link to the relevant PatternFly documentation page (if applicable)

Source-mode violations additionally require:
- `file` — relative path to the file containing the violation
- `line` — line number in that file

Visual-mode findings additionally require:
- `screenshot` — path to the screenshot where the violation is visible
- `verdict` — must be `VIOLATION` for findings that should appear in the modal

Write to `.artifacts/<KEY>/consistency-report.json`:

```json
{
  "source": "consistency-checker",
  "checked_at": "<ISO timestamp>",
  "guidelines_version": "<git short hash from .context/consistency-checker/>",
  "source_mode": {
    "ran": true,
    "violations": [
      {
        "guideline_id": "icon-style-consistency",
        "guideline_title": "Icon Style Consistency",
        "category": "icons",
        "severity": "error",
        "file": "src/app/AIHub/AgentCatalog/AgentCatalog.tsx",
        "line": 42,
        "description": "FolderIcon used without Outlined suffix",
        "suggestion": "Replace FolderIcon with OutlinedFolderIcon"
      }
    ]
  },
  "visual_mode": {
    "ran": true,
    "screenshots_checked": 12,
    "findings": [
      {
        "screenshot": "screenshots/journey-1-step-3.png",
        "journey": "journey-1",
        "step": 3,
        "guideline_id": "page-cta-placement",
        "guideline_title": "Page CTA Placement",
        "category": "layouts",
        "severity": "error",
        "verdict": "VIOLATION",
        "description": "Primary CTA button is below the fold",
        "suggestion": "Move the Deploy action to the page header or toolbar area",
        "seen_on": ["screenshots/journey-1-step-3.png", "screenshots/journey-2-step-1.png"]
      }
    ]
  },
  "summary": {
    "total_guidelines_checked": 8,
    "violations": 3,
    "warnings": 1,
    "passes": 4
  }
}
```

### Consistency Suggestions for Refinement Loop

When the eval is running with `--feed-to-refine` active, consistency violations must also be written to `.artifacts/<KEY>/refinement-suggestions.json` so the refine skill can act on them.

After writing `consistency-report.json`, also append consistency findings to the refinement suggestions file:

```json
{
  "consistency_suggestions": [
    {
      "type": "consistency",
      "guideline_id": "icon-style-consistency",
      "severity": "error",
      "file": "src/pages/AgentCatalog/AgentCatalog.tsx",
      "line": 42,
      "current": "FolderIcon",
      "fix": "OutlinedFolderIcon",
      "pf_doc_url": "https://patternfly.org/icons",
      "source": "source_mode"
    },
    {
      "type": "consistency",
      "guideline_id": "cta-placement",
      "severity": "warning",
      "screenshot": "screenshots/journey-1-step-3.png",
      "description": "Primary action button positioned after secondary button",
      "fix": "Move primary button to leftmost position in button group",
      "pf_doc_url": "https://patternfly.org/layouts/bullseye",
      "source": "visual_mode"
    }
  ]
}
```

**Priority in the refine loop:** Consistency fixes are applied FIRST by prototype-refine because:
1. They have specific file paths and line numbers (deterministic)
2. They're guaranteed correct (PatternFly docs are the reference)
3. They're cheap to apply (usually a single import or prop change)
4. They reduce noise for subsequent iterations (fewer violations = cleaner screenshots for visual mode)

Only include violations from files in the MR delta (`new_files` + `modified_files`). Pre-existing violations in unchanged files are not the prototype's responsibility to fix.

### Open Items (coordinate with Beau)

- **Guideline stability**: Are the guideline IDs and `guidelines/` file structure stable enough to depend on? If guidelines are renamed, our cached version drifts. Pin to a specific commit hash in the bootstrap script and update periodically.
- **False positive rate**: Beau is actively reducing false positives. Monitor and adjust severity thresholds as the guidelines mature.
- **Visual mode bridge**: We skip Beau's Playwright extraction (we already have screenshots). If Beau adds a "screenshot-only" input mode to his scripts, we should switch to it. Until then, the AI analysis is done inline by the eval skill.
