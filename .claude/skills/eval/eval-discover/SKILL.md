---
name: eval-discover
description: "Phase B of the eval pipeline. Runs per-persona Playwright walkthroughs, scores 7 usability dimensions, and produces think-aloud traces. Only fires after Phase A AC validation passes."
user-invocable: false
allowed-tools: Read, Write, Bash, Glob, Grep
---

# eval-discover

Phase B of the eval pipeline. Runs discovery-based per-persona Playwright walkthroughs against the prototype in its current state (after Phase A validation and any fixes applied), then scores 7 usability dimensions using persona constraints and think-aloud narration.

Each persona navigates at their own competence level — an experienced user explores differently than a junior one. Navigation behavior is driven by the persona YAML fields: `exploration_tendency`, `experience_level`, `domain_knowledge`, and `constraints[]`.

**Skip entirely if `.context/usability-testing/` does not exist.** Add a note: "Usability scoring skipped. Run `make context` to bootstrap."

## Inputs

| Input | Description | Required |
|-------|-------------|----------|
| `.artifacts/<KEY>/journey-log.json` | Phase A Playwright step log with AC screenshots | Yes |
| `.artifacts/<KEY>/screenshots/` | Phase A journey screenshots (for reference) | Yes |
| `.artifacts/<KEY>/extract-state.json` | Persona selection, journey definitions, goals | Yes |
| `.context/usability-testing/personas/` | Persona YAML files | Yes |
| `.context/usability-testing/prompts/evaluate-flow.md` | 7-dimension rubric | Yes |
| `.artifacts/<KEY>/navigation-hints.json` | Fallback hints for stuck personas | No |
| Prototype URL | Live URL (from eval-state.yaml) | Yes |

## Outputs

| File | Description |
|------|-------------|
| `.artifacts/<KEY>/journey-log.json` | Updated with `usability_dimensions` section |
| `.artifacts/<KEY>/evaluation-report.csv` | Appended Section 2 (USABILITY DIMENSIONS) |
| `.artifacts/<KEY>/usability-thinkaloud-<persona-id>-task-<N>.md` | Per-persona per-task think-aloud trace |
| `.artifacts/<KEY>/screenshots/persona-<persona-id>-task-<N>-step-<M>.png` | Per-persona per-task walkthrough screenshots |
| `.artifacts/<KEY>/persona-results.json` | Structured trace data for all persona+task runs |
| `.artifacts/<KEY>/refinement-suggestions.json` | Appended with usability suggestions for scores 0-1 |

## Procedure

### Step 1: Select and Load Personas

**REQUIRED: Actually read the persona YAML files.** Do not score from memory or inference alone.

#### 1a: Select personas based on target audience

Use the mapping below with `extract-state.json > persona_selection.target_audience_text`:

| RFE Target Audience | Recommended Personas |
|---------------------|---------------------|
| Data scientists, ML practitioners | `deena-junior`, `deena-senior` |
| AI/ML engineers, developers | `alex-junior`, `alex-senior` |
| MLOps, platform operators | `maude-experienced`, `maude-junior` |
| Platform admins, infrastructure | `paula-platform-engineer` |
| Accessibility-sensitive flows | `sam-accessibility` |
| Regulated/air-gapped environments | `raj-regulated` |

Always pick one junior + one senior when possible.

#### 1b: Read each selected persona's YAML file

For each selected persona, read the full file:

```
.context/usability-testing/personas/<persona-id>.yaml
```

Extract and use these sections throughout scoring:
- **`domain_knowledge`** — map of topics to skill levels (none/minimal/basic/intermediate/competent/strong/expert). Use this in Step 2 to determine what the persona would understand vs. find confusing.
- **`behavioral_attributes.patience`** — High/Medium/Low. Determines patience drain rates in Step 2.
- **`behavioral_attributes.exploration_tendency`** — Low/Medium/High. Determines how aggressively the persona explores the UI during their walkthrough.
- **`constraints[]`** — specific limitations and behavioral rules (e.g., "Cannot interpret Kubernetes terminology", "After 3 confusion events, abandon"). Each constraint is injected into the persona sub-agent's prompt.
- **`primary_jobs[]`** — what the persona is trying to accomplish (JTBD). Use to evaluate whether the UI supports their actual goals.
- **`experience_level`** — junior/senior/experienced. Combined with `exploration_tendency` and `domain_knowledge`, this drives how the persona navigates.

#### 1c: Read the scoring rubric

Read the 7-dimension rubric:

```
.context/usability-testing/prompts/evaluate-flow.md
```

This file defines the specific scoring criteria for each dimension (0-3 scale). Use these criteria — not generic inference — to assign scores in Step 3. The rubric defines what "Broken" (0), "Fragmented" (1), "Functional" (2), and "Seamless" (3) mean for each specific dimension.

**IMMEDIATELY write `persona_selection` to journey-log.json** before any scoring:

