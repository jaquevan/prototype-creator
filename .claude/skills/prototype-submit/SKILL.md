---
name: prototype-submit
description: Share or publish a finished prototype — create a merge request, upload to Apollo, or keep it local. Updates the Jira ticket automatically.
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
---

# prototype-submit

Publishes a completed prototype to a target system (Apollo, a git repo, or local-only) and links it back to the source RFE in Jira. Tracks all submissions in a central manifest.

## What This Does (Plain Language)

Once you're happy with your prototype, this skill publishes it so others can see it. You have a few options for where it goes:

- **Keep it local** — Just marks it as "done" on your machine. Good when you're still iterating or want to share files manually.
- **Create a merge request** — Pushes the prototype code to the source repo as a merge request (MR). Your team can review it, comment, and approve. The MR description is written for designers and reviewers, not developers — it explains the feature, the design decisions made, and how to preview it.
- **Publish to Apollo** — Uploads the prototype to the Apollo platform where it can be viewed in a browser.

This skill also updates the original Jira ticket with a comment linking to the prototype, the quality score, and what label was applied. So the ticket becomes a living record of the prototyping work.

## Conversational Guidance

If the user asks to share or publish without specifying a target (e.g., "share this with the team" or "I'm done, what's next?"), ask:

> Your prototype is ready to share. Where would you like it to go?
>
> - **Create a merge request** — I'll push it to the repo so your team can review and comment. Great for getting feedback from other designers or engineers.
> - **Just keep it local** — I'll mark it as complete. You can share the files manually or come back later to publish.
>
> Either way, I'll update the Jira ticket with a link and the quality score.

## Invocation

```
/prototype.submit [ID] [--target=apollo|repo|local] [--dry-run]
```

**Examples:**

```bash
# Publish prototype to Apollo's REST API
/prototype.submit RFE-42 --target=apollo

# Initialize a git repo and push to a remote
/prototype.submit RFE-42 --target=repo --remote=git@gitlab.example.com:team/prototypes.git

# Mark as submitted locally without external publishing
/prototype.submit RFE-42 --target=local

# Validate everything without writing to external systems
/prototype.submit RFE-42 --target=apollo --dry-run
```

## Inputs

| Input | Location | Required |
|-------|----------|----------|
| Prototype files | Target workspace or `.artifacts/{ID}/prototype/` | Yes |
| Workspace analysis | `.artifacts/{ID}/workspace-analysis.json` | Yes (workspace mode) |
| Changeset manifest | `.artifacts/{ID}/changeset.md` | Yes (workspace mode) |
| Review scores | `.artifacts/{ID}/reviews/summary.md` | Recommended |
| Usability report | `.artifacts/{ID}/usability-report.md` | Optional |
| Desirability report | `.artifacts/{ID}/desirability-report.md` | Optional |
| Pipeline config | `.artifacts/{ID}/pipeline-config.yaml` | Optional |

## Step-by-Step Procedure

### Step 1: Locate and Validate the Prototype

Determine whether this prototype was created in workspace mode or standalone mode:

1. Check `.artifacts/{ID}/workspace-analysis.json` — if it exists, this is a workspace-mode prototype. Read the workspace path and changeset from `.artifacts/{ID}/changeset.md`.
2. Otherwise, find the prototype in `.artifacts/{ID}/prototype/`.

**Workspace mode validation:**
- Workspace path exists and is accessible
- Changeset manifest lists at least one file
- `.artifacts/{ID}/metadata.json` exists

**Standalone mode validation:**
- `index.html` exists (or at least one HTML file)
- `metadata.json` exists and has required fields (`rfe_key`, `title`, `description`)

If validation fails, stop:

> Prototype `{ID}` is incomplete. Missing: [list]. Fix these before submitting.

### Step 2: Read Review Scores

Read the review summary from `.artifacts/{ID}/reviews/summary.md`.

Extract the rubric scores:
- Per-dimension scores (completeness, usability, feasibility, fidelity)
- Total score
- Pass/fail determination (total ≥ 6 with no zeros = pass)

If no review exists:
- In `--dry-run` mode: warn but continue
- Otherwise: stop and recommend running `prototype.review` first

Determine the label to apply:
- **Scores pass** → `prototype-creator-rubric-pass`
- **Scores fail or no review** → `prototype-creator-needs-attention`

### Step 3: Prepare Submission Metadata

Build the submission record:

