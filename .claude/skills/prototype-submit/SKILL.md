---
name: prototype-submit
description: Publishes a prototype to a target system and links it back to the source RFE.
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
---

# prototype-submit

Publishes a completed prototype to a target system (Apollo, a git repo, or local-only) and links it back to the source RFE in Jira. Tracks all submissions in a central manifest.

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
| Prototype files | `artifacts/prototypes/{ID}/` or `local/prototypes/{ID}/` | Yes |
| Review scores | `artifacts/prototype-reviews/{ID}-summary.md` | Recommended |
| Usability report | `artifacts/usability-reports/{ID}-usability.md` | Optional |
| Desirability report | `artifacts/desirability-reports/{ID}-desirability.md` | Optional |
| Pipeline config | `tmp/prototype-config.yaml` | Optional |

## Step-by-Step Procedure

### Step 1: Locate and Validate the Prototype

Find the prototype in `artifacts/prototypes/{ID}/` or `local/prototypes/{ID}/`.

Validate minimum requirements:
- `index.html` exists (or at least one HTML file)
- `metadata.json` exists and has required fields (`id`, `name`, `description`)

If validation fails, stop:

> Prototype `{ID}` is incomplete. Missing: [list]. Fix these before submitting.

### Step 2: Read Review Scores

Read the review summary from `artifacts/prototype-reviews/{ID}-summary.md`.

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
    review: artifacts/prototype-reviews/{ID}-summary.md
    usability: artifacts/usability-reports/{ID}-usability.md  # if exists
    desirability: artifacts/desirability-reports/{ID}-desirability.md  # if exists
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

Initialize and push the prototype as a standalone git repo.

1. Initialize a git repo in the prototype directory:

```bash
cd artifacts/prototypes/{ID}
git init
git add .
git commit -m "feat: initial prototype for {ID}"
```

2. If `--remote` is provided, add and push:

```bash
git remote add origin {remote-url}
git push -u origin main
```

3. Record the repo URL in submission metadata

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
• Review: artifacts/prototype-reviews/PROJ-42-summary.md
• Refinement iterations: 2

Labels applied: prototype-creator-submitted, prototype-creator-rubric-pass
```

3. Apply labels to the Jira issue:
   - Always: `prototype-creator-submitted`
   - If rubric passes: `prototype-creator-rubric-pass`
   - If rubric fails or no review: `prototype-creator-needs-attention`

In `--dry-run` mode: print the comment and labels that would be applied but don't write to Jira.

### Step 6: Update Submission Manifest

Append (or create) `artifacts/prototype-submissions.md`:

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

Submission logged in artifacts/prototype-submissions.md
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
| `--remote` | Git URL | None | Remote URL for `--target=repo` |
| `--dry-run` | (flag) | Off | Validate and preview without external writes |
| `--skip-jira` | (flag) | Off | Skip Jira comment and label update |
| `--force` | (flag) | Off | Submit even if rubric score fails |

## Edge Cases

- **No Jira issue linked**: Skip the Jira update step. Log a warning:
  > No Jira issue key found for prototype `{ID}`. Skipping Jira comment and labels. Use the prototype's `metadata.json` to add a `jira` source if needed.

- **Apollo server not running (target=apollo)**: Check connectivity first with `GET /api/prototypes`. If unreachable, stop:
  > Apollo server not reachable at localhost:1225. Start the server with `./start.sh` or use `--target=local` instead.

- **Prototype already submitted**: Check `artifacts/prototype-submissions.md` for existing entries with the same ID. If found, ask:
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
| Submission manifest | `artifacts/prototype-submissions.md` |
| Updated Jira issue | Jira comment + labels (unless `--skip-jira` or `--dry-run`) |
| Updated metadata.json | Prototype's `metadata.json` (submission record) |
