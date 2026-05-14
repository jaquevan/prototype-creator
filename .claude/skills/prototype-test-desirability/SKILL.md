---
name: prototype-test-desirability
description: Evaluate how the prototype feels — word associations, emotional response mapping, and preference comparison. Answers "does this look and feel right?"
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
---

# prototype-test-desirability

Runs a simulated desirability study on a prototype to evaluate its aesthetic and emotional impact. Produces structured output covering word association, emotional response mapping, preference comparison, and an overall desirability score.

## What This Does (Plain Language)

This skill evaluates how your prototype *feels* — not just whether it works, but whether it creates the right emotional impression. It's based on real UX research methods like Microsoft's Desirability Toolkit.

It answers questions like:
- **What words would users associate with this?** Professional? Modern? Cluttered? Confusing?
- **How does the emotional journey feel?** Does confidence stay high throughout, or does it dip at certain steps?
- **How does it compare to alternatives?** Would users prefer a different design direction?

The output is a desirability score (1–10) with a detailed breakdown of word associations, emotional mapping across the flow, and comparison with alternative approaches.

**When to use this:** When you care about the overall impression and want to validate that the design direction feels right — not just functional. Most useful at medium or high fidelity. At wireframe level, it can only evaluate structural desirability (layout, flow logic), not visual polish.

## Conversational Guidance

If the user asks about how the prototype feels or its visual impression (e.g., "does this look good?" or "what impression does this give?" or "would stakeholders like this?"), offer:

> I can run a desirability study on your prototype — it evaluates the emotional and aesthetic impact. I'll tell you what words users would likely associate with it, where the experience feels confident vs. uncertain, and how it stacks up against alternative approaches. Want me to run it?

## Invocation

```
/prototype.test-desirability [ID]
```

**Examples:**

```bash
# Run desirability study on prototype RFE-42
/prototype.test-desirability RFE-42

# Test a prototype in the local workspace
/prototype.test-desirability RFE-42 --local
```

## Inputs

| Input | Location | Required |
|-------|----------|----------|
| Prototype files | `.artifacts/{ID}/prototype/` | Yes |
| Research context | `.context/research-context/` (personas) | Optional |
| Comparison prototypes | `.artifacts/` (other variants, if any) | Optional |

## Step-by-Step Procedure

### Step 1: Read the Prototype

Locate and read the prototype from `.artifacts/{ID}/prototype/`.

Analyze each screen and flow with attention to:
- Visual design (color palette, typography, spacing, density)
- Layout patterns (card grid, list view, dashboard, wizard)
- Tone of microcopy (formal, casual, technical, friendly)
- Use of imagery, icons, and illustrations
- Information density and whitespace
- Interaction patterns (modals, inline editing, progressive disclosure)
- Overall polish level relative to stated fidelity

If the prototype has a `metadata.json`, read it for intended audience and purpose.

### Step 2: Load Personas

If `.context/research-context/personas.md` (or `.yaml`) exists, read it and select 2–3 personas for the study.

If no research context is available, use these default perspective lenses:

1. **End user** — the person using this tool daily to do their job
2. **Evaluator** — a stakeholder reviewing this for approval (manager, product owner)
3. **New user** — seeing this product category for the first time

### Step 3: Assessment 1 — Word Association

For each major screen or flow in the prototype, identify the 8–12 words a user would most likely associate with the experience.

Draw from a standard desirability reaction card set:

**Positive:** professional, clean, modern, intuitive, efficient, trustworthy, organized, friendly, sophisticated, powerful, elegant, simple, approachable, polished, calm, focused, clear, inviting

**Negative:** cluttered, confusing, dated, overwhelming, sterile, generic, bland, intimidating, busy, cold, complicated, amateurish, inconsistent, distracting, cramped, noisy, fragmented

**Neutral:** functional, standard, familiar, expected, utilitarian, dense, minimal, corporate, technical, conventional

For each screen, record:
- The top 5 words (most strongly associated)
- Which words are consistent across screens (brand coherence)
- Which words conflict across screens (inconsistency signal)

Then produce an aggregate word summary across the full prototype:
- **Top 5 overall words** — the prototype's "personality"
- **Consistency score** — how uniform the impression is across screens (high/medium/low)