```yaml
submission:
  id: {ID}
  date: 2026-04-30T12:00:00Z
  target: apollo|repo|local
  rubric:
    total: 7
    pass: true
    label: prototype-creator-rubric-pass
  reports:
    review: .artifacts/{ID}/reviews/summary.md
    usability: .artifacts/{ID}/usability-report.md  # if exists
    desirability: .artifacts/{ID}/desirability-report.md  # if exists
  refinement-iterations: 2  # from metadata.json
  dry-run: false
```

### Step 4: Publish to Target

#### Target: `apollo`

Publish the prototype to Apollo's REST API.

1. Read the prototype's `metadata.json` and all HTML/CSS/JS files
2. Build the API payload:

```bash
curl -X POST http://localhost:1225/api/prototypes \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "RFE-42 Prototype",
    "description": "Configuration management interface",
    "embed": {
      "type": "iframe",
      "url": "/data/prototypes/{ID}/index.html"
    },
    "context": {
      "overview": { ... },
      "sources": { "jira": ["https://jira.example.com/browse/PROJ-42"] },
      "history": [...]
    }
  }'
```

3. Copy prototype files to `data/prototypes/{ID}/` so the embed URL resolves
4. Verify the prototype is accessible: `GET /api/prototypes/{ID}`

In `--dry-run` mode: print the payload and target URL but don't POST.

#### Target: `repo`

Commit and push prototype changes to a git repo. In workspace mode, this automatically creates a GitLab merge request targeting the original workspace branch.

**Workspace mode** (prototype was created in an existing codebase):

Use the `submit_to_repo.py` script to handle the full git + MR workflow:

```bash
python3 scripts/submit_to_repo.py \
  --rfe-key {ID} \
  --title "{title from metadata}" \
  [--remote {remote}] \
  [--no-ssl-verify] \
  [--dry-run]
```

The script:
1. Reads `.artifacts/{ID}/workspace-analysis.json` for the clone URL, original branch, and workspace path
2. Reads `.artifacts/{ID}/changeset.md` for the list of changed files
3. Creates branch `prototype/{ID}` in the workspace
4. Stages only the changeset files (not the entire workspace)
5. Commits with message: `prototype: {ID} — {title}`
6. Auto-detects shallow clones and runs `git fetch --unshallow` before pushing (GitLab rejects pushes from shallow repos)
7. Generates a **designer-oriented MR description** (see below)
8. Pushes to the remote with GitLab push options that automatically create a merge request targeting the original branch (e.g., `3.5`)
9. Outputs JSON with the MR URL, branch name, commit hash, and remote

**MR description:** The script automatically generates a rich merge request description by reading from `.artifacts/{ID}/`. The description is written for designers and reviewers (not developers) and includes:

- **What this adds** — a short summary of the feature from the RFE snapshot
- **Pipeline details** — fidelity level, mode (auto vs. human-in-the-loop), rubric score, and whether human review has occurred
- **Key design decisions** — each decision title, chosen option, and whether it was human-picked or auto-resolved
- **How to review** — shell commands to pull the branch and run locally
- **Assumptions** — any scope constraints or assumptions from `metadata.json`

The description explicitly states this was generated by `prototype-creator` and whether a human-in-the-loop review step was included, so reviewers know the provenance.

**Sandbox note:** This script runs `git` commands that contact remote servers and write to `.git/` internals. In Cursor, run it with `required_permissions: ["all"]` to avoid sandbox restrictions on hooks directories and network access.

**Workspace analysis requirements:** The script expects `branch` and `clone_url` fields in `.artifacts/{ID}/workspace-analysis.json`. These come from the `resolve_workspace.py` output during the create step. If they're missing, the MR will target the wrong branch or the push will fail.

If `--remote` is provided, the script pushes to that URL instead of the workspace's origin. This supports fork workflows where the user wants to push to their own repo. If `--remote` is not provided, it pushes to origin (the repo the workspace was cloned from).

Read the script's JSON output and use it for reporting:

```json
{
  "status": "pushed",
  "branch": "prototype/PROJ-298",
  "target_branch": "3.5",
  "remote": "https://gitlab.example.com/org/repo.git",
  "merge_request_url": "https://gitlab.example.com/org/repo/-/merge_requests/42",
  "commit": "abc1234",
  "files_committed": 6
}
```

**Standalone mode** (self-contained HTML prototype):

Initialize and push the prototype as a standalone git repo:

```bash
cd .artifacts/{ID}/prototype
git init
git add .
git commit -m "feat: initial prototype for {ID}"
```

If `--remote` is provided, add and push:

```bash
git remote add origin {remote-url}
git push -u origin main
```

In `--dry-run` mode: show what commands would run but don't execute them.

#### Target: `local`

No external publishing. Mark the prototype as submitted in its `metadata.json`:

