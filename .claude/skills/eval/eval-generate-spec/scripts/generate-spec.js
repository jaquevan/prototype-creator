#!/usr/bin/env node
'use strict';

/**
 * generate-spec.js
 *
 * Assembles .artifacts/<KEY>/spec.md — the step-by-step UI requirements
 * artifact Yoni's post-engineering workflow validator consumes, per the
 * 2026-07-15 aligned decision ("Evaluator skill output is standardized to
 * include a spec file containing step-by-step UI requirements").
 *
 * Deliberately reuses artifacts the pipeline already produces — this is
 * assembly, not new data collection:
 *   - extract-state.json      (ac_list, journey_definitions, tasks_to_be_done)
 *   - component-map.json      (ac_element_mapping — optional, adds "what to check")
 *   - evaluation-report.csv   (verdicts — SOURCE OF TRUTH per the Visual Truth Rule)
 *   - journey-log.json        (Phase A steps + screenshot evidence)
 *   - persona-results.json   (Phase B persona task steps — only if it ran)
 *
 * Behavior-first, not selector-first: Yoni's team told Yahav (2026-07-15
 * meeting) their root-cause-analysis agent absorbs drift when the live
 * app's selectors differ from what a prototype used. So steps are written
 * as plain-language actions ("Click the Deploy button"), not raw CSS
 * selectors — those are cited as supplementary evidence only.
 *
 * Idempotent / additive: run after eval-verify (Phase A) for an AC-only
 * spec, and again after eval-discover (Phase B) to enrich it with
 * persona-validated task flows. Safe to re-run at either point — it always
 * regenerates from current artifacts rather than appending to a stale file.
 *
 * Usage:
 *   node generate-spec.js <artifacts-dir> [--phase=core|enrichment]
 */

const fs = require('fs');
const path = require('path');

const artifactsDir = process.argv[2];
const phaseArg = (process.argv.find(a => a.startsWith('--phase=')) || '--phase=core').split('=')[1];

if (!artifactsDir) {
  console.error('Usage: node generate-spec.js <artifacts-dir> [--phase=core|enrichment]');
  process.exit(1);
}

const abs = path.resolve(artifactsDir);
const p = (name) => path.join(abs, name);

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`WARNING: failed to parse ${filePath}: ${e.message}`);
    return null;
  }
}

// ── CSV parsing (Section 1 only) — mirrors scripts/list-failing-acs.js ──

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current); current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function readAcVerdicts(csvPath) {
  if (!fs.existsSync(csvPath)) return {};
  const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
  let headerIdx = lines.findIndex(l => /^criterion_id/i.test(l));
  if (headerIdx === -1) return {};
  const header = parseCsvLine(lines[headerIdx]);
  const idCol = header.findIndex(h => /^criterion_id$/i.test(h.trim()));
  const verdictCol = header.findIndex(h => /^verdict$/i.test(h.trim()));
  const rationaleCol = header.findIndex(h => /^rationale$/i.test(h.trim()));
  const evidenceCol = header.findIndex(h => /^evidence$/i.test(h.trim()));
  const textCol = header.findIndex(h => /^criterion_text$/i.test(h.trim()));

  const out = {};
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^#\s*SECTION/i.test(line) || /^dimension_id/i.test(line)) break;
    const fields = parseCsvLine(line);
    const id = (fields[idCol] || '').trim();
    if (!id) continue;
    out[id] = {
      verdict: (fields[verdictCol] || '').trim().toUpperCase(),
      rationale: (fields[rationaleCol] || '').trim(),
      evidence: (fields[evidenceCol] || '').trim(),
      criterion_text: (fields[textCol] || '').trim(),
    };
  }
  return out;
}

// ── Step rendering ──────────────────────────────────────────────────────

function renderJourneyStep(step) {
  // Plain-language over raw selector — Yoni's root-cause-analysis agent
  // absorbs selector drift; behavior description is the durable artifact.
  const action = (step.action || 'interact_with').toLowerCase();
  const target = step.target || 'the page';
  const verbs = {
    navigate: `Navigate to ${target}`,
    click: `Click ${target}`,
    hover: `Hover over ${target}`,
    fill: `Fill in ${target}`,
    verify: `Verify ${target}`,
    select: `Select ${target}`,
    expand: `Expand ${target}`,
    expand_row: `Expand the ${target}`,
  };
  if (verbs[action]) return verbs[action];
  if (action.startsWith('verify')) return `Verify ${target}`;
  if (action.startsWith('expand')) return `Expand the ${target}`;
  return `${action.replace(/_/g, ' ')} ${target}`;
}