```json
{
  "persona_selection": {
    "method": "automatic",
    "target_audience_text": "...",
    "target_audience_source": "...",
    "reasoning": "...",
    "selected": ["deena-junior", "deena-senior"],
    "considered_but_rejected": []
  }
}
```

### Step 1c-routes: Map tasks to distinct navigation targets

Before generating Playwright scripts, plan WHERE each task navigates. This prevents all tasks from converging on the same page and producing identical screenshots.

Read `extract-state.json > tasks_to_be_done` and workspace source (or `navigation-hints.json`) to determine a unique route + interaction for each task:

For each task:
1. What ACs does it cover? (from `covers_acs` field)
2. What route/page tests those ACs? (from navigation-hints.json routes or workspace source)
3. What INTERACTION distinguishes this task from others on the same page? (expand row, open modal, filter, click tab, scroll position)

**Rules:**
- No two tasks may share the same route + same interaction
- If tasks must visit the same page, they MUST differ in: scroll position, filter state, expanded element, or tab selection
- If a task describes a state that can't be shown (feature disabled, RBAC restricted), navigate to the closest relevant page (Settings, Feature Flags, admin panel) and STAY there. Do NOT fall back to the default page.
- A task about "comparing two things" should show BOTH things side-by-side or in sequence, not just one

**Single-page prototype rule:** If ALL tasks resolve to the same route (e.g., all target the deployments page), differentiation MUST come from interactions:
- Task 1: navigate + scan table (default view screenshot)
- Task 2: expand a specific row (expanded content screenshot)
- Task 3: hover over a status label (tooltip visible screenshot)
- Task N: scroll to a specific row, open a modal, click a tab, filter the table

**NEVER generate multiple task functions that all just navigate and screenshot the default table view.** Each task function's final screenshot must show a visually distinct state. If the component-map.json shows interactive_elements (tooltips, expandable rows), tasks MUST use them.

**Write the task route mapping** as a comment block at the top of `persona-walkthrough.mjs`:

```
// TASK ROUTES (from Step 1c-routes):
// Task 1 (covers AC-1,AC-4,AC-6): /ai-hub/models/deployments → expand pending row, view resource details
// Task 2 (covers AC-2,AC-5): /settings or /feature-flags → observe toggle state, stay on settings page
// Task 3 (covers AC-3,AC-7): /ai-hub/models/deployments → scroll right to compare managed vs unmanaged rows
```

This mapping drives all downstream Playwright generation. If the mapping shows two tasks with the same route + same interaction, revise BEFORE proceeding to Step 1d.

### Step 1d: Per-Persona Playwright Walkthroughs

**Screenshot mode** (passed from eval-iterate):
- `--screenshots=full` (default): Capture a screenshot at every navigation step.
  Names: `persona-<id>-task-<N>-step-<M>.png`
- `--screenshots=key-only`: Capture ONE screenshot per persona per task — the
  final interaction state before the persona completes or abandons. This reduces
  volume from ~30 screenshots to 6 (2 personas x 3 tasks), cutting Playwright
  execution time and output token cost. The final-state screenshot shows the
  designer what the persona actually saw at the decision point.
  Names: `persona-<id>-task-<N>-final.png`

When `--screenshots=key-only` is set, also skip writing `usability-thinkaloud-*.md`
files — the trace data in `persona-results.json` is sufficient for scoring, and
the markdown files are only consumed by the full HTML report renderer.

Each persona runs their OWN Playwright walkthrough as an independent sub-agent. Navigation behavior is driven by the persona's YAML fields — not a shared script.

**REQUIRED script structure for `persona-walkthrough.mjs`:**

The generated script MUST have:
- **One function per task:** `runTask1(page, persona)`, `runTask2(page, persona)`, `runTask3(page, persona)`
- Each task function navigates to its MAPPED route from Step 1c-routes
- Persona fields (`exploration_tendency`, `experience_level`) influence navigation behavior (see table below)
- The `main()` loop calls task-specific functions, NOT a single shared `runPersonaTask()`
- **Variable step counts:** each task has as many steps as needed (NOT a fixed 3). A simple task may have 2 steps, a complex one may have 7.

**Navigation verification rules for each task function:**

```javascript
// Each task function MUST:
// 1. Navigate AWAY from the homepage before taking step-2+ screenshots
// 2. Verify navigation succeeded before screenshotting
// 3. Only screenshot when the view MEANINGFULLY changed

// WRONG (produces homepage-stuck screenshots):
async function runTask1(page, persona) {
  await page.goto(BASE_URL);
  await page.screenshot(...);  // step 1: homepage OK
  await page.screenshot(...);  // step 2: BUG still homepage!
  await page.screenshot(...);  // step 3: BUG still homepage!
}

// CORRECT:
async function runTask1(page, persona) {
  await page.goto(BASE_URL);
  await page.screenshot(...);  // step 1: homepage

  // Navigate to target
  await page.click('nav a:has-text("Models")');
  // Wait for CONTENT not just container — table rows, not empty table
  await page.waitForSelector('#deployments-table tbody tr', { timeout: 8000 });
  await page.waitForTimeout(1500);  // settle time for SPA re-renders
  await page.screenshot(...);  // step 2: deployments table WITH DATA (different view!)

  // Interact with specific element
  await page.click('button[aria-label="Expand row"]');
  await page.waitForTimeout(1000);
  await page.screenshot(...);  // step 3: expanded row (different view!)

  // Continue as needed for task complexity...
  await page.click('.resource-details-tab');
  await page.screenshot(...);  // step 4: resource details
}
```