```json
{
  "submission": {
    "target": "local",
    "date": "2026-04-30T12:00:00Z",
    "status": "submitted"
  }
}
```

### Step 5: Update Source RFE in Jira

If not `--dry-run` and the prototype has a linked Jira issue:

1. Extract the Jira issue key from `metadata.json` or the prototype ID pattern (e.g., `PROJ-42`)

2. Add a comment to the Jira issue linking to the prototype:

```
Prototype created by prototype-creator pipeline.

• Rubric score: 7/10 (pass)
• Prototype: [link to published location]
• Review: .artifacts/PROJ-42/reviews/summary.md
• Refinement iterations: 2

Labels applied: prototype-creator-submitted, prototype-creator-rubric-pass
```

3. Apply labels to the Jira issue:
   - Always: `prototype-creator-submitted`
   - If rubric passes: `prototype-creator-rubric-pass`
   - If rubric fails or no review: `prototype-creator-needs-attention`

In `--dry-run` mode: print the comment and labels that would be applied but don't write to Jira.

### Step 6: Update Submission Manifest

Append (or create) `.artifacts/submissions.md`:

```markdown
## Submissions

| Date | Prototype | Target | Rubric | Label | Link |
|------|-----------|--------|--------|-------|------|
| 2026-04-30 | PROJ-42 | apollo | 7/10 (pass) | rubric-pass | /api/prototypes/PROJ-42 |
| 2026-04-29 | PROJ-41 | local | 5/10 (fail) | needs-attention | local only |
```

If the file already exists, append the new row. Don't overwrite previous entries.

### Step 7: Report

Print a submission summary:

```
Prototype submitted: {ID}

Target: apollo
Rubric: 7/10 (pass)
Labels: prototype-creator-submitted, prototype-creator-rubric-pass
Jira: Comment added to PROJ-42
Location: http://localhost:1225/api/prototypes/{ID}

Submission logged in .artifacts/submissions.md
```

If `--dry-run`:

```
[DRY RUN] Prototype submission preview: {ID}

Target: apollo
Would publish to: POST http://localhost:1225/api/prototypes
Would copy files to: data/prototypes/{ID}/
Would add Jira comment to: PROJ-42
Would apply labels: prototype-creator-submitted, prototype-creator-rubric-pass

No external writes performed. Remove --dry-run to submit.
```

## Flag Reference

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--target` | `apollo`, `repo`, `local` | `local` | Where to publish the prototype |
| `--remote` | Git URL | None | Remote URL for `--target=repo` (overrides workspace origin; useful for fork workflows) |
| `--dry-run` | (flag) | Off | Validate and preview without external writes |
| `--skip-jira` | (flag) | Off | Skip Jira comment and label update |
| `--force` | (flag) | Off | Submit even if rubric score fails |
| `--no-ssl-verify` | (flag) | Off | Skip SSL certificate verification for git push (internal GitLab with self-signed certs) |

## Edge Cases

- **No Jira issue linked**: Skip the Jira update step. Log a warning:
  > No Jira issue key found for prototype `{ID}`. Skipping Jira comment and labels. Use the prototype's `metadata.json` to add a `jira` source if needed.

- **Apollo server not running (target=apollo)**: Check connectivity first with `GET /api/prototypes`. If unreachable, stop:
  > Apollo server not reachable at localhost:1225. Start the server with `./start.sh` or use `--target=local` instead.

- **Prototype already submitted**: Check `.artifacts/submissions.md` for existing entries with the same ID. If found, ask:
  > Prototype `{ID}` was already submitted on {date} to {target}. Resubmit? (This will create a new submission entry, not overwrite the previous one.)
  In `--headless` mode, proceed with resubmission and note it in the manifest.

- **Review scores have zeros (fail)**: Unless `--force` is set, warn:
  > Prototype `{ID}` scored 0 in {dimension}. This will be labeled `needs-attention`. Use `--force` to submit anyway, or run `/prototype.refine` first.

- **Large prototype (many files)**: For `--target=repo`, ensure `.gitignore` excludes temporary or generated files. For `--target=apollo`, warn if total file size exceeds 5MB.

- **Dry-run with missing dependencies**: `--dry-run` should succeed even if Apollo isn't running or Jira is unreachable — it only validates local state and previews actions.

## Output

| Output | Location |
|--------|----------|
| Published prototype | Target-dependent (Apollo API, git repo, or local only) |
| Submission manifest | `.artifacts/submissions.md` |
| Updated Jira issue | Jira comment + labels (unless `--skip-jira` or `--dry-run`) |
| Updated metadata.json | Prototype's `metadata.json` (submission record) |