// Screenshot-only steps are evidence capture, not user actions — they get
// counted toward "Verified" evidence but don't clutter the Steps list.
const isEvidenceOnlyStep = (step) => (step.action || '').toLowerCase() === 'screenshot';

function findJourneysForAc(journeyLog, acId) {
  if (!journeyLog || !journeyLog.journeys) return [];
  return journeyLog.journeys.filter(j => (j.ac_ids || []).includes(acId));
}

function findElementMapping(componentMap, acId) {
  if (!componentMap || !componentMap.ac_element_mapping) return null;
  return componentMap.ac_element_mapping[acId] || null;
}

// ── Section builders ────────────────────────────────────────────────────

function buildAcSection(extractState, csvVerdicts, journeyLog, componentMap) {
  const acList = (extractState && extractState.ac_list) || [];
  if (acList.length === 0) return { md: '', verified: 0, total: 0 };

  const verified = [];
  const notVerified = [];
  const needsJudgment = [];

  for (const ac of acList) {
    const id = ac.criterion_id;
    const csvRow = csvVerdicts[id] || {};
    const verdict = csvRow.verdict || 'UNKNOWN';
    const journeys = findJourneysForAc(journeyLog, id);

    if (verdict === 'PASS' && journeys.length > 0) {
      verified.push({ ac, csvRow, journeys });
    } else if (verdict === 'FLAGGED') {
      needsJudgment.push({ ac, csvRow });
    } else {
      notVerified.push({ ac, csvRow, verdict });
    }
  }

  let md = '## Acceptance Criteria — Playwright-Verified\n\n';
  md += '> Only criteria with a PASS verdict AND recorded Playwright evidence are listed here as verified. ';
  md += 'Steps describe UI behavior, not raw selectors — selectors are cited as supplementary evidence only, ';
  md += 'since a live implementation may not share the prototype\'s DOM structure.\n\n';

  if (verified.length === 0) {
    md += '_No criteria are both PASS and Playwright-verified yet. Run `eval-verify` before regenerating this file._\n\n';
  }

  for (const { ac, journeys } of verified) {
    md += `### ${ac.criterion_id} — ${ac.text}\n\n`;
    md += `**Status:** PASS (Playwright-verified)\n\n`;

    const mapping = findElementMapping(componentMap, ac.criterion_id);
    md += '**Steps:**\n\n';
    let stepNum = 1;
    for (const journey of journeys) {
      for (const step of (journey.steps || [])) {
        if (isEvidenceOnlyStep(step)) continue;
        md += `${stepNum}. ${renderJourneyStep(step)}\n`;
        stepNum++;
      }
    }
    if (mapping) {
      md += `\n**What to check:** ${mapping.description || mapping.interaction_type} `;
      md += `(supplementary selector on the prototype: \`${mapping.selector}\` — expect the live implementation to differ; treat as a hint, not a requirement)\n`;
    }

    const evidencePaths = journeys
      .flatMap(j => (j.steps || []).map(s => s.screenshot))
      .filter(Boolean);
    md += `\n**Verified:** ${evidencePaths.length} screenshot(s) recorded`;
    if (evidencePaths.length) md += ` (e.g. \`${evidencePaths[0]}\`)`;
    md += '.\n\n';
  }

  if (needsJudgment.length > 0) {
    md += '## Acceptance Criteria — Needs Human Judgment\n\n';
    md += '_These criteria are subjective (Tier T4) — flagged for a designer, not proven by Playwright. Do not treat as machine-verified._\n\n';
    for (const { ac, csvRow } of needsJudgment) {
      md += `- **${ac.criterion_id}** — ${ac.text}${csvRow.rationale ? ` _(${csvRow.rationale})_` : ''}\n`;
    }
    md += '\n';
  }

  if (notVerified.length > 0) {
    md += '## Acceptance Criteria — Not Yet Verified\n\n';
    md += '_Do not build test cases from these — they have not passed Playwright verification. Listed for completeness only._\n\n';
    for (const { ac, verdict } of notVerified) {
      md += `- **${ac.criterion_id}** — ${ac.text} _(current verdict: ${verdict})_\n`;
    }
    md += '\n';
  }

  return { md, verified: verified.length, total: acList.length };
}