### Step 4: Assessment 2 — Emotional Response Mapping

Walk through the prototype's primary flow from start to finish. At each stage, assess the likely emotional response:

**Emotional dimensions:**
- **Confidence** — "I know what to do" vs. "I'm not sure what's happening"
- **Control** — "I'm in charge" vs. "The system is deciding for me"
- **Satisfaction** — "This feels good" vs. "This is tedious"
- **Trust** — "I believe this will work" vs. "I'm worried about mistakes"
- **Engagement** — "I want to explore" vs. "I want to leave"

Map these across the flow stages:

```
[Entry] → [Task Start] → [Core Interaction] → [Completion] → [Result]
  😊         😐              😟                   😊            😊
```

Identify emotional dips (where confidence, satisfaction, or trust drops) — these correlate with desirability problems.

### Step 5: Assessment 3 — Preference Comparison

Compare the prototype against 2–3 alternative approaches. Alternatives can be:

1. **Other prototypes** in `.artifacts/` for the same RFE (if multiple variants exist)
2. **Common industry patterns** for the same problem domain (describe them conceptually)
3. **Extremes on a spectrum** — e.g., "minimal dashboard" vs. "data-dense dashboard" vs. "wizard-guided setup"

For each comparison:
- Describe the alternative approach briefly
- Assess which a typical user would prefer and why
- Note what the current prototype does better and worse

If no comparison prototypes exist, compare against at least two conceptual alternatives that represent different design directions.

Produce a preference ranking:
1. Most preferred approach (with rationale)
2. Second choice
3. Least preferred (with rationale for why it ranks lower)

### Step 6: Calculate Desirability Score

Compute a net desirability score from 1–10 based on the three assessments:

| Factor | Weight | Score Range |
|--------|--------|-------------|
| Word association quality | 30% | Ratio of positive to negative words |
| Emotional journey smoothness | 30% | Consistency and absence of dips |
| Preference ranking | 20% | Where this prototype ranks vs. alternatives |
| Brand coherence | 20% | Consistency of impression across screens |

**Scoring rubric:**

- **9–10**: Strongly desirable. Positive words dominate, emotional journey is smooth, users would choose this over alternatives.
- **7–8**: Desirable with minor concerns. Mostly positive impression, occasional emotional dips, competitive with alternatives.
- **5–6**: Neutral. Mixed word associations, uneven emotional journey, no clear preference advantage.
- **3–4**: Below expectations. Negative words appear frequently, emotional dips at critical moments, alternatives seem preferable.
- **1–2**: Problematic. Overwhelmingly negative associations, emotional journey is frustrating, users would actively avoid this.

### Step 7: Generate Desirability Report

Write the report to `.artifacts/{ID}/desirability-report.md`:

