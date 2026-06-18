---
name: prototype-evaluate
description: Evaluate a prototype against its Jira acceptance criteria — PASS, FAIL, or FLAGGED per criterion. Extracts context, runs Playwright journeys, scores usability dimensions, and generates reports.
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, mcp__atlassian__getJiraIssue, mcp__atlassian__searchJiraIssuesUsingJql, mcp__atlassian__addCommentToJiraIssue
---

# prototype-evaluate (Phase 1: Extract)

This is the **entry point** for the full prototype evaluation pipeline. It extracts context from Jira, then chains to Phase 2 (journey) and Phase 3 (usability) automatically.

## Prerequisites — Read This First

Before running an eval, ensure the required context directories are bootstrapped:

```bash
make context
```

| Directory | What it provides | Phase that uses it |
|-----------|-----------------|-------------------|
| `.context/usability-testing/personas/` | Persona YAML files | Phase 3 (evaluate-usability) |
| `.context/usability-testing/prompts/evaluate-flow.md` | 7-dimension rubric | Phase 3 |
| `.context/consistency-checker/guidelines/` | PatternFly design guidelines | Phase 2 (evaluate-journey) |
| `.context/consistency-checker/scripts/analyze.py` | Source code analysis | Phase 2 |

**Product overlay:** Read `config/product-overlay.yaml` for product-specific config (Jira URLs, git conventions, MR mappings).

## Usage

```
/prototype-evaluate RHAISTRAT-1536 http://localhost:3000
/prototype-evaluate RHAISTRAT-1536 http://localhost:4200 --depth=thorough --usability=deep
```

## Inputs

| Input | Example | Required | Default |
|-------|---------|----------|---------|
| Jira story key | `RHAISTRAT-1536` | Yes | — |
| Prototype URL | `http://localhost:3000` | Yes | — |
| `--depth` | `quick` or `thorough` | No | `quick` |
| `--usability` | `deep` or `thorough` | No | Inference only (Step 3b) |
| `--feed-to-refine` | flag | No | Off |

Parse from `$ARGUMENTS`.

## Pipeline Flow

This skill executes Phase 1, then chains to Phase 2 and Phase 3:

```
Phase 1 (this file): Extract ACs, personas, journeys, breadcrumb, outcome
    ↓ writes extract-state.json
Phase 2: Read .claude/skills/evaluate-journey/SKILL.md and execute it
    ↓ writes journey-log.json, screenshots, CSV, consistency-report
Phase 3: Read .claude/skills/evaluate-usability/SKILL.md and execute it
    ↓ updates journey-log.json with usability dimensions
Phase 4: Run report scripts:
    node scripts/render-report.js .artifacts/<KEY>/
    node scripts/log-run.js .artifacts/<KEY>/ --note="<description>"
```

**After completing Phase 1 below, continue by reading and executing Phase 2, then Phase 3, then Phase 4.**

## Outputs (Phase 1)

| File | Description |
|------|-------------|
| `.artifacts/<KEY>/mr-delta.json` | Git diff analysis of what the prototype changed |
| `.artifacts/<KEY>/outcome-context.json` | Parent Outcome ticket context (if available) |
| `.artifacts/<KEY>/extract-state.json` | Handoff: `{ ac_list, journey_definitions, breadcrumb, persona_selection }` |

## Conversational Guidance

If the user invokes without both inputs, ask:

> I need two things to run the evaluation:
> 1. The Jira story key (e.g., `RHAISTRAT-1536`)
> 2. The prototype URL (e.g., `http://localhost:3000`)

---

## Phase 1 Steps

---

## Step 0b: Extract MR Deltas (when workspace is available)

If the eval is running against a `--workspace`, extract the MR diff to understand exactly what the prototype changed. This data feeds into Steps 1-3 to focus the eval on what's new.

**Skip this step** if no workspace is available (standalone HTML prototypes).

### How to extract

Run from the workspace directory:

```bash
cd <workspace-path>

# Detect base branch (usually origin/3.5 or origin/main)
BASE=$(git merge-base HEAD origin/3.5 2>/dev/null || git merge-base HEAD origin/main 2>/dev/null || echo "")

# Get changed files
git diff $BASE...HEAD --name-only > /tmp/changed-files.txt

# Get diff stats
git diff $BASE...HEAD --stat > /tmp/diff-stats.txt
```

