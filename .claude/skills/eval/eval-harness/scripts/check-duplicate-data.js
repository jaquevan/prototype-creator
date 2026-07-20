#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const artifactsDir = process.argv[2];
if (!artifactsDir) {
  console.error('Usage: node check-duplicate-data.js <artifacts-dir>');
  console.error('  Detects duplicate entries across pipeline artifacts.');
  process.exit(1);
}

const abs = path.resolve(artifactsDir);
if (!fs.existsSync(abs)) {
  console.error(`FAIL: directory not found: ${abs}`);
  process.exit(1);
}

let duplicates = 0;
let checksRun = 0;

function tryReadJSON(filename) {
  const fp = path.join(abs, filename);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function findDuplicates(items, keyFn, label) {
  checksRun++;
  const seen = new Map();
  const dupes = [];

  for (let i = 0; i < items.length; i++) {
    const key = keyFn(items[i], i);
    if (key === null) continue;
    if (seen.has(key)) {
      dupes.push({ key, firstIndex: seen.get(key), dupeIndex: i });
    } else {
      seen.set(key, i);
    }
  }

  if (dupes.length === 0) {
    console.log(`PASS: ${label} — ${seen.size} unique entries, no duplicates`);
  } else {
    console.log(`FAIL: ${label} — ${dupes.length} duplicate(s) found:`);
    for (const d of dupes) {
      console.log(`      key="${d.key}" at indices ${d.firstIndex} and ${d.dupeIndex}`);
    }
    duplicates += dupes.length;
  }
}

// --- Check 1: journey-log.json journey IDs ---
const journeyLog = tryReadJSON('journey-log.json');
if (journeyLog && Array.isArray(journeyLog.journeys)) {
  findDuplicates(
    journeyLog.journeys,
    (j) => j.id || null,
    'journey-log.json: journey IDs unique'
  );
} else {
  console.log('SKIP: journey-log.json not found or has no journeys array');
}

// --- Check 2: journey-log.json persona_overlays unique by (persona, task_index) ---
const overlays = journeyLog
  && journeyLog.usability_dimensions
  && Array.isArray(journeyLog.usability_dimensions.persona_overlays)
  ? journeyLog.usability_dimensions.persona_overlays
  : null;

if (overlays) {
  findDuplicates(
    overlays,
    (o) => `${o.persona}|${o.task_index}`,
    'journey-log.json: persona_overlays unique by (persona, task_index)'
  );
} else {
  console.log('SKIP: journey-log.json persona_overlays not found');
}

// --- Check 3: journey-log.json think_aloud.traces unique by (persona, task_index) ---
const traces = journeyLog
  && journeyLog.usability_dimensions
  && journeyLog.usability_dimensions.think_aloud
  && Array.isArray(journeyLog.usability_dimensions.think_aloud.traces)
  ? journeyLog.usability_dimensions.think_aloud.traces
  : null;

if (traces) {
  findDuplicates(
    traces,
    (t) => `${t.persona}|${t.task_index}`,
    'journey-log.json: think_aloud.traces unique by (persona, task_index)'
  );
} else {
  console.log('SKIP: journey-log.json think_aloud.traces not found');
}

// --- Check 4: persona-results.json unique by (persona, task_index) ---
let personaResults = tryReadJSON('persona-results.json');
// Tolerate the {evaluated_at, personas: [...]} nested shape seen in some
// older eval-discover runs, in addition to the canonical flat array.
if (personaResults && !Array.isArray(personaResults) && Array.isArray(personaResults.personas)) {
  personaResults = personaResults.personas;
}
if (Array.isArray(personaResults)) {
  findDuplicates(
    personaResults,
    // Canonical field names are "persona"/"task_index" (SKILL.md Step 6),
    // but "persona_id"/"task_idx" have shown up in historical runs — accept both.
    (r) => `${r.persona || r.persona_id}|${r.task_index != null ? r.task_index : r.task_idx}`,
    'persona-results.json: entries unique by (persona, task_index)'
  );
} else {
  console.log('SKIP: persona-results.json not found or not an array');
}

// --- Check 5: evaluation-report.csv criterion_ids unique in Section 1 ---
const csvPath = path.join(abs, 'evaluation-report.csv');
if (fs.existsSync(csvPath)) {
  checksRun++;
  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split('\n');

  const criterionIds = [];
  let inSection1 = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '# ACCEPTANCE CRITERIA') {
      inSection1 = true;
      continue;
    }
    if (trimmed === '# USABILITY DIMENSIONS') break;
    if (!inSection1) continue;
    if (trimmed.startsWith('criterion_id,')) continue;
    if (trimmed.length === 0) continue;

    const fields = parseCSVLine(trimmed);
    if (fields.length > 0 && fields[0].trim()) {
      criterionIds.push(fields[0].trim());
    }
  }

  const seen = new Map();
  const dupes = [];
  for (let i = 0; i < criterionIds.length; i++) {
    if (seen.has(criterionIds[i])) {
      dupes.push({ id: criterionIds[i], first: seen.get(criterionIds[i]), dupe: i });
    } else {
      seen.set(criterionIds[i], i);
    }
  }

  if (dupes.length === 0) {
    console.log(`PASS: evaluation-report.csv: Section 1 criterion_ids unique — ${criterionIds.length} criteria`);
  } else {
    console.log(`FAIL: evaluation-report.csv: Section 1 has ${dupes.length} duplicate criterion_id(s):`);
    for (const d of dupes) {
      console.log(`      "${d.id}" at rows ${d.first + 1} and ${d.dupe + 1}`);
    }
    duplicates += dupes.length;
  }
} else {
  console.log('SKIP: evaluation-report.csv not found');
}

// --- Check 6: iteration-log.json unique by (iteration, phase) ---
const iterLog = tryReadJSON('iteration-log.json');
if (iterLog && Array.isArray(iterLog.iterations)) {
  findDuplicates(
    iterLog.iterations,
    (it) => `${it.iteration}|${it.phase}`,
    'iteration-log.json: iterations unique by (iteration, phase)'
  );
} else {
  console.log('SKIP: iteration-log.json not found or has no iterations array');
}

console.log(`\n${'='.repeat(50)}`);
if (duplicates === 0) {
  console.log(`RESULT: ALL PASS — ${checksRun} checks run, no duplicates found`);
  process.exit(0);
} else {
  console.log(`RESULT: FAIL — ${duplicates} duplicate(s) found across ${checksRun} checks`);
  process.exit(1);
}

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}
