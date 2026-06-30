# Future Initiatives

Captured from the Andy/Evan meeting on June 29, 2026. These are validated ideas that need further exploration, research, or infrastructure before implementation.

---

## A. PC7 Cluster Hosting + Report Dashboard

**Problem:** Sharing is an issue. Reports are local-only or buried in random GitLab Pages links. Finding them is tricky. No central place to browse, sort, or search eval reports.

**Solution:** Use the UXD POC7 OpenShift cluster to host a containerized eval report portal.

**What it would contain:**
- Homepage/index listing all eval reports (sortable by date, searchable by story key)
- Each report accessible at a clean URL (e.g., `/evals/RHAISTRAT-432/`)
- Aggregate view: common failures, average usability scores, design patterns that keep failing
- Date/time tracking for every run
- Eventually: prototype URLs hosted alongside reports (not just links to localhost)

**Architecture:**
- Containerize: small Node/Express app or static file server with an index generator
- Deploy to UXD POC7 cluster (OpenShift)
- CI/automation pushes reports to the cluster after each eval run
- Reference: Jan's Google doc on cluster access (shared in Slack)

**Prerequisites:**
- Review cluster documentation (shared by Andy)
- Understand PVC (persistent volume claims) for storing reports
- Look at how Bo set up analytics on the same cluster

---

## B. Leaderboard of Pain

**Problem:** Research insights are scattered across individual reports, Archie (UX research database), and eval findings. No synthesized view of "what are the top pain points across all our research and evaluations?"

**Concept:** AI-driven synthesis across eval reports and research artifacts to surface a ranked list of user pain points with confidence scores.

**How it might work:**
- Ingest eval reports (usability dimension scores, failed ACs, persona confusion events)
- Ingest Archie research notes (Google Sheet with UX research entries)
- AI extracts pain points from each source and assigns/accumulates scores
- Present as a ranked "leaderboard" — top pain points across all data sources
- Could process incrementally (each new eval or research note adds to the picture)

**Open questions:**
- What scoring model? (frequency-based? severity-weighted? both?)
- How to handle AI confidence/accuracy concerns (Andy and research team both flagged this)
- Integration with Archie — can we watch the Google Sheet for updates?
- What does the UI look like? (Andy mentioned Yahav and Ying both prototyped representations)

**Next steps:**
- Watch Breakaway hackathon recording (link in Slack from Andy)
- Ask Yahav about her previous work on UX research representations and pain point tracking
- Look at existing implementation examples from the hackathon

---

## C. Cross-Platform Composability + UXD Repository Migration

**Problem:** Skills are being organized at multiple levels (Red Hat AI product level, UXD level, UIE cross-engineering level). Eval skills need to be portable and not locked to OpenShift AI specifics.

**What to keep in mind:**
- UXD-level AI helpers repo already has `prototype-evaluate` (Andy's, older heuristic version)
- Our eval skills will eventually replace/upgrade that
- Product overlay pattern (`config/product-overlay.yaml`) already exists for RHOAI-specific config
- After script reorganization, eval skills are self-contained and copy-moveable

**Migration path:**
1. Finish PR cleanup
2. Merge into prototype-creator
3. When ready, copy `.claude/skills/eval/` to UXD AI helpers repo as a top-level skill
4. Add product overlay mechanism so it adapts to different product contexts

---

## D. Jira Entity Linking (RF vs Strat Confusion)

**Problem:** The breadcrumb in the eval report links to "Strat" but the upstream entity should be the RF (Request for Feature). PMs create RFs which auto-generate Strats. The prototype should ideally link to the RF.

**Resolution:**
- RF is upstream, Strat is downstream
- Some Strats have a "UI Direction" section (or similar UI-focused heading) that's useful for prototyping — not all have it
- Eval-extract currently pulls the Strat; should also attempt to find and link the parent RF
- Future: programmatically detect and extract just the UI-focused section from Strats when present (check if the heading exists first)
- Not a token optimization yet — just about finding the right data for context

---

## E. Prototype Hosting and Sharing

**Problem:** "Sharing in general has been an issue for our team for a while... we can use cloud and cursor and generate artifacts and HTML prototypes locally but as soon as we need to share with other people to view very easily, that's weirdly tricky."

**What's needed:**
- Prototypes currently run on localhost — not shareable
- GitLab Pages works for static reports but not for interactive prototypes
- PC7 cluster could host running prototypes (containerized)
- Need a way to link from the eval report directly to a live, shareable prototype (not localhost)

**Possible approaches:**
- Containerize prototypes and deploy to PC7 cluster with clean URLs
- Use a simple static export for HTML-only prototypes
- Integrate with the eval dashboard — each eval entry links to both the report AND the live prototype
- Bo's analytics setup on PC7 is a reference implementation

---

## F. Report UI Refinement (Ongoing)

**From meeting:** "Minimizing the amount of words or information on the initial screen, just showing the overview stuff, and having the user click on something before showing the stuff on the right hand side for details."

**Already done:**
- Narrative summary added (what this is / what passed / what needs attention / what to do)
- Header details banner removed (less noise)
- Inline expand on findings (click for details)
- X-ray vs Blind mode labels on findings

**Still to explore:**
- Right panel should require a click to populate (not auto-shown)
- Error states and human review items should be the most prominent elements
- Consider Decision Kit's flow as inspiration for guiding users through findings
