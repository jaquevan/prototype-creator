# Decision Kit Integration

prototype-creator integrates with [decision-kit](https://github.com/jnemargut/decision-kit) to keep humans in the loop during prototype generation. When you use `--mode=decide`, the AI dynamically identifies design decisions that matter for your specific RFE and surfaces them as structured artifacts.

## How It Works

### The Separation

- **AI explores**: Analyzes the RFE and target codebase, identifies decisions with genuine tradeoffs, generates options, renders visual previews, analyzes tradeoffs, provides a recommendation
- **You judge**: Pick the option that fits your context. Override the recommendation. Bring your own answer.
- **Prototype builds**: Each choice compounds into the final prototype

### Dynamic Decision Discovery

Decisions are **not a fixed checklist**. The AI analyzes the RFE, target codebase (if `--workspace` is set), and any upstream decisions to plan which decisions actually need human judgment. Decisions the AI is confident about are auto-resolved with a note.

```
/prototype.create PROJ-298 --mode=decide --fidelity=medium --workspace=/path/to/rhoai

  Decision Plan (6 decisions):
  ─────────────────────────────
  1. Page layout pattern          → Surface (3 viable approaches)
  2. Pipeline list vs. card       → Surface (tradeoff: density vs. scannability)
  3. Creation flow style          → Surface (wizard vs. form)
  4. Status visualization         → Surface (multiple valid patterns)
  5. Navigation integration       → Auto-resolve (existing sidebar is clear)
  6. Error state handling         → Auto-resolve (PatternFly conventions)

  Surfacing 4 decisions for human input. 2 auto-resolved.

  Decision 1/4: Page Layout Pattern
  ┌─────────────────────────────────────────────────┐
  │ "What overall page structure best serves these   │
  │  user stories?"                                  │
  │                                                  │
  │  A) List + Detail                                │
  │  B) Card Grid                                    │
  │  C) Dashboard                                    │
  │  D) Wizard / Stepper                             │
  │                                                  │
  │  → AI recommends: A (List + Detail)              │
  │  → You pick: A                                   │
  │  → Reasoning: "Users need to compare items       │
  │     side by side"                                 │
  └─────────────────────────────────────────────────┘

  Decision 2/4: Pipeline Display
  (builds on your layout choice, informed by target codebase patterns)
  ...

  → Code changes generated in the target codebase
```

### Decision Depth

Control how many decisions are surfaced with `--depth`:

- `--depth=under` — 2–3 highest-stakes decisions only
- `--depth=normal` — 4–7 context-dependent decisions (default)
- `--depth=over` — 8–12 decisions for thorough exploration

### Decision Artifacts

All decisions are stored in `.artifacts/{ID}/decisions/` following the decision-kit spec:

```
.artifacts/PROJ-298/decisions/
├── decisions.json                     # Machine-readable state
├── decision-001.html                  # Browsable visual comparison page
├── decision-002.html
├── decision-003.html
├── decision-004.html
├── index.html                         # Landing page showing all decisions
├── auto-review.html                   # Batch review page (auto mode)
└── strategy-brief.md                  # Summary of all choices
```

Each `.html` file is a self-contained page you can open in a browser — it shows all options with visual previews, tradeoffs, the side-by-side comparison, and your choice.

`decisions.json` tracks each decision with its status, chosen option, reasoning, and history.

## Decisions Compound

Each decision reads all prior decisions. Options are informed by earlier choices and by the target codebase's existing patterns. Nothing resets. Context builds.

This means the prototype isn't just "AI generated some code." It's "a human made deliberate design decisions, each building on the last, and the prototype reflects exactly those choices."

## Decisions Feed Downstream

When strat-creator runs on the same RFE, it can read the decision artifacts:

```
.artifacts/PROJ-298/decisions/strategy-brief.md
→ strat-creator reads this as architectural context
→ "The team prototyped PROJ-298 and chose List+Detail layout
    because users need side-by-side comparison"
→ Strategy includes this as a design constraint
```

The decisions become part of the permanent record. Six months later, someone asks "why does this feature use a list+detail layout?" The answer is in `.artifacts/PROJ-298/decisions/`, with the visual comparison page showing what was considered and why.

## Auto Mode

`--mode=auto` generates every decision with the same rigor (research, options, recommendation) but auto-picks the recommended option. After all decisions are made, a single batch-review page (`.artifacts/{ID}/decisions/auto-review.html`) is generated so the human can confirm or override before code generation proceeds.

This is useful for:

- CI batch runs where you want quick prototypes at scale
- Low-fidelity wireframes where individual decisions matter less
- Generating a starting point to iterate on later

## Workspace Mode

When `--workspace` is set, the pipeline modifies an existing codebase instead of generating standalone HTML:

1. Analyzes the target codebase's tech stack, conventions, and relevant areas
2. Surfaces decisions informed by what already exists in the codebase
3. Generates code in the target's tech stack (React, Angular, static HTML, etc.)
4. Writes a changeset manifest tracking what was created and modified

Without `--workspace`, the pipeline generates standalone self-contained HTML prototypes to `.artifacts/{ID}/prototype/`.

## Without Decision Kit

If decision-kit is not bootstrapped (`.context/decision-kit/` is empty), decide mode uses built-in decision prompts following the same artifact format. To get the full experience:

```bash
bash scripts/bootstrap-decision-kit.sh
```