### Categorize changes

Read the changed file list and categorize:

- **New pages/components**: files in `src/pages/` or `src/components/` that are additions (not modifications)
- **Modified components**: existing files with changes
- **Route/nav changes**: changes to routing files (`AppLayout.tsx`, `AppRoutes.tsx`, nav config files, sidebar config). **If new pages were added but NO route/nav files were modified, flag this as "new pages may not be navigable."**
- **Feature flag changes**: changes to feature flag files or flag references
- **Style changes**: CSS/SCSS modifications
- **Test changes**: test file additions or modifications

### Save to `mr-delta.json`

Write to `.artifacts/<KEY>/mr-delta.json`:

```json
{
  "mr_number": 175,
  "base_branch": "3.5",
  "total_files_changed": 12,
  "new_files": [
    "src/pages/AgentCatalog/AgentCatalog.tsx",
    "src/pages/AgentCatalog/AgentCatalogDetail.tsx",
    "src/pages/AgentCatalog/data/starterKits.json"
  ],
  "modified_files": [
    "src/app/AppRoutes.tsx"
  ],
  "route_changes": true,
  "nav_changes": false,
  "feature_flag_changes": false,
  "nav_warning": "New pages added (AgentCatalog) but AppLayout.tsx/sidebar config was NOT modified — pages may not be navigable via sidebar",
  "new_routes": ["/ai-hub/agents/catalog", "/ai-hub/agents/catalog/:id"],
  "summary": "Added Agent Catalog with 3 new page files and 1 route registration. Sidebar nav was NOT updated."
}
```

### How this feeds into later steps

