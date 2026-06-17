# Evaluation Report Hosting Options

Reports are currently local-only (`.artifacts/<KEY>/evaluation-report.html`). Stakeholders can't view them without running the eval or receiving the file directly. This doc evaluates options for making reports accessible via URL.

## Requirements

- Self-contained HTML (base64 screenshots embedded, no external deps)
- Internal-only access (Red Hat employees)
- Updatable — re-running an eval should update the same URL
- Low maintenance — no infra to manage long-term

## Options

### 1. GitLab Pages (on prototype repo)

**How:** Deploy reports as a CI artifact on the same GitLab instance where prototypes live (`gitlab.cee.redhat.com`). Each eval report gets a path like `rhoai-5171de.pages.redhat.com/evals/RHAISTRAT-1740/`.

**Pros:**
- Internal-only by default (same auth as GitLab)
- Same infrastructure as the prototypes themselves
- CI can auto-deploy after eval completes

**Cons:**
- Andy filed a bug 6 months ago about unique-per-MR URLs not working on this instance
- May require a separate Pages site just for evals
- Reports are 5-15MB each (base64 screenshots) — could hit Pages size limits

**Verdict:** Best option if the Pages URL bug gets fixed. Natural fit.

### 2. GitHub Pages (on the fork)

**How:** Push HTML reports to a `gh-pages` branch on `jaquevan/prototype-creator`. Each eval at `jaquevan.github.io/prototype-creator/evals/RHAISTRAT-1740/`.

**Pros:**
- Free, reliable, fast CDN
- Easy to set up (just push to branch)
- Supports large files

**Cons:**
- Public by default — reports contain internal Jira data, screenshot content
- Could use a private repo, but GitHub Pages for private repos requires Enterprise
- Not on the Red Hat internal network

**Verdict:** Not suitable for internal-only reports unless we strip sensitive data.

### 3. S3 + CloudFront (Red Hat internal)

**How:** Upload HTML reports to an internal S3 bucket with CloudFront + SAML auth.

**Pros:**
- Full access control (Red Hat SSO)
- Scalable, no size limits
- Can set per-file permissions

**Cons:**
- Requires AWS access and configuration
- More infrastructure to maintain
- Overkill for the current scale (10-20 reports)

**Verdict:** Right answer at scale, too heavy for now.

### 4. Commit to a `reports/` branch (simplest)

**How:** Commit the HTML reports directly to a `reports` branch on the GitLab prototype repo. Link from the Google Sheet. Anyone with repo access can view via raw file URL.

**Pros:**
- Zero infrastructure — just git push
- Already internal-only (GitLab access required)
- Reports are versioned in git history
- Google Sheet can link directly to raw file URLs

**Cons:**
- Git not designed for large binary-like files (base64 HTML = 5-15MB each)
- 20 reports = 100-300MB on the branch over time
- No pretty URLs (raw file view in GitLab)

**Verdict:** Good enough for now. Simple, no infra, internal-only.

## Recommendation

**Start with Option 4** (commit to `reports/` branch) for immediate stakeholder access. It's zero-config and solves the "Andy can't see the report without running it locally" problem today.

**Migrate to Option 1** (GitLab Pages) when the per-MR URL issue is resolved. That gives us pretty URLs, CI integration, and automatic updates.

**Consider Option 3** (S3) only if we hit 50+ reports and the git branch becomes unwieldy.

## Next Steps

- [ ] Create `reports` branch on the prototype repo
- [ ] Add `scripts/publish-report.sh` that copies HTML to the branch and pushes
- [ ] Update `scripts/sync-sheet.js` to include the report URL in the Google Sheet
- [ ] Test raw file URL access for team members