function buildPersonaSection(extractState, personaResults) {
  if (!personaResults || !Array.isArray(personaResults) || personaResults.length === 0) {
    return { md: '', taskCount: 0 };
  }

  const tasksById = {};
  for (const t of ((extractState && extractState.tasks_to_be_done) || [])) {
    tasksById[t.task] = t;
  }

  let md = '## Persona-Validated Task Flows\n\n';
  md += '> Step sequences below come from live per-persona Playwright walkthroughs (Phase B), not inference. ';
  md += 'Each task ran independently per persona — divergent step counts across personas are expected and meaningful ';
  md += '(e.g. a junior persona takes more exploratory steps than a senior one for the same goal).\n\n';

  // Group by task_index so multiple personas doing the same task render together.
  const byTask = {};
  for (const entry of personaResults) {
    const key = entry.task_index != null ? entry.task_index : entry.task;
    if (!byTask[key]) byTask[key] = [];
    byTask[key].push(entry);
  }

  for (const [taskKey, entries] of Object.entries(byTask)) {
    const taskText = entries[0].task || `Task ${taskKey}`;
    const coveredAcs = (tasksById[taskText] && tasksById[taskText].covers_acs) || [];
    md += `### Task: ${taskText}\n\n`;
    if (coveredAcs.length) md += `**Covers:** ${coveredAcs.join(', ')}\n\n`;

    for (const entry of entries) {
      md += `**Persona:** ${entry.persona_name || entry.persona} — outcome: ${entry.outcome || 'unknown'}`;
      md += entry.would_complete === false ? ' (did not complete)' : '';
      md += '\n\n';
      let n = 1;
      for (const step of (entry.trace || [])) {
        md += `${n}. ${step.action || step.what_i_see || 'observe the page'}\n`;
        n++;
      }
      md += '\n';
    }
  }

  return { md, taskCount: Object.keys(byTask).length };
}

// ── Main ─────────────────────────────────────────────────────────────────

const extractState = readJsonIfExists(p('extract-state.json'));
const componentMap = readJsonIfExists(p('component-map.json'));
const journeyLog = readJsonIfExists(p('journey-log.json'));
const personaResults = readJsonIfExists(p('persona-results.json'));
const csvVerdicts = readAcVerdicts(p('evaluation-report.csv'));

if (!extractState) {
  console.error('FATAL: extract-state.json not found — run eval-extract first.');
  process.exit(1);
}

const key = extractState.key || path.basename(abs);
const title = extractState.title || '';

let md = `# Spec: ${key}${title ? ' — ' + title : ''}\n\n`;
md += `_Generated by \`eval-generate-spec\` (${phaseArg} phase) from prototype-creator eval artifacts. `;
md += `Step-by-step UI requirements for post-engineering validation — behavior over selectors, per the 2026-07-15 alignment with Yoni's workflow validator team._\n\n`;
md += `**Source ticket:** ${key}\n\n`;
md += '---\n\n';

const acSection = buildAcSection(extractState, csvVerdicts, journeyLog, componentMap);
md += acSection.md;

const personaSection = buildPersonaSection(extractState, personaResults);
if (personaSection.md) {
  md += '---\n\n';
  md += personaSection.md;
} else if (phaseArg === 'enrichment') {
  console.error('WARNING: --phase=enrichment requested but persona-results.json is missing or empty. '
    + 'spec.md will only contain the Phase A AC section. Run eval-discover first for full enrichment.');
}

const outPath = p('spec.md');
fs.writeFileSync(outPath, md);

console.log(`[generate-spec] wrote ${outPath}`);
console.log(`[generate-spec] AC section: ${acSection.verified}/${acSection.total} criteria Playwright-verified`);
console.log(`[generate-spec] Persona section: ${personaSection.taskCount} task(s)${personaSection.taskCount ? '' : ' (none — Phase B not yet run or --phase=core)'}`);
