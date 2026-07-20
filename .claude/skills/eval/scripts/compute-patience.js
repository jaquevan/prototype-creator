#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require ? null : null;

const artifactsDir = process.argv[2];
if (!artifactsDir) {
  console.error('Usage: node compute-patience.js <artifacts-dir>');
  console.error('  Applies deterministic patience formula to persona-results.json and journey-log.json');
  process.exit(1);
}

const abs = path.resolve(artifactsDir);
const prPath = path.join(abs, 'persona-results.json');
const jlPath = path.join(abs, 'journey-log.json');

if (!fs.existsSync(prPath)) { console.error('persona-results.json not found'); process.exit(1); }

const personaResults = JSON.parse(fs.readFileSync(prPath, 'utf8'));

const drainRates = {
  high: { confusion: -5, dead_end: -10, recovery: 10 },
  medium: { confusion: -10, dead_end: -20, recovery: 5 },
  low: { confusion: -15, dead_end: -30, recovery: 5 },
};

function getPersonaPatience(personaId) {
  const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const personaDir = path.join(projectRoot, '.context', 'usability-testing', 'personas');
  const yamlPath = path.join(personaDir, personaId + '.yaml');

  if (!fs.existsSync(yamlPath)) return 'medium';

  const raw = fs.readFileSync(yamlPath, 'utf8');
  const match = raw.match(/^\s+patience:\s*(\w+)/m);
  return match ? match[1].trim().toLowerCase() : 'medium';
}

let totalUpdates = 0;

for (const entry of personaResults) {
  const pid = entry.persona || entry.personaId;
  if (!pid) continue;

  const patienceLevel = getPersonaPatience(pid);
  const rates = drainRates[patienceLevel] || drainRates.medium;

  const confusionCount = typeof entry.confusion_events === 'number'
    ? entry.confusion_events
    : Array.isArray(entry.confusion_events)
      ? entry.confusion_events.length
      : 0;

  const deadEnds = entry.dead_ends || 0;
  const recoveries = entry.recoveries || 0;

  const drain = (confusionCount * rates.confusion) + (deadEnds * rates.dead_end);
  const recovery = recoveries * rates.recovery;
  const computed = Math.max(0, Math.min(100, 100 + drain + recovery));

  if (entry.patience_end !== computed) {
    const old = entry.patience_end;
    entry.patience_end = computed;
    totalUpdates++;
    console.log(`  ${pid} task ${entry.task_index || '?'}: ${old}% → ${computed}% (${confusionCount} confusion × ${rates.confusion}, ${patienceLevel} patience)`);
  }

  // Also update per-step patience in trace if present
  if (Array.isArray(entry.trace) && entry.trace.length > 0) {
    let stepPatience = 100;
    for (const step of entry.trace) {
      const stepConfusion = step.confusion_event ? 1 : (step.confusion ? 1 : 0);
      const stepDead = step.dead_end ? 1 : 0;
      const stepRecovery = step.recovery ? 1 : 0;

      stepPatience += (stepConfusion * rates.confusion) + (stepDead * rates.dead_end) + (stepRecovery * rates.recovery);
      stepPatience = Math.max(0, Math.min(100, stepPatience));
      step.patience = stepPatience;
    }
  }
}

fs.writeFileSync(prPath, JSON.stringify(personaResults, null, 2), 'utf8');

// Update journey-log.json if it exists
if (fs.existsSync(jlPath)) {
  const jl = JSON.parse(fs.readFileSync(jlPath, 'utf8'));
  const ud = jl.usability_dimensions;

  if (ud) {
    // Update persona_overlays
    if (Array.isArray(ud.persona_overlays)) {
      for (const overlay of ud.persona_overlays) {
        const matching = personaResults.find(r =>
          (r.persona === overlay.persona || r.personaId === overlay.persona) &&
          (r.task_index === overlay.task_index)
        );
        if (matching) {
          overlay.patience_end = matching.patience_end;
        }
      }
    }

    // Update think_aloud.traces
    if (ud.think_aloud && Array.isArray(ud.think_aloud.traces)) {
      for (const trace of ud.think_aloud.traces) {
        const matching = personaResults.find(r =>
          (r.persona === trace.persona || r.personaId === trace.persona) &&
          (r.task_index === trace.task_index)
        );
        if (matching) {
          trace.patience_end = matching.patience_end;
        }
      }
    }
  }

  fs.writeFileSync(jlPath, JSON.stringify(jl, null, 2), 'utf8');
}

console.log(`✓ Patience computation complete: ${totalUpdates} value(s) updated`);