**Screenshot timing rules (CRITICAL — prevents empty-state captures):**
- After `page.goto`: wait for `networkidle` or a content selector (NOT just `domcontentloaded`)
- After navigation click: wait for a DATA element to appear (table row, list item, form field with value)
- Minimum 1500ms settle time after any selector wait (React re-renders, CSS transitions)
- WRONG: `waitForSelector('#my-table')` then screenshot (captures empty table shell)
- RIGHT: `waitForSelector('#my-table tbody tr')` then screenshot (captures table with data)

**Step count guidelines by task type:**
- Navigation + observe: 2-3 steps (go there, see it)
- Navigation + interact + verify: 4-6 steps (go there, click something, verify result, check details)
- Multi-page comparison: 5-7 steps (visit page A, capture, visit page B, capture, compare)
- Feature exploration: 4-8 steps (find feature, try it, observe feedback, try edge case)

```javascript
import { firefox } from 'playwright';
// MANDATORY: 1920x900 viewport in every context. Default 800x600 truncates tables. 1440 is insufficient for tables with 10+ columns.
const browser = await firefox.launch({ headless: true });

// MANDATORY: Pre-seed "All projects" in localStorage BEFORE React mounts.
// Many prototypes default to a project with no mock data (e.g., "AI Platform Team").
// Without this, every fresh context renders an empty table.
// This MUST be called via page.addInitScript() on EVERY new page, BEFORE page.goto().
// The ensureAllProjects() click fallback below is a SECONDARY safety net, not a replacement.
//
// IMPORTANT: When addInitScript is already in place, do NOT call ensureAllProjects()
// before screenshots — it opens the project dropdown which covers the data rows.
// Only call ensureAllProjects() as a diagnostic fallback if tbody has 0 rows despite addInitScript.

// Fallback only: click-based project selection (opens dropdown — may cover data rows)
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

async function runTask1(page, persona) { /* navigate to deployments, expand pending row */ }
async function runTask2(page, persona) { /* navigate to settings/feature-flags */ }
async function runTask3(page, persona) { /* navigate to deployments, filter/scroll to unmanaged */ }

async function main() {
  for (const persona of personas) {
    for (let i = 0; i < tasks.length; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 900 } });
      const page = await ctx.newPage();

      // MANDATORY: Pre-seed project selection and feature flags BEFORE page.goto().
      // Without this, the app defaults to "AI Platform Team" which has no mock data,
      // producing empty-table screenshots that get embedded in the report.
      await page.addInitScript(() => {
        try { localStorage.setItem('selectedProject', JSON.stringify('All projects')); } catch {}
        try {
          const flags = JSON.parse(localStorage.getItem('featureFlags') || '{}');
          flags._lastModified = new Date().toISOString();
          localStorage.setItem('featureFlags', JSON.stringify(flags));
        } catch {}
      });

      if (i === 0) await runTask1(page, persona);
      else if (i === 1) await runTask2(page, persona);
      else if (i === 2) await runTask3(page, persona);
      await ctx.close();
    }
  }
}
```

