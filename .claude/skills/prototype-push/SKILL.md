---
name: prototype-push
description: Done editing locally? Push the prototype back to the pipeline for a fresh quality review.
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
---

# prototype-push

Reset a locally refined prototype back to CI mode for re-review.

## What This Does (Plain Language)

When you're done reviewing and refining a prototype locally (after using `prototype.pull`), this skill sends it back into the formal pipeline. It resets the review status so the prototype gets a fresh quality score.

Think of it as saying "I'm done with my local edits — please re-evaluate this."

**This doesn't push code to a remote repo.** It only resets the prototype's internal status from "local" to "CI." To actually publish or create a merge request, use `prototype.submit` after pushing.

## Conversational Guidance

If the user says something like "I'm done editing" or "send this back for review," offer:

> Ready to push this back to the pipeline? I'll reset the review status so it gets re-scored with your changes. After that, you can run a new review or submit it.

## Usage

```
/prototype.push <RFE-ID>
```

Example: `/prototype.push PROJ-298`

## What This Does

1. Verifies the prototype exists in `.artifacts/{ID}/` and is in local mode
2. Resets pipeline status to trigger a fresh review cycle
3. Sets `"mode": "ci"` in metadata.json
4. Tells the user how to kick off the next CI run

## Procedure

### Step 1: Parse the argument

Extract the RFE ID from the user's input. Accept formats like `PROJ-298`, `proj-298`, or just `298` (assume the default project key from `config/pipeline-settings.yaml`).

### Step 2: Verify prototype exists and is in local mode

Check that `.artifacts/{ID}/metadata.json` exists and has `"mode": "local"`. If not:

```
No local prototype found for {ID}.

Run /prototype.pull {ID} first to switch it to local mode.
```

If `"mode"` is already `"ci"`, print:

```
Prototype {ID} is already in CI mode. No action needed.

Run /prototype.review to re-score, or /prototype.submit to publish.
```

### Step 3: Validate the prototype

Before pushing, do a quick sanity check:

- Read `.artifacts/{ID}/metadata.json`
- Confirm it has required fields: `rfe_key`, `title`, `fidelity`
- Warn (but don't block) if `status` is still `stub` — the user may be pushing a stub intentionally

### Step 4: Reset pipeline status

Update `.artifacts/{ID}/metadata.json`:

- Set `"mode": "ci"` (replaces `"local"`)
- Set `"status": "pending-review"` (replaces whatever the local status was)
- Set `"pushed_at": "{ISO timestamp}"`
- Remove any `rubric_pass` or `needs_attention` flags if present

### Step 5: Confirm to user

Print a summary:

```
Pushed {ID} back to CI mode.

  Artifacts:  .artifacts/{ID}/
  Status:     pending-review (reset for re-scoring)

Next steps:
  • Re-run CI to trigger the review pipeline
  • Or run /prototype.review manually to re-score now
  • The prototype will be re-evaluated against the UX rubric
```

## Error Handling

- If `.artifacts/{ID}/` doesn't exist, stop and tell the user to run `/prototype.pull` first
- If the metadata is missing or malformed, warn the user but still attempt the mode reset
- If the update fails for any reason, report the error and do not mark the push as complete

## Safety

- This skill does **not** write to Jira — it only updates metadata in `.artifacts/{ID}/`
- Pipeline labels are applied by the CI pipeline, not by this skill
- The user must manually trigger CI or run `/prototype.review` to kick off re-scoring
