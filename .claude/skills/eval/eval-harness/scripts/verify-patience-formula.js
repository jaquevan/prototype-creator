#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const artifactsDir = process.argv[2];
if (!artifactsDir) {
  console.error('Usage: node verify-patience-formula.js <artifacts-dir>');
  console.error('  Reads persona-results.json and verifies patience values match the mechanical formula.');
  process.exit(1);
}

const abs = path.resolve(artifactsDir);
const prPath = path.join(abs, 'persona-results.json');

if (!fs.existsSync(prPath)) {
  console.error(`FAIL: persona-results.json not found at ${prPath}`);
  process.exit(1);
}

const personaResults = JSON.parse(fs.readFileSync(prPath, 'utf8'));

if (!Array.isArray(personaResults) || personaResults.length === 0) {
  console.error('FAIL: persona-results.json is empty or not an array');
  process.exit(1);
}

const DRAIN_RATES = {
  high:   { confusion: -5,  dead_end: -10, recovery: 10 },
  medium: { confusion: -10, dead_end: -20, recovery: 5 },
  low:    { confusion: -15, dead_end: -30, recovery: 5 },
};

function loadPersonaPatience(personaId) {
  const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const yamlPath = path.join(projectRoot, '.context', 'usability-testing', 'personas', personaId + '.yaml');

  if (!fs.existsSync(yamlPath)) return null;

  const raw = fs.readFileSync(yamlPath, 'utf8');
  const match = raw.match(/^\s+patience:\s*(\w+)/m);
  return match ? match[1].trim().toLowerCase() : null;
}

let mismatches = 0;
let checked = 0;

for (const entry of personaResults) {
  const pid = entry.persona || entry.personaId;
  const taskIdx = entry.task_index || '?';
  const label = `${pid} task ${taskIdx}`;

  if (!pid) {
    console.log(`SKIP: entry missing persona id`);
    continue;
  }

  const patienceLevel = loadPersonaPatience(pid);
  if (!patienceLevel) {
    console.log(`WARN: ${label} — persona YAML not found, cannot verify (skipped)`);
    continue;
  }

  const rates = DRAIN_RATES[patienceLevel];
  if (!rates) {
    console.log(`WARN: ${label} — unknown patience level "${patienceLevel}" (skipped)`);
    continue;
  }

  checked++;

  // --- Check 1: Recompute from summary counts ---
  const confusionCount = typeof entry.confusion_events === 'number'
    ? entry.confusion_events
    : Array.isArray(entry.confusion_events)
      ? entry.confusion_events.length
      : 0;
  const deadEnds = entry.dead_ends || 0;
  const recoveries = entry.recoveries || 0;

  const drain = (confusionCount * rates.confusion) + (deadEnds * rates.dead_end);
  const recovery = recoveries * rates.recovery;
  const computedFromSummary = Math.max(0, Math.min(100, 100 + drain + recovery));

  if (entry.patience_end !== computedFromSummary) {
    console.log(`FAIL: ${label} — stored patience_end=${entry.patience_end}, recomputed from summary counts=${computedFromSummary} (${confusionCount} confusion × ${rates.confusion}, ${deadEnds} dead_ends × ${rates.dead_end}, ${recoveries} recoveries × ${rates.recovery}, patience=${patienceLevel})`);
    mismatches++;
  } else {
    console.log(`PASS: ${label} — patience_end=${entry.patience_end} matches summary recompute (${patienceLevel} patience)`);
  }

  // --- Check 2: Walk trace steps and recompute ---
  if (Array.isArray(entry.trace) && entry.trace.length > 0) {
    let stepPatience = 100;
    let traceConfusions = 0;
    let traceDeadEnds = 0;
    let traceRecoveries = 0;
    let traceMismatch = false;

    for (const step of entry.trace) {
      const hasConfusion = step.confusion_event === true;
      const hasDeadEnd = step.dead_end === true;
      const hasRecovery = step.recovery === true;

      if (hasConfusion) traceConfusions++;
      if (hasDeadEnd) traceDeadEnds++;
      if (hasRecovery) traceRecoveries++;

      stepPatience += (hasConfusion ? rates.confusion : 0)
                    + (hasDeadEnd ? rates.dead_end : 0)
                    + (hasRecovery ? rates.recovery : 0);
      stepPatience = Math.max(0, Math.min(100, stepPatience));

      if (typeof step.patience === 'number' && step.patience !== stepPatience) {
        console.log(`FAIL: ${label} step ${step.step} — trace patience=${step.patience}, recomputed=${stepPatience}`);
        mismatches++;
        traceMismatch = true;
      }
    }

    if (!traceMismatch) {
      console.log(`PASS: ${label} — all ${entry.trace.length} trace steps have correct patience values`);
    }

    // Check that the final trace step's patience matches patience_end
    const lastStep = entry.trace[entry.trace.length - 1];
    if (typeof lastStep.patience === 'number' && lastStep.patience !== entry.patience_end) {
      console.log(`FAIL: ${label} — last trace step patience=${lastStep.patience} != patience_end=${entry.patience_end}`);
      mismatches++;
    }

    // Check trace event counts against summary fields
    if (confusionCount !== traceConfusions) {
      console.log(`FAIL: ${label} — summary confusion_events=${confusionCount} but trace has ${traceConfusions} confusion_event=true steps`);
      mismatches++;
    }
    if (deadEnds !== traceDeadEnds) {
      console.log(`FAIL: ${label} — summary dead_ends=${deadEnds} but trace has ${traceDeadEnds} dead_end=true steps`);
      mismatches++;
    }
    if (recoveries !== traceRecoveries) {
      console.log(`FAIL: ${label} — summary recoveries=${recoveries} but trace has ${traceRecoveries} recovery=true steps`);
      mismatches++;
    }
  }
}

console.log(`\n${'='.repeat(50)}`);
if (mismatches === 0) {
  console.log(`RESULT: ALL PASS — ${checked} entries verified, 0 mismatches`);
  process.exit(0);
} else {
  console.log(`RESULT: FAIL — ${mismatches} mismatch(es) found across ${checked} entries`);
  process.exit(1);
}
