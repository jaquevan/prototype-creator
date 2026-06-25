---
name: eval-hint
description: Scan workspace source files from the MR delta to extract navigation hints — routes, CSS selectors, page structure, and nav hierarchy. Produces navigation-hints.json for eval-journey.
user-invocable: false
allowed-tools: Read, Write, Bash, Glob, Grep
---

# eval-hint

Pre-journey intelligence gathering. Reads the workspace source files listed in `mr-delta.json` and extracts concrete information that helps eval-journey generate precise Playwright scripts. This skill is the "hinter" — it has full code access. The persona walker (eval-journey) stays blind to paths.

## Inputs

| Input | Description | Required |
|-------|-------------|----------|
| `.artifacts/<KEY>/mr-delta.json` | Changed files list from eval-extract | Yes |
| `--workspace` | Path to prototype source code | Yes |
| `.artifacts/<KEY>/extract-state.json` | Journey definitions (to match routes to journeys) | Yes |

## Outputs

| File | Description |
|------|-------------|
| `.artifacts/<KEY>/navigation-hints.json` | Routes, selectors, page structure, nav hierarchy |

## What the hints are used for (and what they are NOT)

**Used for:**
- Targeted CSS selectors in the generated Playwright script (replaces generic guessing)
- Diagnostic fallback URLs after click-first fails (to distinguish orphaned from missing)
- Nav section hierarchy (which parent button to expand for which child link)
- Fix suggestions (file paths where issues live)

**NOT used for:**
- Telling the persona where to click (defeats usability test)
- Auto-navigating to pages (hides discoverability issues)
- Scoring or verdicts (those come from what the walker actually experiences)

## Procedure

### Step 1: Read MR delta and identify target files

Read `.artifacts/<KEY>/mr-delta.json`. Collect all files from `new_files` and `modified_files`.

Also identify related files not in the delta that provide navigation context:
- Route files: `AppRoutes.tsx`, `*Routes*`, `*routes*`
- Nav/sidebar config: `AppLayout.tsx`, `*Nav*`, `*Sidebar*`, `*navigation*`
- Feature flag files: `FeatureFlags*`, `*flags*`

```bash
cd <workspace>
# Find route definitions
grep -rl "Route\|path:" src/app/ --include="*.tsx" --include="*.ts" | head -10
# Find nav configuration
grep -rl "nav\|sidebar\|Nav\|Sidebar" src/app/ --include="*.tsx" --include="*.ts" | grep -i "layout\|nav\|sidebar" | head -10
```

### Step 2: Extract routes

Read route files and extract path definitions:

```bash
cd <workspace>
grep -n "path:" src/app/AppRoutes.tsx 2>/dev/null || grep -rn "path:" src/app/ --include="*Route*" | head -30
```

For each route, record:
- `path` — the URL path (e.g., `/gen-ai-studio/playground`)
- `file` — which file defines it
- `line` — line number
- `component` — the component rendered at that route (if discoverable)

### Step 3: Extract nav hierarchy

Read the sidebar/nav configuration to determine which sections contain which links:

```bash
cd <workspace>
# Read the nav layout file
cat src/app/AppLayout/AppLayout.tsx | grep -A 2 "NavItem\|nav__link\|expandable" | head -50
```

Build the nav section map: which parent button expands to reveal which child links. This directly tells eval-journey which section to expand for each target page.

### Step 4: Extract component selectors from changed files

For each file in the MR delta, read it and extract:
- `data-testid` attributes
- `aria-label` values on buttons/inputs
- CSS class names on interactive elements (buttons, inputs, textareas, selects)
- `id` attributes on forms and controls

```bash
cd <workspace>
for f in <new_files + modified_files>; do
  grep -n "data-testid\|aria-label\|className.*pf-\|id=\"" "$f" 2>/dev/null
done
```

Also scan the TARGET pages (components rendered at routes from Step 2):
- If route `/gen-ai-studio/playground` renders `PlaygroundPage.tsx`, read that file too
- Extract all interactive element selectors from it

### Step 5: Determine page structure

For each route/page identified, summarize what interactive elements exist:
- Does it have a `<textarea>`? (chat input)
- Does it have `<input type="file">`? (file upload)
- Does it have `<select>` or model selector components? (model choice)
- Does it have buttons with specific aria-labels? (send, attach, microphone)

### Step 6: Write navigation-hints.json

```json
{
  "extracted_at": "<ISO timestamp>",
  "workspace": "<workspace path>",
  "routes": [
    {
      "path": "/gen-ai-studio/playground",
      "file": "src/app/AppRoutes.tsx",
      "line": 142,
      "component": "PlaygroundPage"
    }
  ],
  "selectors": {
    "attach_button": ".pf-chatbot__message-bar-attach",
    "chat_input": "textarea.pf-chatbot__message-bar-input",
    "model_select": "select.pf-v6-c-form-control",
    "send_button": "button[aria-label=\"Send\"]",
    "microphone_button": "button[aria-label=\"Microphone\"]"
  },
  "page_structure": {
    "/gen-ai-studio/playground": {
      "has_textarea": true,
      "has_file_input": true,
      "has_model_selector": true,
      "form_elements": ["textarea", "select", "input[type=file]"],
      "buttons": ["Send", "Attach", "Microphone"]
    }
  },
  "nav_sections": {
    "Gen AI studio": {
      "children": ["AI asset endpoints", "Playground", "Prompt management", "API keys"],
      "selector": "button:has-text(\"Gen AI studio\")"
    },
    "AI hub": {
      "children": ["Models", "MCP servers"],
      "selector": "button:has-text(\"AI hub\")"
    }
  },
  "feature_flags": {
    "enabled": ["enableMultimodalCapabilities", "enableMultimodalInput", "enableMultimodalOutput"],
    "file": "src/app/utils/FeatureFlagsContext.tsx"
  }
}
```

## Rules

- Read ONLY files in the workspace. Do not fetch external URLs.
- Extract selectors from the ACTUAL source code, not guessed patterns.
- If a file in mr-delta.json doesn't exist (deleted), skip it.
- The nav_sections map must reflect the ACTUAL sidebar hierarchy, not assumptions.
- This skill runs ONCE per evaluation (not per iteration). Hints are static — the workspace structure doesn't change between eval-fix cycles (only file contents do).
