#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const artifactsDir = process.argv[2];
if (!artifactsDir) {
  console.error('Usage: node generate-thinkaloud-md.js <artifacts-dir>');
  console.error('  Reads persona-results.json, writes usability-thinkaloud-*.md files');
  process.exit(1);
}

const abs = path.resolve(artifactsDir);
const prPath = path.join(abs, 'persona-results.json');

if (!fs.existsSync(prPath)) {
  console.error('persona-results.json not found in ' + abs);
  process.exit(1);
}

const personaResults = JSON.parse(fs.readFileSync(prPath, 'utf8'));

if (!Array.isArray(personaResults) || personaResults.length === 0) {
  console.error('persona-results.json is empty or not an array');
  process.exit(1);
}

let filesWritten = 0;

for (const entry of personaResults) {
  const personaId = entry.persona || entry.personaId;
  const personaName = entry.persona_name || personaId;
  const taskIndex = entry.task_index || 1;
  const taskDesc = entry.task || 'Unknown task';
  const trace = entry.trace || [];
  const outcome = entry.outcome || (entry.would_complete ? 'Completed' : 'Abandoned');
  const finalPatience = entry.patience_end != null ? entry.patience_end : 100;

  const confusionCount = typeof entry.confusion_events === 'number'
    ? entry.confusion_events
    : Array.isArray(entry.confusion_events)
      ? entry.confusion_events.length
      : 0;

  if (!personaId) continue;

  const lines = [];
  lines.push(`# Think-Aloud Trace: ${personaName}`);
  lines.push(`## Task: ${taskDesc}`);
  lines.push('');

  for (const step of trace) {
    const stepNum = step.step || 0;
    const title = step.action || step.title || 'Navigation';
    const whatISee = step.what_i_see || '';
    const whatImThinking = step.what_im_thinking || '';
    const action = step.action || '';
    const confidence = step.confidence || 'medium';
    const patience = step.patience != null ? step.patience : 100;

    // Format A: "### STEP N — Title" — matches parseTaSteps regex
    lines.push(`### STEP ${stepNum} — ${title}`);
    lines.push('');
    lines.push(`- **What I see:** ${whatISee}`);
    lines.push(`- **What I'm thinking:** ${whatImThinking}`);
    lines.push(`- **What I'll try:** ${action}`);
    lines.push(`- **Confidence:** ${confidence}`);
    lines.push(`- **Patience:** ${patience}%`);

    // Confusion event blockquote (parseTaSteps looks for "> **Confusion** —")
    if (step.confusion_event) {
      const confusionText = typeof step.confusion_event === 'string'
        ? step.confusion_event
        : (step.confusion_trigger || step.trigger || 'Encountered unfamiliar element');
      lines.push('');
      lines.push(`> **Confusion** — ${confusionText}`);
    }

    // Expected vs Actual blockquote (parseTaSteps looks for "> **Expected vs Actual** —")
    if (Array.isArray(step.evidence_for_acs) && step.evidence_for_acs.length > 0) {
      if (step.expected && step.actual) {
        lines.push('');
        lines.push(`> **Expected vs Actual** — Expected: ${step.expected}. Actual: ${step.actual}.`);
      }
    }

    // Missing feedback blockquote (parseTaSteps looks for "> **Missing feedback** —")
    if (step.missing_feedback) {
      lines.push('');
      lines.push(`> **Missing feedback** — ${step.missing_feedback}`);
    }

    lines.push('');
  }

  lines.push('NAVIGATION COMPLETE:');
  lines.push(`- Outcome: ${outcome}`);
  lines.push(`- Final patience: ${finalPatience}%`);
  lines.push(`- Confusion events: ${confusionCount}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  const keyInsight = entry.key_insight || entry.narration_summary || '';
  if (keyInsight) {
    lines.push(`Key insight: ${keyInsight}`);
  } else {
    lines.push(`Key insight: ${personaName} ${outcome === 'Completed' || outcome === 'completed' ? 'completed' : 'abandoned'} the task with ${confusionCount} confusion event(s) and ${finalPatience}% patience remaining.`);
  }
  lines.push('');

  const filename = `usability-thinkaloud-${personaId}-task-${taskIndex}.md`;
  const outPath = path.join(abs, filename);
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  filesWritten++;
  console.log(`  wrote ${filename}`);
}

console.log(`\n✓ Generated ${filesWritten} think-aloud file(s)`);
