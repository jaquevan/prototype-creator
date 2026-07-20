#!/usr/bin/env node
// NOTE: This duplicates buildSummaryJson() in render-report.js.
// Keep both in sync. Used by eval-iterate --no-report path (standalone, no HTML generation).
'use strict';

const fs = require('fs');
const path = require('path');

const artifactsDir = process.argv[2];
if (!artifactsDir) {
  console.error('Usage: node build-summary.js <artifacts-dir>');
  console.error('  Writes evaluation-summary.json from CSV + journey-log artifacts.');
  process.exit(1);
}

const absDir = path.resolve(artifactsDir);

function readFileOr(fp, fallback) {
  try { return fs.readFileSync(fp, 'utf8'); } catch { return fallback; }
}

function readJsonOr(fp, fallback) {
  const raw = readFileOr(fp, null);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current); current = ''; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCsv(raw) {
  if (!raw) return [];
  const lines = raw.trim().split('\n');
  const rows = [];
  let headers = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!headers) { headers = parseCSVLine(trimmed); continue; }
    const vals = parseCSVLine(trimmed);
    if (vals.length < headers.length) continue;
    const row = {};
    for (let i = 0; i < headers.length; i++) row[headers[i]] = vals[i] || '';
    rows.push(row);
  }
  return rows;
}

function normalizeUsabilityDimensions(ud) {
  if (!ud) return ud;
  if (!ud.personas_evaluated && ud.persona_selection && ud.persona_selection.selected) {
    ud.personas_evaluated = ud.persona_selection.selected;
  }
  if (ud.dimensions && Array.isArray(ud.dimensions)) {
    for (const dim of ud.dimensions) {
      if (dim.persona_scores && !dim.scores) dim.scores = dim.persona_scores;
      if (dim.scores && !dim.persona_scores) dim.persona_scores = dim.scores;
    }
  }
  return ud;
}

const protoId = path.basename(absDir);
const csvRaw = readFileOr(path.join(absDir, 'evaluation-report.csv'), '');
const journeyLog = readJsonOr(path.join(absDir, 'journey-log.json'), null);
const iterationLog = readJsonOr(path.join(absDir, 'iteration-log.json'), null);
const suggestions = readJsonOr(path.join(absDir, 'refinement-suggestions.json'), []);
const ud = journeyLog ? normalizeUsabilityDimensions(journeyLog.usability_dimensions) : null;
const csvRows = parseCsv(csvRaw);

let passCount = 0, failCount = 0, flaggedCount = 0;
for (const r of csvRows) {
  const v = (r.verdict || '').toUpperCase();
  if (v === 'PASS') passCount++;
  else if (v === 'FAIL') failCount++;
  else if (v === 'FLAGGED') flaggedCount++;
}
const total = passCount + failCount + flaggedCount;

let status = 'needs-attention';
if (total > 0 && failCount === 0 && flaggedCount === 0) status = 'pass';
else if (failCount > 0) status = 'fail';

const acVerdicts = csvRows.map(r => ({
  id: r.criterion_id || '',
  text: r.criterion_text || '',
  verdict: (r.verdict || '').toUpperCase(),
  tier: r.tier || '',
  rationale: r.rationale || '',
}));

const usability = {};
if (ud) {
  usability.overall_score = ud.overall_score || null;
  usability.personas_evaluated = ud.personas_evaluated || [];
  usability.dimensions = (ud.dimensions || []).map(d => ({
    id: d.id,
    name: d.name,
    composite_score: d.composite_score,
    persona_scores: d.persona_scores || d.scores || {},
  }));
}

const pendingSuggestions = Array.isArray(suggestions)
  ? suggestions.filter(s => !s.applied).length
  : 0;

const iteration = {};
if (iterationLog) {
  iteration.current = (iterationLog.iterations || []).length;
  iteration.max = iterationLog.max_iterations || null;
  iteration.exit_reason = iterationLog.exit_reason || null;
}

const summary = {
  key: protoId,
  timestamp: (journeyLog && journeyLog.evaluated_at) || new Date().toISOString(),
  status,
  ac_verdicts: acVerdicts,
  counts: { pass: passCount, fail: failCount, flagged: flaggedCount, total },
  usability: Object.keys(usability).length ? usability : null,
  suggestions_pending: pendingSuggestions,
  iteration: Object.keys(iteration).length ? iteration : null,
};

const outPath = path.join(absDir, 'evaluation-summary.json');
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
console.log(`✓ Summary written to ${outPath}`);
console.log(`  ${passCount} PASS, ${failCount} FAIL, ${flaggedCount} FLAGGED (${total} total)`);
if (usability.overall_score) console.log(`  Usability: ${usability.overall_score}`);