**Pre-flight validation:** After generating `persona-walkthrough.mjs`, verify BOTH viewport AND project seeding before running:
```bash
grep -q "viewport" .artifacts/<KEY>/persona-walkthrough.mjs || { echo "FATAL: Missing viewport. Regenerate."; exit 1; }
grep -q "addInitScript" .artifacts/<KEY>/persona-walkthrough.mjs || { echo "FATAL: Missing addInitScript project seed. Regenerate."; exit 1; }
```
```

**How persona fields drive navigation AND interaction:**

| YAML Field | Navigation Effect | Screenshot Impact |
|---|---|---|
| `exploration_tendency: low` | Sticks to obvious path. Won't open Advanced Settings, won't expand optional sections. | Fewer screenshots, all on primary path |
| `exploration_tendency: high` | Proactively checks Advanced Settings, YAML views, logs, events. Drills into everything. | More screenshots, captures side panels and expanded sections |
| `experience_level: junior` | Slower reading, confused by patterns without labels, misses non-obvious affordances. | Screenshots show reading/scanning states, sidebar still visible |
| `experience_level: senior` | Efficient navigation, recognizes UI patterns (accordions, tabs), tries shortcuts. | Screenshots show target page directly, less intermediate state |
| `domain_knowledge: {k8s: none}` | Nav items with K8s jargon ("Pods", "PVCs") trigger confusion events. | May screenshot wrong pages before finding the right one |
| `domain_knowledge: {k8s: expert}` | Understands all terminology, navigates directly to target. | Direct path, fewer screenshots |
| `constraints[]` | Hard behavioral rules: "After 3 confusion events, abandon", "CANNOT use mouse" (Sam). | Abandonment produces incomplete screenshot sequence |
| `behavioral_attributes.patience` | How fast frustration builds — Low drains 3x faster than High. | Low patience may abandon mid-task = fewer screenshots |

**These differences MUST produce visually different screenshot sequences** even when two personas visit the same page. A junior persona screenshot showing them reading a sidebar label is different from a senior persona already on the target page.

**Launch one sub-agent PER PERSONA PER TASK (all in parallel):**

CRITICAL: Use the Task tool with `run_in_background: true` for each persona-task pair to maximize parallelism. Each sub-agent gets its own Playwright browser context. Wait for ALL to complete before proceeding to Step 2.

If parallel sub-agents are not available in the current execution context, fall back to sequential execution with separate browser contexts per persona. NEVER skip Playwright walkthroughs and score from Phase A evidence alone — Phase B REQUIRES independent persona navigation.

Each persona completes ALL tasks from `extract-state.json > tasks_to_be_done`. For 2 personas and 3 tasks, this means 6 parallel sub-agents.

Each persona-task agent receives ONLY:
- Their persona YAML file (full — domain_knowledge, patience, constraints, primary_jobs)
- The prototype BASE URL (homepage, not a deep link)
- ONE specific task-to-be-done (plain-language user goal from the tasks array)
- The navigation hints as FALLBACK ONLY (see Step 1e below)

Each persona agent does NOT receive:
- The AC list (they don't know what criteria are being tested)
- Source code or file contents
- Other persona's results
- The evaluation rubric (they're users, not evaluators)

**Prompt for each persona-task sub-agent:**

```
Read the persona file at .context/usability-testing/personas/<persona-id>.yaml.
You ARE this persona. Your experience level, domain knowledge, exploration tendency,
patience, and constraints define exactly how you navigate.

Navigate to <prototype-base-url> (the application homepage).
You see the application's left navigation sidebar — just as a real user would when
they first open the application. You have NOT been told where to go.

IMPORTANT: If you land on a page with an empty table or "No items found", check for a
project filter/dropdown at the top of the page. Many prototypes default to a specific
project that has no data. Switch to "All projects" before concluding the page is empty.
This is normal user behavior, not a workaround.

Your task: <task from tasks_to_be_done[N].task>
(Example: "Find out why your model deployment is queued and when it will be ready")

CRITICAL: Your task determines WHERE you navigate. Different tasks = different destinations.
If your task mentions a specific feature, screen, or state — navigate to THAT specific place.
Do NOT follow the same navigation path as other tasks. Each task is testing a different part
of the application.

Find where to go and complete the task. Think aloud as you navigate.

Respect your persona's constraints — these change HOW you interact, not just what you say:
- If exploration_tendency is low: stick to the obvious path, don't explore side menus, take the first reasonable link
- If exploration_tendency is high: check Advanced Settings, expand optional sections, open every accordion, check YAML views
- If domain_knowledge shows a topic as none/minimal: be confused by jargon for that topic, try wrong paths first, trigger confusion events
- If experience_level is junior: read labels carefully, take time, screenshot while still reading sidebar (shows scanning behavior), miss non-obvious affordances
- If experience_level is senior/experienced: navigate efficiently, recognize UI patterns, skip intermediate states, use keyboard shortcuts if available

Your persona attributes produce DIFFERENT screenshot sequences even on the same page:
- A junior screenshots the sidebar while deciding where to click
- A senior screenshots only after arriving at the target
- High-exploration screenshots Advanced Settings panels others never open
- Low-exploration never leaves the primary content area