```markdown
---
prototype: {ID}
date: YYYY-MM-DD
desirability-score: 7
personas-used: [End User, Evaluator, New User]
---

# Desirability Report: {ID}

## Summary

2–3 sentence overview. State the net desirability score and the
dominant impression the prototype creates.

## Net Desirability Score: 7 / 10

| Factor | Score | Notes |
|--------|-------|-------|
| Word association quality | 7.5 | Mostly positive; "cluttered" appeared on data table screen |
| Emotional journey smoothness | 6.5 | Confidence dip during multi-step form |
| Preference ranking | 7.0 | Preferred over data-dense alt, behind wizard-guided alt |
| Brand coherence | 7.5 | Consistent modern/professional tone across 4 of 5 screens |

## Word Association Summary

### Overall Prototype Personality

Top 5 words: **professional, clean, modern, functional, organized**

Consistency: **Medium** — the data table screen breaks from the
otherwise clean impression with higher density.

### Per-Screen Breakdown

| Screen | Top Words | Sentiment |
|--------|-----------|-----------|
| Dashboard | professional, modern, clean | Positive |
| Config List | organized, functional, familiar | Neutral-positive |
| Data Table | dense, cluttered, powerful | Mixed |
| Detail View | clean, clear, simple | Positive |
| Settings | standard, minimal, expected | Neutral |

### Word Frequency

**Positive (68%):** professional ×4, clean ×3, modern ×3, organized ×2,
clear ×2, simple ×1, powerful ×1

**Neutral (20%):** functional ×2, familiar ×1, standard ×1, minimal ×1,
expected ×1, dense ×1

**Negative (12%):** cluttered ×2, overwhelming ×1

## Emotional Journey Map

```
Screen:     Dashboard → Config List → New Config → Validation → Success
Confidence:   High        High         Medium        Low          High
Control:      High        High         Medium        Medium       High
Satisfaction: High        Medium       Medium        Low          High
Trust:        High        High         High          Medium       High
Engagement:   Medium      Medium       High          Low          Medium
```

**Emotional dips identified:**

1. **New Config → Validation** — confidence and satisfaction drop during
   the multi-step form. The form doesn't indicate progress or how many
   steps remain. Validation errors are shown after submission rather
   than inline.

2. **Config List** — satisfaction is moderate rather than high because
   the list doesn't surface key information at a glance. Users need
   to click into items to see details.

## Preference Comparison

### Alternatives Compared

1. **Current prototype** — card-based dashboard with separate config screens
2. **Alternative A: Wizard-guided setup** — step-by-step guided flow
   with progress indicator
3. **Alternative B: Data-dense single page** — everything on one
   scrollable page with filters and inline editing

### Ranking

| Rank | Approach | Rationale |
|------|----------|-----------|
| 1 | Alternative A (Wizard) | Guided flow builds confidence, especially for new users. Clear progress indication reduces anxiety. |
| 2 | **Current prototype** | Clean and professional, but the multi-step form lacks the guidance that a wizard provides. Better for returning users who know the flow. |
| 3 | Alternative B (Dense) | Efficient for power users but overwhelming for everyone else. Higher learning curve and lower initial desirability. |

### What the Current Prototype Does Well
- Professional visual tone that builds trust
- Clean separation of concerns across screens
- Consistent use of design system components

### Where Alternatives Win
- Wizard approach better at guiding first-time users through setup
- Dense approach more efficient for experienced users doing bulk operations

## Recommendations

1. **Add progress indication to multi-step flows** — a step indicator
   or progress bar would smooth the emotional dip during configuration.
   This borrows from the wizard approach without a full redesign.

2. **Surface key details in list views** — show 2–3 key attributes
   inline so users don't need to click through to find what they need.

3. **Reduce density on the data table screen** — this is the only screen
   that breaks the otherwise clean impression. Consider pagination or
   a summary view with drill-down.

4. **Add inline validation to forms** — showing errors as users type
   rather than after submission would maintain confidence and
   satisfaction through the flow.

## Methodology Note

This is a simulated desirability study using established UX research
techniques (Microsoft Desirability Toolkit word association, emotional
response mapping, and preference testing). Results represent predicted
user reactions based on design analysis, not actual user data. Findings
should be validated with real users when possible.
```

### Step 8: Report Completion

Print a summary:

```
Desirability study complete: {ID}

Net desirability score: 7 / 10
Dominant impression: professional, clean, modern
Emotional dips: 1 (multi-step form → validation)
Preference rank: 2 of 3 (behind wizard-guided alternative)

Report: .artifacts/{ID}/desirability-report.md
```

## Edge Cases

- **Single-screen prototype**: Word association and emotional mapping apply to that one screen. For preference comparison, compare layout and density variations rather than flow alternatives. The emotional journey covers micro-interactions within the screen (hover, click, form fill, submit).
- **Low-fidelity wireframe**: Assess structural desirability (layout, information hierarchy, flow logic) rather than visual polish. Note in the report that visual desirability cannot be fully evaluated at wireframe fidelity. Reduce scoring weight on word association and increase weight on emotional journey.
- **Multiple prototype variants exist**: Use the other variants as the comparison set in the preference assessment instead of conceptual alternatives. This gives a more grounded comparison.
- **No research context**: Use the default persona lenses. Document in the report that personas were generic rather than research-informed.
- **Prototype is purely functional (no visual design)**: Focus the assessment on interaction desirability — is the flow satisfying? Does the information architecture feel logical? Score visual factors as N/A and note the limitation.

## Output

| Output | Location |
|--------|----------|
| Desirability report | `.artifacts/{ID}/desirability-report.md` |
