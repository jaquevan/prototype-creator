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
  [--pages-base-url https://example.pages.redhat.com] \
  [--pages-timeout 600] \
  [--jira-comment-id 12345] \
  [--no-ssl-verify] \
  [--dry-run]
```

The script:
1. Reads `.artifacts/{ID}/workspace-analysis.json` for the clone URL, original branch, and workspace path
2. Reads `.artifacts/{ID}/changeset.md` for the list of changed files
3. **Detects the workspace workflow** — fork (origin ≠ upstream) vs same-repo
4. Creates branch `prototype/{ID}` in the workspace
5. Stages only the changeset files (not the entire workspace)
6. Commits with message: `Prototype: {ID} - {title}`
7. Auto-detects shallow clones and runs `git fetch --unshallow` before pushing (GitLab rejects pushes from shallow repos)
8. **Pushes branch to origin** (the user's fork in fork workflows, or the single remote in same-repo workflows)
9. **Creates MR via `glab mr create`** with full markdown description — NOT push options (push options cannot contain newlines)
10. For fork workflows, uses `-H source_project -R target_project` to correctly map the MR across projects
11. **Verifies the MR** — checks that `sha` is non-null and `changes_count >= 1` via the GitLab API
12. If verification fails, attempts auto-recovery (re-push branch, retry verification)
13. **Polls for GitLab Pages deployment** (up to 10 minutes by default) if `--pages-base-url` is provided
14. Outputs JSON with MR URL, verification status, Pages URL, and all metadata

##### Fork vs Same-Repo Workflow Detection

The script auto-detects the workspace topology:

| Signal | Workflow | Push target | MR strategy |
|--------|----------|-------------|-------------|
| `origin` and `upstream` exist, point to different projects | **Fork** | Push to `origin` (user's fork) | `glab mr create -H fork_project -R upstream_project` |
| Only `origin` exists, or both remotes point to same project | **Same-repo** | Push to `origin` | `glab mr create` (single project) |

**Why this matters:** In a fork workflow, if you push to `upstream` and create an MR, GitLab associates the MR source with the fork project where the branch does NOT exist. Result: empty MR with `sha: null`, `changes: []`. The fix is to always push to the fork (`origin`) and explicitly tell `glab` about the source/target mapping.

##### MR Verification Checklist

After MR creation, the script verifies via `glab api`:

- `sha` is non-null (branch has commits)
- `changes_count >= 1` (MR shows real file diffs)
- `source_project_id` and `target_project_id` are consistent with the chosen workflow

If verification fails after retries:
- In fork workflows: auto-recovery pushes branch to `origin` and retries
- If still failing: outputs a clear error in the JSON result (`verification.verified: false`) so the calling skill can report it to the user

##### Pages Preview Polling

When `--pages-base-url` is provided, the script polls for the Pages deployment after MR creation:

- Polls every 20s for up to 10 minutes (configurable via `--pages-timeout`)
- Checks the MR's pipeline status via GitLab API
- When pipeline succeeds, returns the preview URL
- URL convention: `<pages_base_url>/mr-<iid>/`
- If timeout: returns the expected URL with `pages_status: "pending"`

The calling skill uses the Pages URL to update the Jira comment (see Step 5 below).

**MR description:** The script generates a rich merge request description via `glab mr create --description` (not push options). Multiline markdown is fully supported. The description includes:

- **What this adds** — a short summary of the feature from the RFE snapshot
- **Pipeline details** — fidelity level, mode (auto vs. human-in-the-loop), rubric score, and whether human review has occurred
- **Key design decisions** — each decision title, chosen option, and whether it was human-picked or auto-resolved
- **How to review** — shell commands to pull the branch and run locally
- **Assumptions** — any scope constraints or assumptions from `metadata.json`

The description explicitly states this was generated by `prototype-creator` and whether a human-in-the-loop review step was included, so reviewers know the provenance.

**Sandbox note:** This script runs `git` and `glab` commands that contact remote servers and write to `.git/` internals. In Cursor, run it with `required_permissions: ["all"]` to avoid sandbox restrictions on hooks directories and network access.

**Workspace analysis requirements:** The script expects `branch` and `workspace_path` fields in `.artifacts/{ID}/workspace-analysis.json`. These come from the `resolve_workspace.py` output during the create step. If they're missing, the MR will target the wrong branch or the push will fail.

Read the script's JSON output and use it for reporting:

```json
{
  "status": "pushed",
  "branch": "prototype/PROJ-298",
  "target_branch": "3.6",
  "push_remote": "origin",
  "workflow": "fork",
  "source_project": "abraren/rhoai",
  "target_project": "uxd/prototypes/rhoai",
  "merge_request_url": "https://gitlab.cee.redhat.com/uxd/prototypes/rhoai/-/merge_requests/42",
  "merge_request_iid": 42,
  "commit": "abc1234",
  "files_committed": 6,
  "verification": {"sha": "abc1234def", "changes_count": 6, "verified": true},
  "pages_url": "https://rhoai-5171de.pages.redhat.com/mr-42/",
  "pages_status": "live"
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

2. Add a comment to the Jira issue linking to the prototype. **This is the initial comment** — note the comment ID for later update. **All URLs must be proper Jira wiki markup hyperlinks** (format: `[display text|URL]`), not bare URLs:

```
🎨 *Prototype created by prototype-creator pipeline.*

• *Prototype preview:* ⏳ _deploying — link will be added when Pages is live_
• *Merge request:* [MR !42|https://gitlab.example.com/org/repo/-/merge_requests/42]
• *Branch:* {{prototype/PROJ-42}}
• *Rubric score:* 7/8 (pass)
• *Refinement iterations:* 2

_Labels applied: prototype-creator-submitted, prototype-creator-rubric-pass_
```

3. Apply labels to the Jira issue:
   - Always: `prototype-creator-submitted`
   - If rubric passes: `prototype-creator-rubric-pass`
   - If rubric fails or no review: `prototype-creator-needs-attention`

4. **After Pages deployment resolves** (from the `submit_to_repo.py` output or separate polling), **update the same Jira comment** (do not create a second comment) to include the live preview URL as a clickable hyperlink:

```
🎨 *Prototype created by prototype-creator pipeline.*

• *Prototype preview:* [▶ Open live prototype|https://rhoai-5171de.pages.redhat.com/mr-42/]
• *Merge request:* [MR !42|https://gitlab.example.com/org/repo/-/merge_requests/42]
• *Branch:* {{prototype/PROJ-42}}
• *Rubric score:* 7/8 (pass)
• *Refinement iterations:* 2

_Labels applied: prototype-creator-submitted, prototype-creator-rubric-pass_
```

If Pages times out (status = `pending`), update the comment with:

```
• *Prototype preview:* ⏳ _deploying_ ([expected here|https://rhoai-5171de.pages.redhat.com/mr-42/] — check MR pipeline)
```

**Jira comment formatting:** Comments use Jira wiki markup. URLs MUST be rendered as clickable hyperlinks using `[display text|URL]` syntax — never paste bare URLs. Key formatting:
- Links: `[MR !42|https://...]` or `[▶ Open prototype|https://...]`
- Bold labels: `*Label:*`
- Monospace (branch names): `{{prototype/PROJ-42}}`
- Italic: `_text_`

**Jira comment update mechanics:** Use the Jira REST API `PUT /rest/api/2/issue/{key}/comment/{commentId}` to update the existing comment. The comment ID is returned when the initial comment is created. Pass it to `submit_to_repo.py` via `--jira-comment-id` if using the script, or update directly via Jira MCP/API after the script returns.

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
| `--dry-run` | (flag) | Off | Validate and preview without external writes |
| `--skip-jira` | (flag) | Off | Skip Jira comment and label update |
| `--force` | (flag) | Off | Submit even if rubric score fails |
| `--no-ssl-verify` | (flag) | Off | Skip SSL certificate verification for git push (internal GitLab with self-signed certs) |
| `--pages-base-url` | URL | None | GitLab Pages base URL for preview polling (e.g. `https://rhoai-5171de.pages.redhat.com`) |
| `--pages-timeout` | Seconds | `600` (10 min) | How long to wait for Pages deployment before giving up |

## Edge Cases

- **Fork workflow with empty MR**: If `submit_to_repo.py` returns `verification.verified: false`, the MR has no commits/changes. This usually means the branch was pushed to the wrong remote. The script auto-recovers in most cases. If it still fails, tell the user:
  > The merge request was created but shows no changes. This happens when the branch isn't on the correct remote. Try: `git push origin prototype/{ID}` manually, then check the MR.

- **Pages deployment times out**: If `pages_status` is `"pending"` in the script output, Pages hasn't deployed yet. The Jira comment should note this with the expected URL and a suggestion to check the MR pipeline. Do NOT wait indefinitely — 10 minutes is the cap.

- **`glab` not installed or not authenticated**: If `glab mr create` fails, fall back to reporting the push succeeded but MR creation needs manual action. Print:
  > Branch pushed successfully. Could not create MR automatically (`glab` error). Create the MR manually from: {branch} → {target_branch}

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
