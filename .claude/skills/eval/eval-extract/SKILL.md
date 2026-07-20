---
name: eval-extract
description: Extract Jira context, acceptance criteria, personas, journeys, MR deltas, and breadcrumb for the eval pipeline. Entry point that produces all upstream artifacts.
user-invocable: false
allowed-tools: Read, Write, Bash, Glob, Grep, mcp__atlassian__getJiraIssue, mcp__atlassian__searchJiraIssuesUsingJql
---

<!-- Model: Sonnet-tier for most steps (data retrieval + JSON assembly). Only Step 5b (tasks_to_be_done rephrasing) benefits from a stronger model. -->

# eval-extract

Phase 1 of the eval pipeline. Gathers all context needed for evaluation from Jira, the RFE, the workspace, and decision history. Writes structured JSON artifacts that downstream skills read.

## Phased Execution

eval-extract runs in two phases to minimize Phase A cold-start time:

- `--phase=core` (default): Steps 0-5, 8-9. Produces `extract-state.json` and `mr-delta.json`. This is all Phase A needs for AC validation.
- `--phase=enrichment`: Steps 5b, 6-7. Produces `outcome-context.json`, `tasks_to_be_done`, and `breadcrumb`. Only needed before Phase B (persona walkthroughs).

When called without `--phase`, runs all steps (legacy behavior).

## Inputs


| Input                                          | Description                                             | Required          |
| ---------------------------------------------- | ------------------------------------------------------- | ----------------- |
| Jira story key                                 | e.g., `RHAISTRAT-1536`                                  | Yes               |
| `--workspace`                                  | Path to prototype repo (for MR delta extraction)        | No                |
| `--phase`                                      | `core` (Steps 0-5, 8-9) or `enrichment` (Steps 5b, 6-7) | No (default: all) |
| `--force-extract`                              | Skip cache check and re-fetch from Jira                 | No                |
| `.artifacts/<KEY>/rfe-snapshot.md`             | Frozen RFE content from prototype creation              | No                |
| `.artifacts/<KEY>/decisions/decisions.json`    | Design decisions from prototype creation                | No                |
| `.artifacts/<KEY>/decisions/strategy-brief.md` | Strategy brief from creation                            | No                |
| `config/product-overlay.yaml`                  | Product-specific config (Jira URLs, git conventions)    | Yes               |




## Outputs


| File                                    | Description                                                       |
| --------------------------------------- | ----------------------------------------------------------------- |
| `.artifacts/<KEY>/extract-state.json`   | `{ ac_list, journey_definitions, breadcrumb, persona_selection }` |
| `.artifacts/<KEY>/mr-delta.json`        | Git diff analysis (when `--workspace` provided)                   |
| `.artifacts/<KEY>/outcome-context.json` | Parent Outcome ticket context (if discoverable)                   |




## Procedure



### Step 0: Cache Check (content-based)

Before fetching from Jira, check if cached artifacts exist and are still valid:

```
if .artifacts/<KEY>/extract-state.json exists AND --force-extract NOT set:
  Read ac_content_hash field from the file (MD5 of ticket description + ACs)
  
  # Quick Jira check: fetch ONLY description field to compare content hash
  ticket = mcp__atlassian__getJiraIssue(issueIdOrKey: "<KEY>", fields: ["description"])
  current_hash = MD5(ticket.description)
  
  if ac_content_hash == current_hash:
    echo "Using cached extract (ACs unchanged). Pass --force-extract to re-fetch."
    EXIT EARLY — skip Steps 1–9, reuse existing artifacts
  else:
    echo "Ticket description changed since last extract — re-extracting."
    Proceed with full extraction
else:
  Proceed with full extraction (no cache or forced)
```

The cache stays valid as long as the ticket's acceptance criteria haven't changed, even if the ticket was updated (status change, comments added, etc.). This prevents unnecessary re-extraction when eval-iterate adds comments to the ticket.

### Step 1: Fetch Jira Story

```
mcp__atlassian__getJiraIssue(
  issueIdOrKey: "<KEY>",
  fields: ["summary", "description", "status", "issuetype", "issuelinks", "parent", "labels", "components"],
  responseContentFormat: "markdown"
)
```

Fallback if MCP unavailable:

```bash
python3 scripts/fetch_rfe.py <KEY> --fields summary,description,acceptance_criteria,issuelinks --markdown
```

**Cache raw ticket fields for enrichment phase:** Save `parent` and `issuelinks` from the Jira response into `extract-state.json` as `raw_parent` and `raw_issuelinks`. The enrichment phase (Steps 6-7) needs these to discover the Outcome ticket without re-fetching from Jira.



### Step 2: Extract Acceptance Criteria

Extract ACs from the input ticket. ACs can live on either the STRAT ticket or the linked RFE — check both.

