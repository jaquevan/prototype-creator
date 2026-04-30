# Decision Kit Integration

prototype-creator integrates with [decision-kit](https://github.com/jnemargut/decision-kit) to keep humans in the loop during prototype generation. When you use `--mode=decide`, every significant design decision becomes a structured artifact.

## How It Works

### The Separation

- **AI explores**: Generates options, renders visual previews, analyzes tradeoffs, provides a recommendation
- **You judge**: Pick the option that fits your context. Override the recommendation. Bring your own answer.
- **Prototype builds**: Each choice compounds into the final prototype

### Decision Flow

```
/prototype.create PROJ-298 --mode=decide --fidelity=medium

  Decision 1: Layout Pattern
  ┌─────────────────────────────────────────────────┐
  │ "What overall page structure best serves these   │
  │  user stories?"                                  │
  │                                                  │
  │  A) List + Detail                                │
  │  B) Card Grid                                    │
  │  C) Dashboard                                    │
  │  D) Wizard / Stepper                             │
  │                                                  │
  │  → AI recommends: B (Card Grid)                  │
  │  → You pick: A (List + Detail)                   │
  │  → Reasoning: "Users need to compare items       │
  │     side by side, list+detail is better for       │
  │     that workflow"                                │
  └─────────────────────────────────────────────────┘

  Decision 2: Interaction Model
  (builds on your layout choice)
  ...

  Decision 5: Key Components
  (informed by all prior decisions)
  ...

  → Prototype generated with all your choices applied
```

### Decision Artifacts

Each decision produces a file in `artifacts/decisions/`:

```
artifacts/decisions/
├── PROJ-298-01-layout-pattern.md      # Decision record
├── PROJ-298-01-layout-pattern.html    # Browsable visual comparison page
├── PROJ-298-02-interaction-model.md
├── PROJ-298-02-interaction-model.html
├── PROJ-298-03-info-density.md
├── PROJ-298-03-info-density.html
├── PROJ-298-04-visual-tone.md
├── PROJ-298-04-visual-tone.html
└── PROJ-298-05-key-components.md
```

The `.md` files have YAML frontmatter with structured decision data:

```yaml
---
decision_id: PROJ-298-01
prototype_id: PROJ-298
decision_point: layout-pattern
chosen_option: list-detail
reasoning: Users need to compare items side by side
decided_at: 2026-04-30T12:00:00Z
---
```

The `.html` files are self-contained pages you can open in a browser — they show all options with visual previews, tradeoffs, the side-by-side comparison, and your choice.

## Decisions Compound

Each decision reads all prior decisions. The interaction model options are filtered by what makes sense for your chosen layout. The component choices are informed by your visual tone. Nothing resets. Context builds.

This means the prototype isn't just "AI generated an HTML page." It's "a human made 5 deliberate design decisions, each building on the last, and the prototype reflects exactly those choices."

## Decisions Feed Downstream

When strat-creator runs on the same RFE, it can read the decision artifacts:

```
artifacts/decisions/PROJ-298-01-layout-pattern.md
→ strat-creator reads this as architectural context
→ "The team prototyped PROJ-298 and chose List+Detail layout
    because users need side-by-side comparison"
→ Strategy includes this as a design constraint
```

The decisions become part of the permanent record. Six months later, someone asks "why does this feature use a list+detail layout?" The answer is in `artifacts/decisions/`, with the visual comparison page showing what was considered and why.

## Auto Mode

`--mode=auto` skips the per-decision pause. AI picks the recommended option for every decision. This is useful for:

- CI batch runs where you want quick prototypes at scale
- Low-fidelity wireframes where individual decisions matter less
- Generating a starting point to iterate on later

Auto mode still writes decision artifacts, but with `auto_picked: true` in the frontmatter. You can review all auto-picked decisions after the fact.

## Configuration

Decision points are defined in `config/decision-points.yaml`. You can:
- Add new decision points
- Reorder existing ones
- Customize the options for each decision
- Mark decisions as `dynamic: true` to generate options based on context

## Without Decision Kit

If decision-kit is not bootstrapped (`.context/decision-kit/` is empty), decide mode uses built-in decision prompts. The experience is similar but without the full decision-kit artifact format. To get the full experience:

```bash
bash scripts/bootstrap-decision-kit.sh
```