At each step:
1. Describe what you see (from the persona's perspective and domain knowledge)
2. Decide what to do next (based on your exploration tendency and constraints)
3. Take a screenshot
4. Note your confidence level and current patience

If you get stuck (can't find where to go after reasonable exploration for your type):
- Read .artifacts/<KEY>/navigation-hints.json for a hint
- Mark the step as "navigate-assisted" in your log
- Note: "I had to ask a colleague where this was"
- Continue from the assisted location

If your constraints say to abandon after N confusion events, do so.

Screenshot rules (these are seen by a human reviewer):
- Take a screenshot whenever the view changes meaningfully (new page, modal/form opens, content loads)
- Do NOT take screenshots of identical-looking intermediate navigation (clicking sidebar = skip unless something unexpected happens)
- Every screenshot should show something the reviewer needs to see to understand your experience
- In the narration, describe WHAT is visible and WHY it matters for your task

Save screenshots to: .artifacts/<KEY>/screenshots/persona-<persona-id>-task-<N>-step-<M>.png
Write your think-aloud trace to: .artifacts/<KEY>/usability-thinkaloud-<persona-id>-task-<N>.md

CRITICAL — SYNCHRONOUS TRACE WRITING:
At EACH step, you MUST write BOTH:
1. Append the step to the markdown think-aloud file (Phase 1 Actor format)
2. Write the step entry to .artifacts/<KEY>/persona-results.json trace[] array

The persona-results.json entry for this step must include:
  { "step": M, "what_i_see": "...", "what_im_thinking": "...", "action": "...",
    "confidence": "high|medium|low", "patience": N,
    "screenshot": ".artifacts/<KEY>/screenshots/persona-<id>-task-<N>-step-<M>.png",
    "evidence_for_acs": ["AC-X"] }

Do NOT defer trace writing to a later step. Each screenshot MUST have a corresponding trace entry written at the same time.
```

**Screenshot naming:** `persona-<id>-task-<N>-step-<M>.png` where N is the task index (1-based) and M is the step number. This separates screenshots by journey.

**Think-aloud naming:** `usability-thinkaloud-<id>-task-<N>.md` — one file per persona per task.

**Wait for all persona-task agents to complete.** Then read their output files.

### Step 1d-verify: BLOCKING — Verify persona screenshots exist and are unique

**Do NOT proceed to Step 2 without completing this check.**

After persona walkthroughs should complete, verify that per-persona screenshots were actually produced:

```bash
ls .artifacts/<KEY>/screenshots/persona-*.png
```

For each selected persona, at least ONE file matching `persona-<persona-id>-task-*-step-*.png` MUST exist.

**Screenshot uniqueness validation (FATAL — will block Phase B):**

Different tasks MUST produce visually different screenshots (they test different features/flows). After capture, verify dynamically based on the actual task count from `extract-state.json > tasks_to_be_done`:

```bash
# Loop over actual tasks (do NOT hardcode task-1, task-2, task-3)
TASK_COUNT=$(node -e "const d=require('.artifacts/<KEY>/extract-state.json'); console.log(d.tasks_to_be_done.length)")
for persona in <selected personas>; do
  for i in $(seq 1 $TASK_COUNT); do
    for j in $(seq $((i+1)) $TASK_COUNT); do
      md5sum .artifacts/<KEY>/screenshots/persona-${persona}-task-${i}-step-2.png .artifacts/<KEY>/screenshots/persona-${persona}-task-${j}-step-2.png 2>/dev/null
    done
  done
done
```

Compare step-2+ across tasks for each persona. Tasks on the same page may have identical step-1 (same entry) but MUST differ by step-2+ (after the distinguishing interaction).

**If ANY two tasks for the same persona share the same MD5 hash for step-2 AND step-3:**

1. **Diagnose the cause** before retrying:
   - Both screenshots show empty table / "No items found" → **project filter issue** (persona didn't select "All projects"). Fix: ensure `ensureAllProjects()` ran.
   - Both screenshots show homepage / Projects page → **navigation failure** (persona never left the landing page). Fix: check task-to-route mapping.
   - Both screenshots show same data page with same scroll position → **interaction failure** (task functions didn't produce different visual states). Fix: revise task function to include a distinguishing interaction.
2. **Re-run ONLY the colliding persona-task pair** (not the entire script)
3. If still identical after one retry, log as `"screenshot_uniqueness_failed": true` with the diagnosed cause and continue

**Cross-persona check:** For the same task, different personas SHOULD produce different screenshots (different navigation paths, scroll positions, or interaction states based on experience level). If two personas have identical step-2+ screenshots for the same task, log a warning — the persona differentiation may not be working. This is a quality warning, not a blocking failure.

**If persona screenshots do NOT exist:**
- Step 1d was NOT completed — the persona walkthroughs did not actually run
- Do NOT score from Phase A journey evidence alone — that produces inference-only results, not authentic persona traces
- **Fallback:** If sub-agent forking is not available in the current execution context, run persona walkthroughs SEQUENTIALLY in the same Playwright session:
  1. Create a new browser context for each persona
  2. Navigate to the prototype URL
  3. Follow the persona prompt (from Step 1d) to navigate as that persona
  4. Take screenshots at each step: `persona-<persona-id>-task-<N>-step-<M>.png`
  5. Write the think-aloud trace to `usability-thinkaloud-<persona-id>-task-<N>.md`
  6. Close the context, move to next persona

**This step is BLOCKING.** Usability scoring without persona-specific screenshots produces inferior results — scores will be based on what the persona agent actually saw, not what a shared Phase A journey showed.

### Step 1e: Hints as Fallback (the "colleague" pattern)

Navigation hints from `navigation-hints.json` are available to persona agents but ONLY as a fallback after they get stuck. This models the real-world situation where a colleague tells you "it's under the Gen AI Studio section."

The persona agent:
1. First attempts navigation using visible UI + their domain expertise
2. If stuck (element not found, timeout): consults hints
3. Logs `navigate-assisted` on the step
4. Usability impact: assisted steps cap dimension scores at 1

This preserves the discoverability signal while preventing walkthroughs from being completely blocked.

### Step 2: Apply Persona Constraints to Journey Evidence

After persona walkthroughs complete, read each persona's output:
- `.artifacts/<KEY>/usability-thinkaloud-<persona-id>-task-<N>.md`
- `.artifacts/<KEY>/screenshots/persona-<persona-id>-task-<N>-step-<M>.png`

For each persona's trace, assess:
1. **Comprehension** — did the persona understand the UI elements? Check against domain_knowledge map.
2. **Patience drain and recovery** — apply the model from `.context/usability-testing/prompts/evaluate-flow.md` exactly as specified:

   **Drain rates (per persona patience attribute from YAML):**
   - High patience: -5% per confusion event, -10% per dead end
   - Medium patience: -10% per confusion event, -20% per dead end
   - Low patience: -15% per confusion event, -30% per dead end
   - At 0%: accept assisted navigation if available, otherwise abandon

   **Recovery (on successful sub-task completion):**
   - High patience: +10% per success (cap at 100%)
   - Medium patience: +5% per success (cap at 100%)
   - Low patience: +5% per success (cap at 100%)
   - Recovery only applies after frustration occurred. No recovery if never frustrated.
   - Assisted navigation recovery: +15% (got unstuck, but step is still a failure)

   **CRITICAL:** Apply these rates mechanically from the think-aloud trace events. Count the logged confusion events, dead ends, and successful sub-tasks. Do NOT infer additional drain from step count, time spent, or subjective assessment. The formula is:
   ```
   patience_end = 100 - SUM(drain from confusion events) - SUM(drain from dead ends) + SUM(recovery from successes)
   ```
   Clamp between 0 and 100.

3. **Knowledge gaps** — moments where persona constraints caused confusion
4. **Assisted navigation** — steps marked `navigate-assisted` are FAIL evidence for usability

Produce per-persona journey overlay with `patience_start`, `patience_end`, `confusion_events`, `cli_escapes`, `would_complete`.

### Step 3: Score 7 Usability Dimensions

Read rubric from `.context/usability-testing/prompts/evaluate-flow.md`. Score 0-3 per dimension:

| # | Dimension | Measures |
|---|-----------|----------|
| 1 | Workflow Continuity & Integrity | Complete flow without infrastructure cliffs? |
| 2 | Cross-Persona Context & Handoffs | Context preserved across roles? |
| 3 | Scalability & Progressive Complexity | Serves both novices and experts? |
| 4 | System Status, Observability & Trust | UI explains waits and failures? |
| 5 | Technical Abstraction & Signal-to-Noise | Relevant info or infrastructure leaks? |
| 6 | Mental Model Fidelity | UI speaks user's language? |
| 7 | Accessibility & Inclusion | Keyboard nav, screen readers? |

Scale: 0=Broken, 1=Fragmented, 2=Functional, 3=Seamless.

**Score stabilization rules:**
- Assisted navigation caps score at 1 for affected dimension
- Use strictest interpretation (expected path, not alternate paths)
- Journey count must be deterministic (from extract-state.json)

**DIMENSION 2 CONTEXT RULE (Cross-Persona Handoffs):**
If ALL of the following are true:
  - extract-state.json has only 1 persona type in journey_definitions (e.g., only "data scientist" variants)
  - No AC mentions "handoff", "collaboration", "share", "another user", or "another role"
  - The feature is inherently single-user (creation, viewing, configuration — not admin→user workflows)
Then: Score Dimension 2 as **N/A**. Compute overall_score from 6 dimensions (out of 18 max).
Write `"score": "N/A"` in the CSV usability section and note "single-user feature" in evidence.

If the feature involves ANY cross-role interaction (e.g., admin creates policy, user consumes it):
Score normally using the full rubric criteria.

### Step 4: Append Section 2 to CSV

APPEND to existing `evaluation-report.csv` (do NOT overwrite Section 1):

```
# USABILITY DIMENSIONS
dimension_id,dimension_name,score,confidence,evidence,persona_scores
workflow_continuity,Workflow Continuity,2.5,high,"journey-1 steps 1-4","{""deena-junior"":2,""deena-senior"":3}"
```

**CRITICAL: The `score` column is the composite (average of per-persona scores). Preserve decimal
values — if one persona scores 2 and another scores 3, write `2.5` not `2`. Do NOT floor or round.**

The `persona_scores` column stores individual scores as a JSON object for attribution.

### Step 5: Annotate traces and write think-aloud files

For each persona-task trace, do two things:

**5a. AC evidence attribution:** For each step in the persona's trace, set `evidence_for_acs: string[]` — the AC IDs this step provides evidence for. Cross-reference `covers_acs` from the task definition with what was actually observed. Steps with no AC relevance get `[]`.

**5b. Write think-aloud markdown:** Write `.artifacts/<KEY>/usability-thinkaloud-<persona-id>-task-<N>.md` with Phase 1 Actor steps (already captured during Step 1d) plus a brief key insight:

```markdown
# Think-Aloud Trace: <Persona Name>
## Task: <task description>

STEP 1:
- What I see: [from screenshot evidence]
- What I'm thinking: [in-character]
- What I'll try: [action]
- Confidence: [high/low/none]
- Patience: [X%]

STEP 2:
...

NAVIGATION COMPLETE:
- Outcome: [Completed / Abandoned]
- Final patience: [X%]
- Confusion events: [count]

---

Key insight: [1-2 sentences — the most actionable finding from this persona's experience]
```

Use per-task naming (`-task-<N>.md`) even for single-task runs. Phase 1 steps are the primary content — the report's Personas tab renders these via `parseTaSteps`.

**Note:** Dimension scoring is handled in Step 3, not here. Do NOT re-score dimensions in the markdown — that was duplicate work the renderer never consumed.

### Step 6: Write persona-results.json

**ALWAYS produce this file**, regardless of single-task or multi-task runs. This structured JSON is the canonical source for persona walkthrough data consumed by the report renderer.

Write to: `.artifacts/<KEY>/persona-results.json`

**Post-write validation** — after writing persona-results.json, verify every entry
has a non-null `persona` field and a valid `task_index`. Entries with
`persona: null` or `persona: None` break two downstream consumers:
the `persona_ids_present` scorer rejects the entire file, and Step 8's
usability_dimensions consolidation silently drops entries it cannot key by persona.

```python
# Validate immediately after writing:
import json
pr = json.loads(open('.artifacts/<KEY>/persona-results.json').read())
for i, e in enumerate(pr):
    assert e.get("persona"), f"Entry {i} missing persona field"
    assert e.get("task_index") is not None, f"Entry {i} missing task_index"
```

Format: array of persona-task results, one entry per persona per task:

```json
[
  {
    "persona": "<persona-id>",
    "persona_name": "<Full Display Name>",
    "task_index": 1,
    "task": "<task description from tasks_to_be_done>",
    "trace": [
      {
        "step": 1,
        "what_i_see": "...",
        "what_im_thinking": "...",
        "action": "...",
        "confidence": "high|medium|low",
        "patience": 100,
        "screenshot": ".artifacts/<KEY>/screenshots/persona-<id>-task-1-step-1.png",
        "evidence_for_acs": ["AC-1"]
      }
    ],
    "screenshots": ["<paths>"],
    "patience_start": 100,
    "patience_end": 85,
    "confusion_events": 1,
    "assisted": false,
    "would_complete": true,
    "outcome": "completed"
  }
]
```

Even for single-task runs, wrap the single task with `task_index: 1`. This eliminates the need for fallback paths in the renderer.

**VALIDATION GATE (BLOCKING):** After writing persona-results.json, verify that EVERY entry has a non-empty `trace[]` array. If any entry has `trace: []` (empty), the walkthrough for that persona-task pair FAILED to produce live trace data and MUST be re-run (return to Step 1d for that persona-task). Do NOT proceed to Step 7 with empty traces — this was the root cause of the hydrate dependency.

### Step 7: Generate refinement suggestions

For dimensions scoring 0-1, generate suggestions:

```json
{
  "type": "usability",
  "dimension": "workflow_continuity",
  "score": 1,
  "persona": "deena-junior",
  "problem": "...",
  "suggested_fix": "...",
  "affected_files": [],
  "evidence_steps": [],
  "confidence": "high|medium|low"
}
```

Rules:
- Only for scores 0-1 (2-3 are acceptable)
- Must include specific persona and evidence steps
- Do NOT suggest fixes for FLAGGED criteria
- `confidence: "low"` items are logged but NOT auto-applied by eval-fix

### Step 7b: Capture final-state screenshot (skip if no fix loop ran)

**Skip this step if no fix loop ran** (check: `fix-log.json` does not exist OR `iteration-log.json` shows `iteration: 1` with `fail_count: 0`). The baseline-after screenshot is only meaningful when comparing against baseline-before to show fix impact. When no fixes were applied, both screenshots would be identical — wasted Playwright invocation and report bloat.

If the fix loop DID run, capture a screenshot of the **primary page being tested** (the same page eval-verify captured for `baseline-before.png`):

```javascript
// PAIRED with eval-verify Step 2a (baseline-before.png).
// Both captures MUST use identical addInitScript setup so the only
// visual difference is actual code changes, not browser state drift.
const primaryRoute = componentMap ? componentMap.target_page : inferPrimaryRoute(extractState);

const ctx = await browser.newContext({ viewport: { width: 1920, height: 900 } });
const page = await ctx.newPage();
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
await page.screenshot({ path: '.artifacts/<KEY>/screenshots/baseline-after.png', fullPage: false });
await ctx.close();
```

This pairs with `baseline-before.png` to show how the prototype changed during evaluation. Both captures use identical `addInitScript` setup — the only visual difference should be actual code changes from the fix loop, not browser state differences.

### Step 8: Write usability_dimensions to journey-log.json

**BLOCKING FORMAT REQUIREMENTS — render-report.js will produce broken output without these exact fields:**

The following top-level fields inside `usability_dimensions` are REQUIRED:
- `personas_evaluated` — array of persona IDs (e.g., `["maude-experienced", "maude-junior"]`). NOT inside persona_selection — at the TOP level.
- `dimensions[].composite_score` — number, the average of persona scores for that dimension. NOT just `score`.
- `think_aloud.traces` — array with one entry **per persona per task** containing `narration_summary`, `confusion_events` count, `dimension_scores`, `task_index`, and per-task `patience_end`

**CRITICAL — per-task patience tracking:**
- Patience resets to 100% at the start of each task (each task runs in an independent browser context/sub-agent).
- `persona_overlays` entries MUST include `task_index` and pull `patience_start`, `patience_end`, `confusion_events` from the matching `persona-results.json` entry — NOT collapsed across tasks.
- `think_aloud.traces` entries MUST include `task_index` and use per-task values from `persona-results.json` — NOT broadcast the same persona-level aggregate to every task.
- If two confusion events from different tasks both occurred at step 3, they are disambiguated by `task_index`.

Also in Step 6 (`persona-results.json`): output MUST be an **array** of objects, NOT a dict keyed by persona ID.

```json
{
  "usability_dimensions": {
    "source": "automated-usability-testing",
    "personas_evaluated": ["maude-experienced", "maude-junior"],
    "persona_selection": { "method": "automatic", "selected": [...], "reasoning": "..." },
    "dimensions": [
      {
        "id": "workflow_continuity",
        "name": "Workflow Continuity & Integrity",
        "scores": {
          "maude-experienced": { "score": 3, "confidence": "High", "finding": "Full flow works" },
          "maude-junior": { "score": 2, "confidence": "Medium", "finding": "Gets confused by..." }
        },
        "composite_score": 2.5
      }
    ],
    "overall_score": "15.5/21",
    "persona_overlays": [
      {
        "persona": "maude-experienced",
        "persona_name": "Maude - Experienced MLOps Engineer",
        "task_index": 1,
        "patience_start": 100,
        "patience_end": 100,
        "abandoned": false,
        "confusion_events": [
          { "step": 3, "trigger": "Column headers truncated", "knowledge_gap": "ui: expected", "patience_cost": -5 }
        ],
        "cli_escapes": 0,
        "would_complete": true
      },
      {
        "persona": "maude-experienced",
        "persona_name": "Maude - Experienced MLOps Engineer",
        "task_index": 2,
        "patience_start": 100,
        "patience_end": 100,
        "abandoned": false,
        "confusion_events": [],
        "cli_escapes": 0,
        "would_complete": true
      }
    ],
    "think_aloud": {
      "personas_evaluated": ["maude-experienced"],
      "traces": [
        {
          "persona": "maude-experienced",
          "task_index": 1,
          "outcome": "completed",
          "patience_end": 100,
          "confusion_events": 1,
          "cli_escapes": 0,
          "response_strategies": { "help_seeking": 0, "guess_and_continue": 0, "abandon": 0 },
          "expected_vs_actual": [
            { "step": 3, "expected": "Hover tooltip", "actual": "Expandable row", "impact": "Better than expected" }
          ],
          "missing_feedback": [],
          "dimension_scores": { "workflow_continuity": { "score": 3, "confidence": "High" } },
          "narration_summary": "1-2 sentence summary of this persona's experience on this specific task."
        },
        {
          "persona": "maude-experienced",
          "task_index": 2,
          "outcome": "completed",
          "patience_end": 100,
          "confusion_events": 0,
          "cli_escapes": 0,
          "dimension_scores": { "workflow_continuity": { "score": 3, "confidence": "High" } },
          "narration_summary": "Summary of task 2 experience."
        }
      ]
    }
  }
}
```

#### CRITICAL FORMAT RULES for render-report.js

- `persona_overlays` MUST always be populated (one entry per persona **per task** — NOT collapsed across tasks)
- `confusion_events[].step` MUST be a NUMBER matching `journey.steps[].step` (e.g., `2`, not `"journey-1 step 2"`)
- `dimensions[].id` MUST use the 7 standard IDs (workflow_continuity, cross_persona_handoffs, etc.)
- `dimensions[].scores` MUST be keyed by persona ID with `{score, confidence, finding}`
- `think_aloud.traces` MUST be populated when `--usability=deep` — this is what renders the persona insights in the report
- `think_aloud.traces[].task_index` MUST be present — one trace entry per persona per task, NOT one per persona
- `think_aloud.traces[].patience_end` MUST be the per-task value from `persona-results.json`, NOT the persona-level aggregate
- `think_aloud.traces[].confusion_events` scalar MUST equal the count for THAT SPECIFIC TASK, pulled from the matching `persona-results.json` entry
- `think_aloud.traces[].narration_summary` appears in the Personas tab as the think-aloud narrative
- `overall_score` MUST be a string in "X/21" format