**Search order:**
1. The STRAT ticket description (from Step 1) — look under "Acceptance Criteria", Given/When/Then blocks, or checkbox lists.
2. If no ACs found on the STRAT, and a linked RFE is discovered in Step 4, check the RFE description for ACs using the same patterns.
3. If neither ticket has ACs, stop and ask the user.

**Rules (apply to both STRAT and RFE sources):**

- Copy each criterion verbatim. Do NOT paraphrase.
- Each Given/When/Then block = ONE criterion.
- Each bullet/number = ONE criterion.
- Number them AC-1, AC-2, etc. in order of appearance.
- Do NOT split or merge criteria.
- Do NOT generate criteria from source code or personas.

**ID and source rules:**

- Jira-sourced: `criterion_id` = `AC-1`, `source` = `jira`, `source_ticket` = `<key of ticket where ACs were found>`
- Evaluator-inferred (nav reachability, flag checks): `NAV-1`, `FLAG-1`, `EVAL-1`, `source` = `inferred`

### Step 3: Extract Feature Context and Supporting Documentation

Scan the STRAT and RFE descriptions (whichever is available) for these sections. Extract them verbatim when present:

**Feature context sections (for the report — plain-language "why this matters"):**
- **Background** — Why this feature exists, what problem it solves
- **Problem Statement** — The user pain point being addressed
- **User Stories** — "As a [role], I want to [goal]" blocks
- **UI Enhancements / Proposed Solution** — What the prototype should demonstrate (new columns, status indicators, tooltips, panels, etc.)

Store these in `extract-state.json` as `feature_context`:
```json
{
  "feature_context": {
    "background": "<verbatim or null>",
    "problem_statement": "<verbatim or null>",
    "user_stories": ["<verbatim story 1>", "<verbatim story 2>"],
    "ui_enhancements": "<verbatim or null>",
    "source_ticket": "<key of ticket these were extracted from>"
  }
}
```

These sections inform the report reader about what the prototype is for, in the designers' and stakeholders' own words. They do NOT affect AC extraction or evaluation logic.

**Supporting documentation references:**
Also look for "Supporting Documentation" sections. Extract references and map each to the AC it serves:

- Source RFE links, UX Research links, Architecture docs
- Reference UI URLs, Design docs, ADRs

Build a criterion-to-reference map for tier classification (used by eval-classify).

### Step 4: Discover Linked RFE (multi-strategy, short-circuit)

**Skip Jira fetch if rfe-snapshot.md exists:** If `.artifacts/<KEY>/rfe-snapshot.md` exists and is non-empty, use it as the authoritative RFE source. Extract the RFE key from its content (look for `RHAIRFE-\d+` pattern) and set `rfe_key` without fetching from Jira. Proceed directly to Step 5.

**Otherwise**, try discovery strategies in order. **Stop on first match** — do not run remaining strategies after a match is found:

**Strategy 1:** Parse `issuelinks` from Step 1 — check both `inwardIssue` and `outwardIssue` for Cloners relationship. **If found → stop, fetch RFE.**

**Strategy 2:** JQL search:

```
issue in linkedIssues("<STRAT-KEY>") AND project = RHAIRFE
```

**If found → stop, fetch RFE.**

**Strategy 3:** Text scan the description for `RHAIRFE-\d+` patterns. **If found → stop, fetch RFE.**

If ALL strategies fail, warn the user and proceed with `rfe_key: null`.

### Step 5: Extract Personas and Define Journeys

Sources (priority order):

1. **`.artifacts/<KEY>/outcome-context.json > scenario_flow.flow`** — if this file already exists from a *prior* run's enrichment phase (see Step 7) and contains a `scenario_flow.flow`, use it as the highest-priority seed for `expected_path`. This is the Outcome's plain-language "Flow" — written before the RFE or prototype existed — describing the intended user journey at the intent level.
2. `.artifacts/<KEY>/rfe-snapshot.md` — most reliable
3. Jira ticket from Step 1
4. Linked RFE from Step 4

**Phasing note:** Outcome fetch (Step 7) is an *enrichment*-phase step that runs after Phase A, to keep Phase A cold-start fast (see "Phased Execution" above). On a fresh `.artifacts/<KEY>/` (first-ever run), `outcome-context.json` does not exist yet when this step runs, so source 1 is unavailable and Step 5 falls back to source 2/3/4 as before — this is expected, not a bug. On any *subsequent* run against the same key (the common case — designers iterate and re-run eval repeatedly), `outcome-context.json` from the previous run's enrichment phase is already on disk, so this step can opportunistically use it. Do not add a Jira/Outcome fetch call directly into Step 5 to close this gap for first runs — that would reintroduce the cold-start cost the phase split was designed to avoid.

Extract personas from Target Audience / Affected Customers. Derive goals from Problem Statement + Proposed Solution. Build journey definitions from ACs that describe user actions.