- **Step 1a**: If an AC mentions a feature, check whether related files appear in the delta. If they don't, note "this feature was not part of this MR."
- **Step 2**: Check changed files FIRST for AC evidence. If new pages were added but nav wasn't updated, flag nav registration gap BEFORE Playwright even runs.
- **Step 3**: When a Playwright journey gets stuck (persona can't find a page), use the delta as a "colleague hint" — provide the new route URL so the journey can continue with `navigate-assisted`. Score both the unassisted attempt and the assisted continuation.
- **Step 4**: Report includes a "What Changed" section showing the delta summary.

## Step 1: Load the Jira Story and Extract Context

Fetch the story using MCP. **You MUST include `issuelinks` and `parent` in the fields array** — these are not returned by default and are required for RFE/Outcome discovery in Steps 1c and 1d:

```
mcp__atlassian__getJiraIssue(issueIdOrKey: "<KEY>", fields: ["summary", "description", "status", "issuetype", "issuelinks", "parent", "labels", "components"], responseContentFormat: "markdown")
```

If MCP is unavailable, fall back to the REST script:

```bash
python3 scripts/fetch_rfe.py <KEY> --fields summary,description,acceptance_criteria,issuelinks --markdown
```

### 1a: Extract Acceptance Criteria

**CRITICAL: Use the STRAT's acceptance criteria EXACTLY as written. Do not rephrase, merge, split, synthesize, or generate new criteria. Every criterion in the report must be traceable to a specific line in the Jira ticket.**

Look for acceptance criteria in the Jira ticket description under:

- An explicit "Acceptance Criteria" heading (most common)
- Given/When/Then blocks
- Checkbox lists (`- [ ] ...`)
- Numbered requirements under a "Requirements" or "Definition of Done" heading

**Extraction rules:**

1. Copy each criterion verbatim from the ticket. Do NOT paraphrase, shorten, or reword.
2. If the ticket uses Given/When/Then format, each Given/When/Then block is ONE criterion.
3. If the ticket uses bullet points or numbered items, each bullet/number is ONE criterion.
4. Number them AC-1, AC-2, etc. in the order they appear in the ticket.
5. Do NOT split a single criterion into multiple sub-criteria.
6. Do NOT generate criteria from the prototype source code — criteria come from Jira ONLY.
7. Do NOT generate criteria from the usability personas or user stories — those feed into Steps 3b/3c, not into AC extraction.

**Verification step:** After extracting, list all criteria and confirm each one appears word-for-word (or near-verbatim) in the Jira ticket. If a criterion doesn't match, remove it.

**ID and source rules for the CSV:**

- Jira-sourced criteria use `criterion_id` = `AC-1`, `AC-2`, etc. and `source` = `jira`.
- Evaluator-inferred checks (nav reachability, feature flag verification) use a different prefix: `NAV-1`, `FLAG-1`, `EVAL-1`, etc. and `source` = `inferred`. These are NEVER `source: jira`.
- The `criterion_text` for Jira ACs must be the verbatim ticket text. The render script displays this in the "Acceptance Criterion" column — if it doesn't match the ticket, reviewers will notice.
- The report template splits Jira ACs and evaluator checks into separate tables. This split depends on the `source` field being correct.

**Also look for "High Level Requirements"** — some STRAT tickets have both "Acceptance Criteria" and "High Level Requirements" sections. Use the Acceptance Criteria section. The HLRs are broader user stories that inform journeys (Step 1c) but are NOT individual testable criteria.

If no acceptance criteria can be found, stop and tell the user:

> Could not find acceptance criteria in `<KEY>`. The story description may need an "Acceptance Criteria" section before evaluation can run.

### 1b: Extract Supporting Documentation and Map to Criteria

Also look for a "Supporting Documentation" section in the ticket. This section contains reference material critical for evaluating Tier 2–4 criteria. Extract each reference and **assign it to the specific acceptance criterion it serves**.

#### Reference Types

- **Source RFE links** — parent or linked RFE tickets (e.g., `RHAIRFE-1277`)
- **UX Research links** — research findings, user testing results
- **Architecture docs** — component architecture, auth patterns, API docs
- **Reference UI URLs** — links to existing UIs that the prototype should align with
- **Design docs** — Confluence pages, Figma links, design specs
- **ADRs** — Architecture Decision Records

#### Build a Criterion-to-Reference Map

After extracting both the acceptance criteria (Step 1a) and supporting documentation, build an explicit mapping. Match each reference to the criterion it is evidence for:

```
AC-1: "Form-based UI for defining custom roles"
  → No external reference needed (Tier 1)

AC-2: "Granular selection of API groups, resources, verbs"
  → Architecture context: odh-dashboard.md (shows available API groups/resources)

AC-3: "ACM consistency with role creation UI"
  → Reference UI: https://rhoai-0024f5.pages.redhat.com/settings/user-management/roles/create

AC-4: "Validate inputs to ensure RBAC is valid"
  → Architecture context: kube-auth-proxy.md (auth/RBAC patterns)
  → Architecture context: odh-dashboard.md (RBAC permissions section)

AC-5: "Translate k8s terms to user-friendly concepts"
  → UX Research: Role Management Prototype Research Findings
```

If a criterion has no matching reference, note `→ No reference available`. This directly informs the tier classification:

- Has a reference URL the evaluator can fetch → Tier 2 (attempt comparison)
- Has a doc reference but no fetchable URL → Tier 2 (FLAG with pointer for human)
- No reference at all for a cross-system criterion → Tier 2 (FLAG, cannot verify)

Store this map internally. It is used in Step 2 so the evaluator knows *exactly* where to look for each criterion — no discovery needed during evaluation.

If a "Supporting Documentation" section doesn't exist, proceed without it — all cross-system criteria default to FLAGGED with the note: "No supporting documentation in ticket. Cannot verify against external reference."

### 1c: Extract Personas and Define Journeys

Extract personas and their goals to define Playwright journey paths.

#### Where Persona and Journey Data Comes From

The RFE (source feature request) is the primary source of *what* users need and *who* they are. RFEs do NOT always contain formal "As a [role], I want [goal]" user stories. More commonly, they have a structured format with these sections:

- **Problem Statement** — what pain exists today (gives context for the journey)
- **Proposed Solution/Rationale** — the approach chosen (informs expected UI patterns)
- **Acceptance Criteria** — what "done" looks like (defines success checks per journey step)
- **Affected Customers / Target Audience** — who the personas are
- **Reference Documents/Links** — external systems to compare against

**Look for persona and journey data in this priority order:**

1. **The RFE snapshot** (`.artifacts/<KEY>/rfe-snapshot.md`) — prototype-creator saves the full RFE content here during creation. This is the most reliable source.
2. **The Jira ticket fetched in Step 1** — the STRAT ticket may contain its own user stories or a description with enough context to derive journeys.
3. **A linked RFE** — resolve using the multi-strategy approach below.

#### How to Find the Linked RFE from a STRAT Ticket (REQUIRED)

**Every STRAT ticket MUST have a "clones" link to its source RHAIRFE ticket.** This link is found under "Linked work items → clones" in the Jira UI. The link direction varies — sometimes the STRAT clones the RFE, sometimes the RFE is cloned by the STRAT. You must check both inward and outward issues.

Use this multi-strategy approach — exhaust ALL strategies before giving up:

**Strategy 1 — Parse `issuelinks` from the Step 1 response (check both directions):**
- Look for entries where `type.name` is `"Cloners"` OR `type.outward` is `"clones"` OR `type.inward` is `"is cloned by"`
- Check BOTH `inwardIssue.key` AND `outwardIssue.key` — the RFE could be on either side depending on who created the link
- Do NOT filter by `RHAIRFE-*` prefix only — accept any key found via the clones relationship, then verify it by fetching and checking its project key or issue type
- If the linked ticket's key starts with `RHAIRFE-`, it's the RFE
- If it has a different prefix, fetch it and check `issuetype.name` for "Feature Request" or similar

**Strategy 2 — JQL search (both with and without link type filter):**
```
# First try: search for RHAIRFE tickets linked to this STRAT
mcp__atlassian__searchJiraIssuesUsingJql(
  cloudId: "<same-cloud-id>",
  jql: "issue in linkedIssues(\"<STRAT-KEY>\") AND project = RHAIRFE",
  fields: ["summary", "description", "status", "issuetype", "issuelinks", "parent"]
)

# If empty: try without project filter (RFE might have unexpected key)
mcp__atlassian__searchJiraIssuesUsingJql(
  cloudId: "<same-cloud-id>",
  jql: "issue in linkedIssues(\"<STRAT-KEY>\")",
  fields: ["summary", "description", "status", "issuetype", "issuelinks", "parent"]
)
```
From the results, look for tickets with project = RHAIRFE or issuetype containing "RFE"/"Feature Request".

**Strategy 3 — Text scan fallback (if JQL returns empty):**
- Scan the STRAT ticket description text for `RHAIRFE-\d+` patterns
- If found, fetch that ticket to confirm it exists: `mcp__atlassian__getJiraIssue(issueIdOrKey: "<found-key>", fields: ["summary", "description", "issuelinks", "parent"])`

**Once the RFE key is found**, fetch it fully:
```
mcp__atlassian__getJiraIssue(issueIdOrKey: "<RFE-KEY>", fields: ["summary", "description", "status", "issuetype", "issuelinks", "parent"], responseContentFormat: "markdown")
```

Save the RFE key for breadcrumb (Step 1d) and Outcome discovery (Step 1e).

**If ALL strategies fail (no RFE found):**

Do NOT silently proceed. This is unexpected — every STRAT should link to an RFE.

1. Print a warning: `WARNING: Could not resolve linked RFE for <STRAT-KEY>. All STRAT tickets should have a clones link to an RHAIRFE ticket. Check the Jira ticket's 'Linked work items' section.`
2. Ask the user: "The linked RFE could not be found via issuelinks, JQL, or description scan. Would you like to provide the RFE key manually, or proceed without it?"
3. If proceeding without: set `rfe_key: null` in `extract-state.json` AND add a note in the report breadcrumb: "RFE: not found (check Jira links)". Journey/persona extraction will be limited to the STRAT description only.

#### Extract Personas and Goals

Personas don't always come from user story format. Extract them from wherever the RFE names its target users:

**If the RFE has explicit user stories** ("As a [role], I want [goal]"):

- Each story maps directly to a persona + goal + journey.

**If the RFE has a structured format** (Problem Statement, Target Audience, Proposed Solution):

- **Persona** → extract from "Affected Customers" or "Target Audience" (e.g., "Data Science Platform Administrators and Lead Data Scientists who are not necessarily Kubernetes experts")
- **Goal** → derive from the Problem Statement + Proposed Solution (e.g., "create custom roles via a visual UI without writing YAML")
- **Journey** → derive from the Acceptance Criteria + Proposed Solution (each AC that describes a user action becomes a journey step)

**If the RFE is minimal** (just acceptance criteria, no structured sections):

- **Persona** → default to a generic "primary user" based on the feature domain
- **Goal** → infer from what the acceptance criteria collectively describe
- **Journey** → each AC that describes a user action becomes a journey step

#### Example: Structured RFE (no user stories)

Given an RFE with:

- Target Audience: "Data Science Platform Administrators who are not K8s experts"
- Problem Statement: "Creating custom roles requires manual YAML..."
- Proposed Solution: "Implement a Role Creation UI within the RHOAI dashboard"
- AC-1: "A form-based UI for defining custom roles"
- AC-2: "Ability to select API groups, resources, and verbs without manual typing"

Extract:

```
Persona: Data Science Platform Administrator (non-K8s expert)
Goal: Create a custom role with granular permissions using a visual UI
Journey: Navigate to role management → open role creator form → select resources/verbs → validate → save
```

The persona's expertise level matters — "non-K8s expert" means the journey should not require the user to understand Kubernetes concepts to navigate the UI.

#### Cross-Reference with Strategy Brief and Decision History (How It Was Designed)

If `.artifacts/<KEY>/decisions/strategy-brief.md` exists, read it. The strategy brief contains decisions about *how* to build the feature — flow, sequencing, and component choices made during prototype creation. It does NOT contain user stories (those come from the RFE). Use the strategy brief to inform the *expected UI path* for each journey:

- If Decision 3 chose "modal form" over "wizard" → expect a modal interaction, not multi-step pages
- If Decision 1 chose "tab-based layout" → expect tab clicks, not sidebar navigation to sub-pages
- If a decision was auto-resolved → the expected behavior follows the codebase's existing patterns

This comparison catches **decision drift** — where the prototype was built differently from what was decided.

#### Read decisions.json for Traceability

If `.artifacts/<KEY>/decisions/decisions.json` exists, read it. This file contains the machine-readable state of every design decision made during prototype creation — including which option was chosen, the reasoning, and whether it was human-picked or auto-resolved.

**Build a decision-to-criterion map.** For each AC, check whether a design decision is relevant:

```
AC-7: "Multi-provider routing with weights"
  → Decision 4: "Routing strategy" — chose "single provider" for low fidelity, explicitly de-scoped weights
  → Verdict context: FAIL is expected given the decision, not a bug

AC-1: "Form-based UI for registering providers"
  → Decision 3: "Creation flow" — chose "modal form"
  → Verdict context: PASS confirms the prototype matches the decision
```

**Use this map in three places:**

1. **In the AC verdict rationale** (Step 2): When a criterion fails because a decision explicitly de-scoped it, note this: "Decision 4 explicitly de-scoped this for low fidelity." This prevents false alarms — a deliberate de-scope is different from a missing feature.
2. **In the journey narration** (Step 4 report): Under each journey step, reference the decision that informed the expected UI path (e.g., "This modal form was chosen in Decision 3 over a wizard pattern").
3. **In the refinement suggestions** (Step 7, if `--feed-to-refine`): Include the decision context so `prototype-refine` knows whether a failure is something to fix or something that was deliberately excluded.

If `decisions.json` does not exist, proceed without it — the eval works fine without decision context, it just can't distinguish deliberate de-scopes from bugs.

**In summary:**

- **RFE** (via `rfe-snapshot.md` or linked Jira ticket) → tells you *what* the user wants to do, *who* they are, and *why* (personas + goals + problem context)
- **Strategy brief** (`.artifacts/<KEY>/decisions/strategy-brief.md`) → tells you *how* it should be built (expected UI patterns, component choices, flow decisions)
- **decisions.json** (`.artifacts/<KEY>/decisions/decisions.json`) → tells you *why* specific choices were made and whether failures are deliberate de-scopes
- **Proposed Solution/Rationale** (from the RFE) → bridges the two: describes the approach at a high level before decisions were made
- Together they define the expected journey paths. The RFE provides the "what and who," the strategy brief and decisions provide the "how and why."

#### Build the Journey Definitions

For each user story, produce a journey definition:

```
Journey 1: "Register an External Provider"
  Persona: Model Deployer
  Source: Story 1 + Decision 3 (Creation Flow: modal form)
  Depth: quick | thorough
  Expected path:
    1. Navigate to AI Hub > Models
    2. Click "External providers" tab
    3. Click "Register provider" button
    4. [thorough only] Fill form (name, endpoint, auth, secret)
    5. [thorough only] Click "Register"
    6. [thorough only] Verify: new provider appears in table

Journey 2: "Register an External Model"
  Persona: Model Deployer
  Source: Story 2 + Decision 4
  Expected path:
    1. Navigate to AI Hub > Models
    2. Click "Deployments" tab
    3. Click "Register external model" button
    4. [thorough only] Fill form (name, provider, API format)
    5. [thorough only] Click "Register"
    6. [thorough only] Verify: new model appears in list
```

In `--depth=quick` mode, journeys stop after verifying the flow *exists* and is navigable (steps 1-3 above). In `--depth=thorough` mode, journeys complete the full interaction including data entry, submission, and result verification.

If no strategy brief exists, derive expected paths from the user stories alone using reasonable UI patterns (forms for creation, tables for listing, detail views for inspection).

#### AC Traceability

Every journey MUST include an `ac_ids` array listing the acceptance criteria it tests. This enables the report to show "Testing AC-6" prominently in the journey header, making it immediately clear what the journey validates.

```
Journey 1: "Register an External Provider"
  ac_ids: ["AC-1", "AC-2"]
  ...
```

#### Source Labeling Rules

The `source` field on each journey MUST clearly indicate where the journey came from:

- **From an explicit user story in the RFE:** `"source": "Story 1 + Decision 3 (Creation Flow: modal form)"`
- **Inferred from acceptance criteria (no explicit user story):** `"source": "Inferred from AC-6: <verbatim AC text truncated to ~80 chars>"`
- **From High Level Requirements:** `"source": "HLR-2: As a platform operator, I want to..."`

**NEVER synthesize a fake user story string.** If there is no explicit "As a [role], I want [goal]" statement in the ticket, do NOT generate one like "User Story: Platform Operator wants to see GPU queue utilization." Instead, reference the AC directly: `"Inferred from AC-6: tooltip displays the requested and admitted CPU, memory, and GPU resources"`. This makes it immediately clear to reviewers whether the journey traces to a real user story or was derived by the evaluator.

Store the journey definitions internally — they are used in Step 3 (Playwright) and in the report's path comparison section.

### 1d: Discover Linked MR and Build Breadcrumb

Build the SDLC breadcrumb for the report header. The breadcrumb traces the full pipeline path:

**Outcome → RFE → STRAT → Prototype (branch or MR) → Eval Report**

#### Extract links from Jira

From the data already gathered:

- **Source RFE**: Use the RFE key discovered in Step 1c (multi-strategy approach). If Step 1c did not find an RFE, omit it from the breadcrumb. Do NOT use the STRAT key as the RFE — they are different tickets even if they share text.
- **Outcome**: Discovered in Step 1e (runs after this step). The breadcrumb is assembled after all discovery steps complete.
- **STRAT**: The ticket being evaluated. URL: `https://issues.redhat.com/browse/<KEY>`

#### Discover the prototype MR

The prototype may have been submitted as a GitLab merge request. Search for it in this order:

1. **Jira remote links**: Check `getJiraIssueRemoteIssueLinks` for GitLab MR URLs.
2. **Workspace git remote**: If the eval is running against a `--workspace`, read the git remote URL and branch:
  ```bash
   cd <workspace-path> && git remote get-url origin
   cd <workspace-path> && git branch --show-current
  ```
   Construct the prototype repo URL from the remote (e.g., `https://gitlab.cee.redhat.com/uxd/prototypes/rhoai/-/tree/<branch>`).
3. **GitLab MR search**: If a workspace remote was found, check for open MRs matching the branch or STRAT key. The MR list URL follows the pattern:
  ```
   https://<gitlab-host>/<group>/<repo>/-/merge_requests?search=<KEY>
  ```
   For the RHOAI prototype repo specifically:
   If the eval has shell access and `git` auth to the GitLab host, it can query the API:
   If an MR is found, use its URL in the breadcrumb. If not, link to the branch directly.

#### Build the breadcrumb data

Store internally for use in the report header. Assemble AFTER Step 1e completes (Outcome discovery).

**URL validation rules:**

1. The RFE key must have been confirmed via API in Step 1c. If no RFE was found, omit it from the breadcrumb (do NOT guess or fabricate an RFE key).
2. The Outcome key must have been confirmed via API in Step 1e. If no Outcome was found, omit it from the breadcrumb.
3. Use the correct Jira instance URL based on the project key prefix:
   - `RHAIRFE-*` and `RHAISTRAT-*` → `https://issues.redhat.com/browse/<KEY>`
   - `RHOAIUX-*` → `https://redhat.atlassian.net/browse/<KEY>`
4. Include a `"validated": true/false` field for each breadcrumb entry. Set `validated: true` only if the key was confirmed via Jira API response. Set `validated: false` if the key was inferred from text matching (e.g., found in markdown but not confirmed via API). The render script uses this to show unvalidated links as plain text with a tooltip.

```json
{
  "outcome": { "key": "RHAISTRAT-919", "url": "https://issues.redhat.com/browse/RHAISTRAT-919", "validated": true },
  "rfe": { "key": "RHAIRFE-913", "url": "https://issues.redhat.com/browse/RHAIRFE-913", "validated": true },
  "strat": { "key": "RHAISTRAT-1536", "url": "https://issues.redhat.com/browse/RHAISTRAT-1536", "validated": true },
  "prototype": { "label": "rhoai/3.5", "url": "https://gitlab.cee.redhat.com/uxd/prototypes/rhoai/-/tree/3.5", "type": "branch" },
  "mr": null
}
```

If an MR is found, set `"mr": { "id": "!42", "url": "https://gitlab.cee.redhat.com/.../merge_requests/42" }` and use the MR URL for the prototype breadcrumb step instead of the branch URL.

The breadcrumb degrades gracefully — missing segments are simply omitted. At minimum it shows `STRAT → Eval Report`. The full chain when available: `Outcome → RFE → STRAT → Prototype/MR → Eval Report`.

### 1e: Fetch Parent Outcome (if available)

After building the MR/prototype breadcrumb entries, find the parent Outcome. Outcomes provide the most reliable grounding for user journeys and success criteria — they describe the intended end-state for a feature area.

**Outcomes can be in ANY project** — they are identified by issue type, not project key. Common project keys include `RHAISTRAT-*` and `RHOAIUX-*`, but do NOT filter by project key alone.

#### How to Find the Outcome (multi-strategy)

Try each strategy in order until one succeeds:

**Strategy 1 — Check the RFE's `parent` field (Jira breadcrumb):**

If an RFE was found in Step 1c, its `parent` field (returned because we included `"parent"` in the fields array) holds the Jira hierarchy parent — this is often the Outcome. Example: RHAIRFE-913's parent is RHAISTRAT-919 (an Outcome).

```
# The RFE response from Step 1c should already contain parent data.
# If parent.key exists, fetch it and check issuetype:
mcp__atlassian__getJiraIssue(issueIdOrKey: "<parent-key>", fields: ["summary", "description", "status", "issuetype", "issuelinks"], responseContentFormat: "markdown")
```

If `issuetype.name` is "Outcome" (or similar: "Initiative", "Epic" that serves as an outcome), use this ticket.

**Strategy 2 — Check the STRAT's `parent` field:**

The STRAT ticket itself may have a parent Outcome (skipping the RFE hop). Check the `parent` field from the Step 1 response.

**Strategy 3 — Parse `issuelinks` on the RFE:**

Look for relationships like `"is child of"`, `"is cloned by"`, `"belongs to"`, or `"is caused by"` pointing to a ticket with issue type "Outcome."

**Strategy 4 — JQL search from the RFE:**
```
mcp__atlassian__searchJiraIssuesUsingJql(
  cloudId: "<same-cloud-id>",
  jql: "issue in linkedIssues(\"<RFE-KEY>\") AND issuetype = Outcome",
  fields: ["summary", "description", "status", "issuetype"]
)
```

**Strategy 5 — JQL search from the STRAT directly:**
```
mcp__atlassian__searchJiraIssuesUsingJql(
  cloudId: "<same-cloud-id>",
  jql: "issue in linkedIssues(\"<STRAT-KEY>\") AND issuetype = Outcome",
  fields: ["summary", "description", "status", "issuetype"]
)
```

#### What to extract

From the Outcome ticket, extract:
- **Key** — the Jira key (e.g., `RHAISTRAT-919` or `RHOAIUX-2375`)
- **Problem statement** — what user pain exists today
- **User journey outline** — if present, the expected end-to-end flow
- **Acceptance criteria** — broader success criteria that the STRAT contributes to
- **Connected RFEs** — list of RFE keys linked to this Outcome

#### Store as `outcome-context.json`

Write to `.artifacts/<KEY>/outcome-context.json`:

```json
{
  "key": "RHAISTRAT-919",
  "title": "Bring Your Own Agent Support",
  "problem_statement": "Users cannot deploy custom agent images...",
  "user_journey": "Navigate to AI Hub > Agents > Deploy > Select image > Configure > Monitor",
  "acceptance_criteria": [
    "Users can deploy agent container images from the AI Hub",
    "Agent deployments are visible alongside model deployments",
    "Status monitoring available for running agents"
  ],
  "connected_rfes": ["RHAIRFE-294", "RHAIRFE-310"]
}
```

#### How this is used

- **Breadcrumb (Step 1d):** The Outcome key is added as the first entry in the breadcrumb chain: `Outcome → RFE → STRAT → Prototype → Eval`
- **Step 2 (AC evaluation):** If a STRAT AC is ambiguous, the Outcome provides clarification about the broader intent. Do NOT add Outcome ACs as hard pass/fail criteria — they inform interpretation only.
- **Modal view (report):** The Outcome context appears in the screenshot modal's context pane so reviewers can see alignment at a glance.
- **Journey validation:** If the Outcome describes a user journey, compare it against the journeys defined in Step 1c to catch any major gaps.

If no Outcome is found after all strategies, proceed without it. The eval works fine without Outcome context — it just can't provide the broader feature-area grounding.

---

## Phase 1 Complete — Continue Pipeline

Phase 1 is done. Now execute the remaining phases in order:

### Phase 2: Journey Walkthroughs

Read `.claude/skills/evaluate-journey/SKILL.md` and execute it. It reads `extract-state.json` and the prototype URL to:
- Classify each AC into evaluation tiers
- Generate and run Playwright persona journey walkthroughs
- Check design consistency against PatternFly guidelines
- Write journey-log.json, evaluation-report.csv (AC section), screenshots, consistency-report.json

### Phase 3: Usability Scoring

Read `.claude/skills/evaluate-usability/SKILL.md` and execute it. It reads journey-log.json and screenshots to:
- Score 7 usability dimensions per persona
- Populate persona_overlays with patience tracking
- Optionally run think-aloud narration (if `--usability=deep|thorough`)

**Skip Phase 3** only if `.context/usability-testing/` does not exist. Add a note: "Usability scoring skipped. Run `make context` to bootstrap."

### Phase 4: Report Generation

Run these scripts (no LLM judgment needed):

```bash
node scripts/render-report.js .artifacts/<KEY>/
node scripts/log-run.js .artifacts/<KEY>/ --note="<description>"
```

### Print Summary

After all phases, print:

```
────────────────────────────────────────
Prototype Evaluation: <KEY>
────────────────────────────────────────
Story:     <title>
URL:       <url>
Depth:     <quick|thorough>
Criteria:  <N> total

  PASS:    <n>
  FAIL:    <n>
  FLAGGED: <n> (needs human review)

Journeys:  <n>/<total> completed
Usability: <X>/21 (personas: <list>)
────────────────────────────────────────
```

$ARGUMENTS
