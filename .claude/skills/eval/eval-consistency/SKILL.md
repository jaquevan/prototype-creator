---
name: eval-consistency
description: Check PatternFly design guideline compliance against prototype source code and screenshots. Optional eval phase.
user-invocable: false
allowed-tools: Read, Write, Bash, Glob, Grep
---

# eval-consistency

Phase 2c of the eval pipeline. Runs PatternFly design consistency checks against the prototype using vendored guidelines from Beau Morley's [consistency-checker](https://gitlab.cee.redhat.com/bmorley/consistency-checker).

**Skip this entire skill if `.context/consistency-checker/` does not exist.** Write `{"skipped": true, "reason": "consistency-checker not bootstrapped"}` to `consistency-report.json` and exit.

## Inputs

| Input | Description | Required |
|-------|-------------|----------|
| `.context/consistency-checker/guidelines/` | Vendored PatternFly guideline markdown files | Yes |
| `.artifacts/<KEY>/mr-delta.json` | Changed files list (scopes source-mode checks) | No |
| `.artifacts/<KEY>/journey-log.json` | Screenshots for visual-mode checks | No |
| `.artifacts/<KEY>/screenshots/` | Journey screenshots | No |
| `--workspace` | Path to prototype source | No |

## Outputs

| File | Description |
|------|-------------|
| `.artifacts/<KEY>/consistency-report.json` | Full consistency report (source + visual findings) |
| `.artifacts/<KEY>/refinement-suggestions.json` | Appended with consistency suggestions |

## Procedure

### Step 1: Source Code Mode (when `--workspace` available)

**REQUIRED: Actually read the guideline files.** Do not produce placeholder results.

#### 1a: Load all guidelines

Read ALL `.md` files recursively from `.context/consistency-checker/guidelines/`:

```bash
find .context/consistency-checker/guidelines/ -name "*.md" -type f
```

The directory structure is organized by category:
- `tables/` — table-cell-content, table-column-headers, table-pagination, table-style-selection, table-toolbar-layout
- `icons/` — icon style patterns
- `labels/` — label usage patterns
- `layouts/` — page layout patterns
- `menus/` — menu patterns
- `navigation/` — nav patterns
- `buttons/` — button patterns

For each guideline file, extract:
- **Frontmatter:** `id`, `title`, `category`, `severity` (from YAML between `---` markers)
- **Rule:** The content under the `## Rule` heading (the actual check to perform)

#### 1b: Scope to MR delta files

Read `.artifacts/<KEY>/mr-delta.json`. Collect `new_files` + `modified_files`. Only check these files — pre-existing violations in unchanged files are not this prototype's responsibility.

#### 1c: Check each guideline against each scoped file

For each file in the MR delta, read its source from the workspace:

```bash
cat <workspace>/<file-path>
```

Then for each loaded guideline, check if the rule applies to this file type (e.g., table guidelines apply to files containing `<Table`, `<Tr`, `<Td`; icon guidelines apply to files importing `*Icon`).

**When a rule applies:** Read the source and check for violations. Common checks include:
- Column headers truncated (table-column-headers: look for `width` props that would force truncation)
- Missing empty-state dash (table-cell-content: check `{value || ''}` patterns — should use `'-'`)
- Icon without `Outlined` suffix (icons: check `FolderIcon` vs `OutlinedFolderIcon`)
- Primary button after secondary (buttons: check `<Button variant="primary">` position relative to `variant="secondary"`)

Record each violation with: `guideline_id`, `guideline_title`, `category`, `severity`, `file`, `line`, `description`, `suggestion`, `pf_doc_url`.

#### 1d: Compute summary

```
total_guidelines_checked = number of guidelines where the rule was applicable to at least one file
violations = count of severity:error findings
warnings = count of severity:warning findings
passes = total_guidelines_checked - violations - warnings
```

### Step 2: Visual Mode (when screenshots exist)

Cross-reference captured screenshots against PatternFly guidelines for visual violations (icon style, layout patterns, empty states, CTA placement) that source-mode cannot detect.

1. Collect unique screenshots from `journey-log.json` (both `journeys[].steps[].screenshot` and `exploration[].steps[].screenshot`).
2. For each screenshot, check against applicable visual guidelines.
3. Each finding records: `screenshot`, `journey`, `step`, `guideline_id`, `guideline_title`, `category`, `severity`, `verdict` (`VIOLATION`), `description`, `suggestion`.
4. **Deduplicate:** If the same violation appears on multiple screenshots, collapse to one finding with a `seen_on` array.

### Step 3: Write consistency-report.json

```json
{
  "source": "consistency-checker",
  "checked_at": "<ISO timestamp>",
  "guidelines_version": "<git short hash from .context/consistency-checker/>",
  "source_mode": {
    "ran": true,
    "violations": []
  },
  "visual_mode": {
    "ran": true,
    "screenshots_checked": 12,
    "findings": []
  },
  "summary": {
    "total_guidelines_checked": 8,
    "violations": 3,
    "warnings": 1,
    "passes": 4
  }
}
```

Set `"ran": false` for any mode that could not execute (no workspace = no source mode; no screenshots = no visual mode).

### Step 4: Append to refinement-suggestions.json

For each violation, add a consistency suggestion entry:

```json
{
  "type": "consistency",
  "guideline_id": "<id>",
  "severity": "<error|warning>",
  "file": "<path>",
  "line": "<number>",
  "current": "<what's there now>",
  "fix": "<what it should be>",
  "pf_doc_url": "<url>",
  "source": "<source_mode|visual_mode>"
}
```

Only include violations from MR delta files. Consistency fixes are applied FIRST by eval-fix (deterministic, high confidence).
