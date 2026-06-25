---
name: eval-extract
description: Extract Jira context, acceptance criteria, personas, journeys, MR deltas, and breadcrumb for the eval pipeline. Entry point that produces all upstream artifacts.
user-invocable: false
allowed-tools: Read, Write, Bash, Glob, Grep, mcp__atlassian__getJiraIssue, mcp__atlassian__searchJiraIssuesUsingJql
---

# eval-extract

Phase 1 of the eval pipeline. Gathers all context needed for evaluation from Jira, the RFE, the workspace, and decision history. Writes structured JSON artifacts that downstream skills read.

## Inputs

| Input | Description | Required |
|-------|-------------|----------|
| Jira story key | e.g., `RHAISTRAT-1536` | Yes |
| `--workspace` | Path to prototype repo (for MR delta extraction) | No |
| `.artifacts/<KEY>/rfe-snapshot.md` | Frozen RFE content from prototype creation | No |
| `.artifacts/<KEY>/decisions/decisions.json` | Design decisions from prototype creation | No |
| `.artifacts/<KEY>/decisions/strategy-brief.md` | Strategy brief from creation | No |
| `config/product-overlay.yaml` | Product-specific config (Jira URLs, git conventions) | Yes |

## Outputs

| File | Description |
|------|-------------|
| `.artifacts/<KEY>/extract-state.json` | `{ ac_list, journey_definitions, breadcrumb, persona_selection }` |
| `.artifacts/<KEY>/mr-delta.json` | Git diff analysis (when `--workspace` provided) |
| `.artifacts/<KEY>/outcome-context.json` | Parent Outcome ticket context (if discoverable) |

## Procedure

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

### Step 2: Extract Acceptance Criteria

Extract ACs verbatim from the ticket description. Look under "Acceptance Criteria", Given/When/Then blocks, or checkbox lists.

**Rules:**
- Copy each criterion verbatim. Do NOT paraphrase.
- Each Given/When/Then block = ONE criterion.
- Each bullet/number = ONE criterion.
- Number them AC-1, AC-2, etc. in order of appearance.
- Do NOT split or merge criteria.
- Do NOT generate criteria from source code or personas.

**ID and source rules:**
- Jira-sourced: `criterion_id` = `AC-1`, `source` = `jira`
- Evaluator-inferred (nav reachability, flag checks): `NAV-1`, `FLAG-1`, `EVAL-1`, `source` = `inferred`

If no ACs found, stop and ask the user for the ticket key.

### Step 3: Extract Supporting Documentation

Look for "Supporting Documentation" section. Extract references and map each to the AC it serves:
- Source RFE links, UX Research links, Architecture docs
- Reference UI URLs, Design docs, ADRs

Build a criterion-to-reference map for tier classification (used by eval-classify).

### Step 4: Discover Linked RFE (multi-strategy)

Every STRAT ticket should have a "clones" link to its RHAIRFE ticket.

**Strategy 1:** Parse `issuelinks` from Step 1 — check both `inwardIssue` and `outwardIssue` for Cloners relationship.

**Strategy 2:** JQL search:
```
issue in linkedIssues("<STRAT-KEY>") AND project = RHAIRFE
```

**Strategy 3:** Text scan the description for `RHAIRFE-\d+` patterns.

Once found, fetch the RFE fully. If ALL strategies fail, warn the user and proceed with `rfe_key: null`.

### Step 5: Extract Personas and Define Journeys

Sources (priority order):
1. `.artifacts/<KEY>/rfe-snapshot.md` — most reliable
2. Jira ticket from Step 1
3. Linked RFE from Step 4

Extract personas from Target Audience / Affected Customers. Derive goals from Problem Statement + Proposed Solution. Build journey definitions from ACs that describe user actions.

Cross-reference with strategy brief and decisions.json if available.

Each journey includes: `id`, `title`, `persona`, `source`, `ac_ids`, `expected_path` (steps).

**Source labeling:** Use explicit user story text if available. Otherwise: `"Inferred from AC-6: <verbatim text>"`. Never synthesize fake user stories.

### Step 6: Build Breadcrumb

Trace: Outcome → RFE → STRAT → Prototype (branch/MR) → Eval Report.

- **STRAT**: The ticket being evaluated
- **RFE**: From Step 4
- **Prototype/MR**: From workspace git remote or Jira remote links
- **Outcome**: From Step 7

Each entry has `key`, `url`, `validated` (true if confirmed via API).

### Step 7: Fetch Parent Outcome

Multi-strategy search (try in order):
1. RFE's `parent` field
2. STRAT's `parent` field
3. RFE's `issuelinks` for "is child of" relationships
4. JQL: `issue in linkedIssues("<RFE-KEY>") AND issuetype = Outcome`
5. JQL: `issue in linkedIssues("<STRAT-KEY>") AND issuetype = Outcome`

Extract: key, title, problem_statement, user_journey, acceptance_criteria, connected_rfes.

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

Assemble all extracted data into the handoff artifact:

```json
{
  "key": "<KEY>",
  "title": "<story title>",
  "extracted_at": "<ISO timestamp>",
  "ac_list": [
    { "criterion_id": "AC-1", "source": "jira", "text": "<verbatim>", "references": [] }
  ],
  "journey_definitions": [
    { "id": "journey-1", "title": "...", "persona": "...", "source": "...", "ac_ids": ["AC-1"], "expected_path": [] }
  ],
  "breadcrumb": { "outcome": null, "rfe": null, "strat": {}, "prototype": null, "mr": null },
  "persona_selection": { "selected": [], "target_audience_text": "", "reasoning": "" },
  "rfe_key": "<key or null>",
  "decision_context": { "has_decisions": false, "deliberate_descopes": [] }
}
```

This file is the single handoff artifact. All downstream eval skills read it. It is produced once on iteration 1 and cached for subsequent iterations.
