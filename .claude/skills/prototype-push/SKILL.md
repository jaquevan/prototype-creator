---
name: prototype-push
description: Resubmit a locally refined prototype back to the CI pipeline after human review.
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
---

# prototype-push

Push a locally refined prototype back to the CI pipeline for re-review.

## Usage

```
/prototype.push <RFE-ID>
```

Example: `/prototype.push PROJ-298`

## What This Does

1. Copies the prototype and all related artifacts from `local/` back to `artifacts/`
2. Resets pipeline status in frontmatter to trigger a fresh review cycle
3. Tells the user how to kick off the next CI run

## Procedure

### Step 1: Parse the argument

Extract the RFE ID from the user's input. Accept formats like `PROJ-298`, `proj-298`, or just `298` (assume the default project key from `config/pipeline-settings.yaml`).

### Step 2: Verify local prototype exists

Check that `local/prototypes/{ID}/` exists. If not, tell the user:

```
No local prototype found for {ID}.

Run /prototype.pull {ID} first to pull a prototype into the local workspace.
```

### Step 3: Validate the prototype

Before pushing, do a quick sanity check:

- Read the prototype metadata file (`local/prototypes/{ID}/prototype.md` or similar)
- Confirm it has a valid frontmatter block with `id`, `title`, `fidelity`, and `status`
- Warn (but don't block) if `status` is still `stub` — the user may be pushing a stub intentionally

### Step 4: Reset pipeline status

Update the prototype's frontmatter to trigger re-review:

- Set `status: pending-review` (replaces whatever the local status was)
- Set `pushed_at: {ISO timestamp}`
- Set `pushed_from: local`
- Remove any `rubric_pass` or `needs_attention` flags if present

Use the Edit tool to update the YAML frontmatter in the prototype metadata file.

### Step 5: Copy to artifacts

```bash
# Copy the prototype (overwrite existing)
cp -r local/prototypes/{ID}/ artifacts/prototypes/{ID}/

# Copy updated review files
cp local/prototype-reviews/{ID}* artifacts/prototype-reviews/ 2>/dev/null || true

# Copy updated decision artifacts
cp local/decisions/{ID}* artifacts/decisions/ 2>/dev/null || true
```

### Step 6: Generate a diff summary

Compare the pushed prototype against the original snapshot:

```bash
diff -rq local/prototype-originals/{ID}/ artifacts/prototypes/{ID}/ 2>/dev/null || true
```

If the original snapshot exists in `local/prototype-originals/{ID}/`, summarize what changed:
- New files added
- Files modified
- Files removed

If no original snapshot exists, skip the diff and note that no baseline was available.

### Step 7: Confirm to user

Print a summary:

```
Pushed {ID} back to artifacts/.

  Prototype:  artifacts/prototypes/{ID}/
  Reviews:    artifacts/prototype-reviews/
  Decisions:  artifacts/decisions/
  Status:     pending-review (reset for re-scoring)

Changes from original:
  Modified:   prototype.html, styles.css
  Added:      decision-layout.md
  Removed:    (none)

Next steps:
  • Re-run CI to trigger the review pipeline
  • Or run /prototype.review manually to re-score now
  • The prototype will be re-evaluated against the UX rubric
```

## What Gets Copied

| Source (local/) | Destination (artifacts/) | Notes |
|---|---|---|
| `local/prototypes/{ID}/` | `artifacts/prototypes/{ID}/` | Full prototype directory |
| `local/prototype-reviews/{ID}*` | `artifacts/prototype-reviews/` | Review score files |
| `local/decisions/{ID}*` | `artifacts/decisions/` | Decision artifacts |

Files in `local/prototype-originals/` are **never** pushed back — they're the baseline snapshot for diffing.

## Error Handling

- If `local/prototypes/{ID}/` doesn't exist, stop and tell the user to run `/prototype.pull` first
- If `artifacts/prototypes/{ID}/` already exists, overwrite it (the user is intentionally replacing the CI version)
- If the frontmatter is missing or malformed, warn the user but still attempt the copy
- If the copy fails for any reason, report the error and do not mark the push as complete

## Safety

- This skill does **not** write to Jira — it only moves files between `local/` and `artifacts/`
- Pipeline labels are applied by the CI pipeline, not by this skill
- The user must manually trigger CI or run `/prototype.review` to kick off re-scoring
