# eval-amplitude — Investigation Findings

Spike for [RHOAIUX-2788](https://redhat.atlassian.net/browse/RHOAIUX-2788) — "Investigate Amplitude journey maps as input for Playwright test generation." Source: Evan/Yahav chat, 2026-07-02.

**Bottom line up front:** Funnels are usable today via a documented API, given credentials. Journeys (the actual chart Yahav demoed) have no documented direct-export path. The sample size in the current Amplitude project (~4 external participants) is too small to trust regardless of API access. Recommend: **don't block the spec-file work (see `../eval-generate-spec/`) on this** — ship that now, revisit Amplitude once participant volume grows and access is granted.

## API capability matrix

| Amplitude feature | Direct REST export? | Endpoint | Notes |
|---|---|---|---|
| **Funnels** | **Yes** | `GET /api/2/funnels` | Ordered/unordered/sequential event list, returns step counts + drop-off. Works with an API key/secret pair alone — no MCP, no chart-saving required. |
| **Journeys** (Pathfinder / Journey Map) | **No** | — | Not part of the documented Dashboard REST API. The Dashboard REST API's "export data tables" capability only covers the "Data Table" chart type — Journey Map is a different visualization type and isn't covered. |
| **Export API** (raw events) | Yes (fallback) | `GET /api/2/export` | Returns raw event stream for a time range (zipped JSON, 2-hour data-availability delay, 4GB per-request cap). Journeys/funnels could be reconstructed client-side (group by `user_id`, sort by `event_time`) — more engineering work, but doesn't depend on whichever chart types Amplitude decides to expose. |

Sources: `amplitude.com/docs/apis/analytics/dashboard-rest`, `amplitude.com/docs/apis/analytics/export`, `amplitude.com/docs/analytics/charts/journeys/journeys-understand-visualizations` (fetched 2026-07-20).

## Why "save the chart to a report first" (Yahav's suggested workaround) probably doesn't fully solve this

Yahav's suggestion in the 2026-07-02 meeting was: save the Amplitude chart, add it to a report, then have an agent pull from the report. The Dashboard REST API documentation says exports from a saved report are scoped to **Data Table** chart types. Journey Map is not a Data Table chart — so saving it to a report doesn't change its export eligibility. This matches Yahav's own caution in the meeting ("I don't totally know if the MCP server pulls those in") — the skepticism was warranted.

**What would actually work for Journeys specifically:** either (a) manually export/screenshot the Journey Map for a human to transcribe (defeats the "agents generate this automatically" goal), or (b) reconstruct paths from the raw Export API, which is real engineering work (session-boundary detection, path frequency counting) — not a quick MCP pull regardless of whether the plugin is installed.

## Blocker: no Amplitude MCP plugin is installed here

Checked the full MCP tool catalog (`GetMcpTools` with pattern `amplitude` — zero matches) and `~/.cursor/plugins/cache` (no Amplitude entry) as of 2026-07-20. Two separate blockers:

1. **Access** — "Request Amplitude access from Yahav" has been an open action item since the 2026-06-30 midpoint check-in. Still open.
2. **Plugin install** — even with access, the Amplitude Cursor plugin (Yahav: "it's a plugin in Cursor... just the amplitude plugin") needs to be added via Cursor's plugin/MCP settings before any `mcp__amplitude__*` tool call can be tested. Not attempted in this pass since access wasn't confirmed first.

`scripts/amplitude-funnel-probe.py` sidesteps the plugin question entirely by hitting the documented REST endpoint directly with an API key — this only needs (1), not (2). Ran it without credentials to confirm the failure mode is a clear, actionable error rather than a silent hang (see script — exits 1 with a message pointing at this README).

## Mapping strategy (schema — see `scripts/journey-to-extract.py`)

Amplitude data maps onto the eval pipeline's two Amplitude-relevant fields without requiring schema changes downstream:

| Amplitude concept | Maps to | Eval pipeline consumer |
|---|---|---|
| Event sequence in a unique path | `journey_definitions[].expected_path` steps | `eval-verify` / `scripts/generate-journey-script.js` (Phase A) |
| Funnel step-to-step drop-off | `risk_weight` hint per task/route | `eval-discover` Step 1c-routes (Phase B) — spend more persona-walkthrough budget on transitions where real users struggle |
| Event name (free text) | `action` type (navigate/click/verify) | Heuristic classification — see caveat below |

**Ran the transform against the mocked sample** (`python3 scripts/journey-to-extract.py samples/sample-journey-funnel.json`): produces 2 `journey_definitions` entries and a 2-entry `risk_weights` list. One path is auto-flagged `needs_human_review: true` because it's a non-converting funnel path that's actually just a refresh loop (repeated `page viewed` with no intermediate action) — not a real "struggle" signal. This is exactly the ambiguity Yahav flagged in the meeting: *"the issue with amplitude is there's no built-in logic... what does it mean to struggle to do something?"* The event-name → action-type classification is a lossy heuristic (event names are free text, not a controlled vocabulary) — every mapped step carries a `confidence` field for this reason, and low-confidence steps should be reviewed by a human before being trusted as a test step, not treated as ground truth.

## Live probe results

Not run — no `AMPLITUDE_API_KEY` available in this environment. `scripts/amplitude-funnel-probe.py --events "..." --start YYYYMMDD --end YYYYMMDD` is ready to run once credentials exist; append the actual response shape here when that happens, and diff it against `samples/sample-journey-funnel.json`'s assumptions before trusting the transform script on real data.

## Recommendation

1. **Do not block `eval-generate-spec` (the sprint-committed spec-file work) on this.** It doesn't need Amplitude — see `../eval-generate-spec/SKILL.md`.
2. **Funnels are worth revisiting once participant volume grows.** The API access is straightforward; the blocker is data volume (4 external participants) and access, not technical feasibility.
3. **Journeys are not worth building against right now.** No documented direct export exists, and the workaround Yahav proposed (save to report) doesn't appear to cover this chart type based on the Dashboard REST API docs. If this needs re-litigating, the open question for Yahav is whether the Amplitude Cursor plugin's MCP tools expose something the REST API doesn't (untested here — plugin isn't installed).
4. **If/when this is revisited:** wire `journey-to-extract.py`'s output in as an *additional* seed for `eval-extract` Step 5 (`journey_definitions`) and Step 5b (`tasks_to_be_done`), ahead of or alongside the Outcome Scenario/Flow seed discussed in the plan — not as a replacement for AC-based inference, since Amplitude data has no AC or persona attribution of its own.

## Related

- [`../eval-generate-spec/`](../eval-generate-spec/) — the spec-file output for Yoni's workflow validator; ships independently of this spike's outcome.
- `future.md` (repo root) — "Spec File Output for Post-Engineering Workflow Validator" and "UX Acceptance Criteria Pipeline" backlog items.
- [Outcome Tiger Team](/Users/ejaquez/second-brain/wiki/outcome-tiger-team.md) — Outcome Creator's `Scenario`/`Flow` block as the pre-Amplitude, pre-usage "intent" seed for the same fields.
