---
name: prototype-pull
description: Pull a prototype into local mode for personal review and iteration. Jira updates are paused until you push it back.
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, mcp__atlassian__getJiraIssue
---

# prototype-pull

Switch a prototype to local mode for human review. In local mode, skills skip Jira writes and pipeline label gates.

## What This Does (Plain Language)

If a prototype was created by the automated CI pipeline, this skill "pulls" it into your local workspace so you can review and iterate on it without affecting Jira labels or CI status. Think of it as checking out a prototype for personal review.

Once in local mode:
- Reviewing and refining won't update Jira
- You can iterate freely without triggering CI pipelines
- When you're done, use `prototype.push` to send it back for formal re-review

**You can also use this to start from a Jira ticket.** If no prototype exists yet for a ticket, this skill will fetch the ticket details and set up the folder structure so you're ready to start building.

## Conversational Guidance

If the user wants to work on an existing prototype locally (e.g., "let me look at what the pipeline built" or "I want to tweak the prototype for PROJ-298"), offer:

> I'll pull that prototype into local mode so you can review and iterate on it freely. Changes won't affect Jira or CI until you're ready to push it back.

If the user mentions a Jira ticket that doesn't have a prototype yet:

> There's no prototype for that ticket yet, but I can set things up by pulling the ticket details. Then you can run `prototype.create` to build one from scratch.

## Usage

```
/prototype.pull <RFE-ID>
```

Example: `/prototype.pull PROJ-298`

## What This Does

1. Locates the prototype in `.artifacts/{ID}/`
2. If the prototype doesn't exist, fetches the RFE from Jira and creates a stub
3. Sets `"mode": "local"` in `.artifacts/{ID}/metadata.json`
4. Once in local mode, all skills auto-detect it — they skip Jira writes and pipeline label gates

## Procedure

### Step 1: Parse the argument

Extract the RFE ID from the user's input. Accept formats like `PROJ-298`, `proj-298`, or just `298` (assume the default project key from `config/pipeline-settings.yaml`).

### Step 2: Check for existing prototype

Look for the prototype at `.artifacts/{ID}/`:

```
.artifacts/{ID}/metadata.json
.artifacts/{ID}/prototype/
.artifacts/{ID}/decisions/
.artifacts/{ID}/reviews/
.artifacts/{ID}/rfe-snapshot.md
```

### Step 3a: If prototype exists — switch to local mode

Read `.artifacts/{ID}/metadata.json` and set `"mode": "local"`:

```json
{
  "mode": "local",
  "pulled_at": "2026-04-30T12:00:00Z"
}
```

Preserve all existing fields in metadata.json — only update `mode` and add `pulled_at`.

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

Create the artifact directory and stub files:

```bash
mkdir -p .artifacts/{ID}/prototype
mkdir -p .artifacts/{ID}/decisions
mkdir -p .artifacts/{ID}/reviews
```

Write `.artifacts/{ID}/metadata.json`:

```json
{
  "rfe_key": "{ID}",
  "title": "{summary from Jira}",
  "status": "stub",
  "mode": "local",
  "fidelity": "medium",
  "created": "{ISO timestamp}",
  "pulled_from": "jira"
}
```

Write `.artifacts/{ID}/rfe-snapshot.md` with the raw RFE data as a frozen snapshot.

### Step 4: Confirm to user

Print a summary:

```
Pulled {ID} into local mode.

  Artifacts:  .artifacts/{ID}/
  Prototype:  .artifacts/{ID}/prototype/
  Decisions:  .artifacts/{ID}/decisions/
  Reviews:    .artifacts/{ID}/reviews/
  Snapshot:   .artifacts/{ID}/rfe-snapshot.md

Local mode is active — skills will skip Jira writes and pipeline label gates.

Next steps:
  /prototype.review     — Re-score the prototype
  /prototype.refine     — Iterate on the prototype
  /prototype.push {ID}  — Reset to CI mode when ready
```

If this was a Jira stub (no CI prototype existed):

```
No CI prototype found for {ID}. Created a stub from Jira.

  Stub:       .artifacts/{ID}/metadata.json
  RFE data:   .artifacts/{ID}/rfe-snapshot.md

Next steps:
  /prototype.create     — Generate a prototype from this RFE
```

## Local Mode Detection

Skills detect local mode by reading `.artifacts/{ID}/metadata.json` and checking the `mode` field. When `"mode": "local"`:

- **Skip Jira label updates** — don't apply or remove pipeline labels
- **Skip pipeline status checks** — don't gate on `prototype-creator-candidate` or similar
- **Allow interactive iteration** — the user can run review/refine cycles without CI overhead

## Error Handling

- If the RFE ID is invalid or the Jira fetch fails, tell the user and suggest checking the ID
- If `.artifacts/{ID}/` has partial data (prototype but no reviews), proceed and note the gaps
- If `.artifacts/{ID}/metadata.json` already has `"mode": "local"`, print `[ALREADY LOCAL] {ID} is already in local mode` and skip