Cross-reference with strategy brief and decisions.json if available.

Each journey includes: `id`, `title`, `persona`, `source`, `ac_ids`, `expected_path` (steps).

**Source labeling:** Use explicit user story text if available. Otherwise: `"Inferred from AC-6: <verbatim text>"`. If seeded from the Outcome's Scenario Flow, label as `"Outcome Scenario Flow: <Outcome key> — <Scenario title>"` so the report can distinguish intent-derived journeys from AC-inferred ones. Never synthesize fake user stories.

### Step 5b: Derive Tasks-to-be-Done (for discovery persona walkthroughs)

**Phase gate:** This step runs only with `--phase=enrichment` or no `--phase` flag. Skip when `--phase=core`.

After journeys are defined, produce a `tasks_to_be_done` array in extract-state.json. These are **plain-language user goals** given to discovery personas — NOT acceptance criteria language.

**Sources (priority order):**

1. `outcome-context.json > scenario_flow.win_moment` + `scenario_flow.flow` — the Outcome's structured Scenario, when present (see Step 7). `win_moment` describes the observable signal that the feature is working for real users — often a more concrete, testable task phrasing than a raw problem statement. When `scenario_flow.flow` describes multiple distinct actions, consider splitting it across multiple `tasks_to_be_done` entries rather than collapsing it into one.
2. `outcome-context.json > problem_statement` — the real user problem being solved (fallback when no structured Scenario was found on the Outcome ticket)
3. RFE user stories — "As a [role], I want to [goal] so that [benefit]"
4. Journey titles — rephrased as user tasks

**Source labeling when using scenario_flow:** set `source` to `"Outcome Scenario: <Outcome key> — win moment: <verbatim win_moment text>"` so the report can show this task came from validated upstream intent, not an inference chain.

**Rules:**

- Write as if briefing a usability test participant: "Your task is to..."
- No internal jargon (no "Given/When/Then", no "DSC", no "AC-1")
- Should be completable by looking at the UI — not require backend knowledge
- 1-3 tasks per eval (map to the main user flows, not one per AC)
- **Route diversity rule:** If multiple tasks would navigate to the same page/route, differentiate them by INTERACTION (e.g., "expand a row to see details" vs "compare status labels across rows" vs "check what happens when the feature is disabled"). Tasks on the same page are fine as long as they test different interactions or visual states.

**Examples:**

- Bad: "Given Kueue is enabled in the DSC and the namespace has the managed label, verify scheduling status displays"
- Good: "Find out why your model deployment is queued and when it will be ready"
- Bad: "Verify that Kueue columns are hidden when feature is not enabled"
- Good: "Check if there's any scheduling information visible for your deployments"

**Output format in extract-state.json:**

```json
{
  "tasks_to_be_done": [
    {
      "task": "Find out why your model deployment is queued and when it will be ready",
      "source": "Outcome problem statement: ML engineers cannot see why deployments are delayed",
      "covers_acs": ["AC-1", "AC-4", "AC-6"]
    }
  ]
}
```

**After generating tasks_to_be_done**, compute uncovered ACs:

```
uncovered = ac_list.filter(ac => no task in tasks_to_be_done has ac.criterion_id in covers_acs)
```

If any ACs are uncovered, add to extract-state.json:

```json
{
  "phase_a_only_acs": [
    { "criterion_id": "AC-9", "reason": "backend-only (BFF size limit)" }
  ]
}
```

These ACs will be verified by Phase A (code analysis + Playwright) but NOT exercised in Phase B persona walkthroughs. The report will show them with a "Phase A only" badge.

### Step 6: Build Breadcrumb

**Phase gate:** This step runs only with `--phase=enrichment` or no `--phase` flag. Skip when `--phase=core`.

Trace: Outcome → RFE → STRAT → Prototype (branch/MR) → Eval Report.

- **STRAT**: The ticket being evaluated
- **RFE**: From Step 4
- **Prototype/MR**: From workspace git remote or Jira remote links
- **Outcome**: From Step 7

Each entry has `key`, `url`, `validated` (true if confirmed via API).

### Step 7: Fetch Parent Outcome

**Phase gate:** This step runs only with `--phase=enrichment` or no `--phase` flag. Skip when `--phase=core`.

**Use cached data first:** Read `raw_parent` and `raw_issuelinks` from `extract-state.json` (saved during core phase Step 1). These contain the STRAT ticket's parent and issue links — no need to re-fetch from Jira. Only make additional Jira calls if the cached data doesn't contain the Outcome.

Multi-strategy search. **Stop on first match** — do not run remaining strategies:

1. RFE's `parent` field → **if found, stop**
2. STRAT's `parent` field → **if found, stop**
3. RFE's `issuelinks` for "is child of" relationships → **if found, stop**
4. JQL: `issue in linkedIssues("<RFE-KEY>") AND issuetype = Outcome` → **if found, stop**
5. JQL: `issue in linkedIssues("<STRAT-KEY>") AND issuetype = Outcome` → **if found, stop**

If ALL strategies fail, write `outcome-context.json` with `null` values and warn. Step 5b will fall back to deriving tasks from journey titles.

Extract: key, title, problem_statement, user_journey, acceptance_criteria, connected_rfes.

**Also extract `scenario_flow` — the Outcome's structured Scenario block, if present.** Outcome Creator's own template (`andybraren/outcome-creator > templates/outcome-template.md`) defines this format per delivery phase:

```
#### Scenario: [Title]
- **Actors:** [Who is involved]
- **Context:** [When/where this happens]
- **Flow:** [Concise, plain-language steps — roles, decisions, handoffs]
- **Win moment:** [Observable signal that Next is real]
```

Scan the Outcome ticket's description for a `#### Scenario:` heading matching this shape (under either the `### Next` or `### Future` phase section — prefer `### Next` if both exist, since that's the near-term delivery slice this eval run is most likely validating). If found, extract:

```json
{
  "scenario_flow": {
    "found": true,
    "title": "<Scenario title>",
    "actors": "<verbatim Actors text>",
    "context": "<verbatim Context text>",
    "flow": "<verbatim Flow text>",
    "win_moment": "<verbatim Win moment text>",
    "phase": "Next | Future"
  }
}
```

**If no `#### Scenario:` heading is found** (the Outcome ticket may only contain prose, or Outcome Creator may keep this structure in its own repo artifacts rather than writing it into the Jira description — unconfirmed as of 2026-07-20, worth checking with Andy/Yahav), write:

```json
{ "scenario_flow": { "found": false } }
```

Do NOT fabricate a Scenario block when one isn't present — `found: false` is a valid, expected result and Step 5/5b already handle it by falling back to `problem_statement`/AC-inference.

Write to `.artifacts/<KEY>/outcome-context.json`.

### Step 8: Extract MR Deltas (when `--workspace` provided)

```bash
cd <workspace-path>
BASE=$(git merge-base HEAD origin/3.5 2>/dev/null || git merge-base HEAD origin/main 2>/dev/null || echo "")
git diff $BASE...HEAD --name-only > /tmp/changed-files.txt
git diff $BASE...HEAD --stat > /tmp/diff-stats.txt
```

Categorize changes: new pages/components, modified components, route/nav changes, feature flag changes, style changes, test changes.

Flag navigation gaps: if new pages added but no route/nav files modified.

Write to `.artifacts/<KEY>/mr-delta.json`.

### Step 9: Write extract-state.json

**Phase behavior:**

- `--phase=core`: Write `extract-state.json` with `ac_list`, `journey_definitions`, `persona_selection`, `rfe_key`, `decision_context`. Leave `tasks_to_be_done`, `phase_a_only_acs`, and `breadcrumb` empty/null — they will be populated by the enrichment phase.
- `--phase=enrichment`: Read existing `extract-state.json`, merge in `tasks_to_be_done`, `phase_a_only_acs`, and `breadcrumb` from Steps 5b, 6, 7. Write updated file.
- No `--phase` flag: Write everything at once (legacy behavior).

Assemble all extracted data into the handoff artifact:

```json
{
  "key": "<KEY>",
  "title": "<story title>",
  "extracted_at": "<ISO timestamp>",
  "ac_content_hash": "<MD5 of ticket description used for cache validation>",
  "ac_list": [
    { "criterion_id": "AC-1", "source": "jira", "source_ticket": "<KEY>", "text": "<verbatim>", "references": [] }
  ],
  "feature_context": {
    "background": "<verbatim or null>",
    "problem_statement": "<verbatim or null>",
    "user_stories": ["<story 1>", "<story 2>"],
    "ui_enhancements": "<verbatim or null>",
    "source_ticket": "<key of ticket these were extracted from>"
  },
  "journey_definitions": [
    { "id": "journey-1", "title": "...", "persona": "...", "source": "...", "ac_ids": ["AC-1"], "expected_path": [] }
  ],
  "breadcrumb": { "outcome": null, "rfe": null, "strat": {}, "prototype": null, "mr": null },
  "persona_selection": { "selected": [], "target_audience_text": "", "reasoning": "" },
  "rfe_key": "<key or null>",
  // Internal cache fields (not consumed by downstream skills):
  "raw_parent": "...",        // Used by enrichment phase only
  "raw_issuelinks": "...",    // Used by enrichment phase only
  "decision_context": { "has_decisions": false, "deliberate_descopes": [] }
}
```

This file is the single handoff artifact. All downstream eval skills read it. It is produced once on iteration 1 and cached for subsequent iterations.