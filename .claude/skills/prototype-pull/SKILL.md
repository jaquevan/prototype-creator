---
name: prototype-pull
description: Pull a post-CI prototype from artifacts/ into local/ for human review and iteration.
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, mcp__atlassian__getJiraIssue
---

# prototype-pull

Pull a post-CI prototype into the `local/` workspace for human review.

## Usage

```
/prototype.pull <RFE-ID>
```

Example: `/prototype.pull PROJ-298`

## What This Does

1. Copies the prototype and all related artifacts from `artifacts/` to `local/`
2. If the prototype doesn't exist locally or in artifacts, fetches the RFE from Jira and creates a fresh stub
3. Once files are in `local/`, all skills auto-detect local mode — they skip Jira writes and pipeline label gates

## Procedure

### Step 1: Parse the argument

Extract the RFE ID from the user's input. Accept formats like `PROJ-298`, `proj-298`, or just `298` (assume the default project key from `config/pipeline-settings.yaml`).

### Step 2: Check artifacts/ for existing prototype

Look for the prototype in these locations:

```
artifacts/prototypes/{ID}/
artifacts/prototype-reviews/{ID}*
artifacts/changesets/{ID}*
.decisions/
```

Use Glob to find matching files:

```
artifacts/prototypes/{ID}/**
artifacts/prototype-reviews/{ID}*
artifacts/changesets/{ID}*
.decisions/**
```

### Step 3a: If prototype exists in artifacts — copy to local

Create the local workspace structure:

```bash
mkdir -p local/prototypes/{ID}
mkdir -p local/prototype-reviews
mkdir -p local/decisions
mkdir -p local/prototype-originals
```

Copy files:

```bash
# Copy the prototype
cp -r artifacts/prototypes/{ID}/ local/prototypes/{ID}/

# Copy review files
cp artifacts/prototype-reviews/{ID}* local/prototype-reviews/ 2>/dev/null || true

# Copy decision artifacts (new .decisions/ format)
cp -r .decisions/ local/decisions/ 2>/dev/null || true

# Copy changeset manifest (workspace mode)
cp artifacts/changesets/{ID}* local/ 2>/dev/null || true
```

Snapshot the original (pre-review) state so the user can diff later:

```bash
cp -r local/prototypes/{ID}/ local/prototype-originals/{ID}/
```

### Step 3b: If prototype does NOT exist — fetch from Jira and create stub

Use the Jira MCP tool to fetch the RFE:

```
mcp__atlassian__getJiraIssue(issueIdOrKey: "{ID}")
```

From the Jira response, extract:
- `summary` → prototype title
- `description` → user stories, acceptance criteria
- `labels` → any pipeline labels
- `status` → current status
- `priority` → priority level

Create the local stub structure:

```bash
mkdir -p local/prototypes/{ID}
mkdir -p local/prototype-reviews
mkdir -p local/decisions
mkdir -p local/prototype-originals
```

Write a stub prototype metadata file at `local/prototypes/{ID}/prototype.md`:

```markdown
---
id: {ID}
title: "{summary from Jira}"
source: jira
status: stub
fidelity: medium
mode: decide
created: {ISO timestamp}
pulled_from: jira
---

# {summary}

## Source RFE

**ID**: {ID}
**Status**: {jira status}
**Priority**: {jira priority}

## User Stories

{description from Jira, cleaned up}

## Acceptance Criteria

{extracted from description, or empty checklist}

## Notes

This is a stub pulled directly from Jira. No CI prototype exists yet.
Run `/prototype.create` to generate a prototype from this RFE.
```

Also save the raw RFE data to `local/prototype-originals/{ID}/rfe-snapshot.md` so the user has the original context.

### Step 4: Confirm to user

Print a summary:

```
Pulled {ID} into local workspace.

  Prototype:  local/prototypes/{ID}/
  Reviews:    local/prototype-reviews/
  Decisions:  local/decisions/
  Original:   local/prototype-originals/{ID}/

Local mode is active — skills will skip Jira writes and pipeline label gates.

Next steps:
  /prototype.review     — Re-score the prototype
  /prototype.refine     — Iterate on the prototype
  /prototype.push {ID}  — Push back to CI when ready
```

If this was a Jira stub (no CI prototype existed):

```
No CI prototype found for {ID}. Created a stub from Jira.

  Stub:       local/prototypes/{ID}/prototype.md
  RFE data:   local/prototype-originals/{ID}/rfe-snapshot.md

Next steps:
  /prototype.create     — Generate a prototype from this RFE
```

## Local Mode Detection

Skills auto-detect local mode by checking whether the prototype path starts with `local/`. When in local mode:

- **Skip Jira label updates** — don't apply or remove pipeline labels
- **Skip pipeline status checks** — don't gate on `prototype-creator-candidate` or similar
- **Write outputs to local/** — reviews, decisions, and refined prototypes stay in the local workspace
- **Allow interactive iteration** — the user can run review/refine cycles without CI overhead

## Error Handling

- If the RFE ID is invalid or the Jira fetch fails, tell the user and suggest checking the ID
- If `artifacts/` has partial data (prototype but no reviews), copy what exists and note the gaps
- If `local/prototypes/{ID}/` already exists, ask the user whether to overwrite or skip
