#!/usr/bin/env node
/**
 * validate-pipeline-output.js
 * 
 * MLflow-compatible scorer that validates pipeline output artifacts have correct
 * schemas. Catches the three failure modes observed on RHAISTRAT-1433:
 * 
 * 1. usability_dimensions in journey-log.json must use the nested array schema
 *    (not flat dict) so render-report.js can consume it.
 * 2. consistency-report.json must exist with source_mode.ran=true.
 * 3. persona-results.json must have non-empty trace[] arrays and propagate
 *    to journey-log.json usability_dimensions.persona_overlays.
 * 
 * Usage:
 *   node validate-pipeline-output.js <artifacts-dir>
 * 
 * Exit codes:
 *   0 = all checks pass
 *   1 = one or more checks failed (details in stdout JSON)
 */

const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const artifactsDir = process.argv[2];
if (!artifactsDir) {
  console.error('Usage: node validate-pipeline-output.js <artifacts-dir>');
  process.exit(1);
}

const results = [];
let hasFailure = false;

function check(name, condition, detail) {
  const passed = !!condition;
  if (!passed) hasFailure = true;
  results.push({ scorer: name, pass: passed, detail });
}

function readJson(filename) {
  const p = join(artifactsDir, filename);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORER 1: Usability Dimensions Schema
// Ensures journey-log.json has the correct nested format for render-report.js
// ═══════════════════════════════════════════════════════════════════════════════

const journeyLog = readJson('journey-log.json');

check(
  'Journey Log Exists',
  journeyLog !== null,
  journeyLog ? 'journey-log.json loaded' : 'MISSING: journey-log.json not found'
);

if (journeyLog) {
  const ud = journeyLog.usability_dimensions;
  
  check(
    'Usability Dimensions Present',
    ud !== null && ud !== undefined,
    ud ? 'usability_dimensions key exists' : 'MISSING: usability_dimensions not in journey-log.json'
  );

  if (ud) {
    // Check it's NOT a flat dict (the broken format)
    const isFlatDict = ud.workflow_continuity !== undefined || ud.system_status_observability !== undefined;
    check(
      'Usability Not Flat Dict',
      !isFlatDict,
      isFlatDict ? 'SCHEMA ERROR: usability_dimensions is a flat dict (broken). Must have {overall_score, dimensions[], persona_overlays[]}' : 'Correct: not a flat dict'
    );

    check(
      'Usability Has overall_score',
      typeof ud.overall_score === 'number',
      typeof ud.overall_score === 'number' ? `overall_score = ${ud.overall_score}` : `MISSING: overall_score is ${typeof ud.overall_score}, expected number`
    );

    check(
      'Usability Has dimensions Array',
      Array.isArray(ud.dimensions) && ud.dimensions.length >= 7,
      Array.isArray(ud.dimensions) ? `${ud.dimensions.length} dimensions` : 'MISSING: dimensions is not an array'
    );

    check(
      'Usability Has personas_evaluated',
      Array.isArray(ud.personas_evaluated) && ud.personas_evaluated.length > 0,
      Array.isArray(ud.personas_evaluated) ? `personas: ${ud.personas_evaluated.join(', ')}` : 'MISSING: personas_evaluated is empty or not an array'
    );

    check(
      'Usability Has persona_overlays',
      Array.isArray(ud.persona_overlays) && ud.persona_overlays.length > 0,
      Array.isArray(ud.persona_overlays) ? `${ud.persona_overlays.length} overlays` : 'MISSING: persona_overlays is empty or not an array'
    );

    // Check dimension objects have required keys
    if (Array.isArray(ud.dimensions) && ud.dimensions.length > 0) {
      const dim0 = ud.dimensions[0];
      const reqKeys = ['id', 'name', 'composite_score'];
      const missingKeys = reqKeys.filter(k => !(k in dim0));
      check(
        'Dimension Objects Have Required Keys',
        missingKeys.length === 0,
        missingKeys.length === 0 ? `All required keys present: ${reqKeys.join(', ')}` : `MISSING keys in dimension[0]: ${missingKeys.join(', ')}`
      );
    }

    // Check persona_overlays have required keys
    if (Array.isArray(ud.persona_overlays) && ud.persona_overlays.length > 0) {
      const ov0 = ud.persona_overlays[0];
      const reqKeys = ['persona', 'task_index', 'patience_end', 'abandoned'];
      const missingKeys = reqKeys.filter(k => !(k in ov0));
      check(
        'Persona Overlay Objects Have Required Keys',
        missingKeys.length === 0,
        missingKeys.length === 0 ? `All required keys present: ${reqKeys.join(', ')}` : `MISSING keys in persona_overlays[0]: ${missingKeys.join(', ')}`
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORER 1b: Persona Selection Reasoning (SKILL.md Step 3b.1)
// Ensures persona_selection has full reasoning, not just auto-generated list
// ═══════════════════════════════════════════════════════════════════════════════

if (journeyLog) {
  const ps = journeyLog.persona_selection;

  check(
    'Persona Selection Present',
    ps !== null && ps !== undefined,
    ps ? 'persona_selection exists' : 'MISSING: persona_selection not in journey-log.json'
  );

  if (ps) {
    check(
      'Persona Selection Has Method',
      typeof ps.method === 'string',
      ps.method ? `method = ${ps.method}` : 'MISSING: persona_selection.method (should be "automatic" or "manual")'
    );

    check(
      'Persona Selection Has Target Audience Source',
      typeof ps.target_audience_source === 'string' && ps.target_audience_source.length > 10,
      ps.target_audience_source ? `source: "${ps.target_audience_source.slice(0, 60)}..."` : 'MISSING: persona_selection.target_audience_source — required by SKILL.md Step 3b.1'
    );

    check(
      'Persona Selection Has Considered-But-Rejected',
      Array.isArray(ps.considered_but_rejected),
      Array.isArray(ps.considered_but_rejected) ? `${ps.considered_but_rejected.length} rejected personas documented` : 'MISSING: persona_selection.considered_but_rejected — required by SKILL.md Step 3b.1. Even if empty, must be present as []'
    );

    check(
      'Persona Selection Reasoning Not Auto-Generated',
      typeof ps.reasoning === 'string' && ps.reasoning.length > 30 && !ps.reasoning.includes('auto-generated'),
      typeof ps.reasoning === 'string' && ps.reasoning.length > 30 ? 'Reasoning appears substantive' : 'WEAK: persona_selection.reasoning is too short or auto-generated — should explain WHY these personas, not just list them'
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORER 2: Consistency Report Present and Valid
// Ensures eval-consistency ran and produced usable output
// ═══════════════════════════════════════════════════════════════════════════════

const consistencyReport = readJson('consistency-report.json');

check(
  'Consistency Report Exists',
  consistencyReport !== null,
  consistencyReport ? 'consistency-report.json loaded' : 'MISSING: consistency-report.json not found — eval-consistency was not run'
);

if (consistencyReport) {
  check(
    'Consistency Has Summary',
    consistencyReport.summary && typeof consistencyReport.summary.total_guidelines_checked === 'number',
    consistencyReport.summary ? `${consistencyReport.summary.total_guidelines_checked} guidelines checked` : 'MISSING: summary.total_guidelines_checked'
  );

  const srcMode = consistencyReport.source_mode;
  check(
    'Consistency Source Mode Ran',
    srcMode && srcMode.ran === true,
    srcMode && srcMode.ran ? 'source_mode.ran = true' : 'MISSING: source_mode.ran is not true — consistency checker did not run'
  );

  if (srcMode && Array.isArray(srcMode.violations)) {
    for (const v of srcMode.violations) {
      const hasFile = typeof v.file === 'string';
      if (!hasFile) {
        check(
          'Violation Has file Field',
          false,
          `SCHEMA ERROR: violation ${v.guideline_id} uses 'affected_files' instead of 'file'. render-report.js expects 'file' (singular string).`
        );
        break;
      }
    }
    if (srcMode.violations.every(v => typeof v.file === 'string')) {
      check('Violation file Fields Valid', true, 'All violations have string file field');
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORER 3: Persona Results Present and Connected
// Ensures persona walkthroughs ran and data propagated to journey-log
// ═══════════════════════════════════════════════════════════════════════════════

const personaResults = readJson('persona-results.json');

check(
  'Persona Results Exists',
  personaResults !== null,
  personaResults ? 'persona-results.json loaded' : 'MISSING: persona-results.json not found — persona walkthroughs did not run'
);

if (personaResults) {
  check(
    'Persona Results Is Array',
    Array.isArray(personaResults) && personaResults.length > 0,
    Array.isArray(personaResults) ? `${personaResults.length} persona+task runs` : 'SCHEMA ERROR: persona-results.json is not an array'
  );

  if (Array.isArray(personaResults) && personaResults.length > 0) {
    const emptyTraces = personaResults.filter(pr => !Array.isArray(pr.trace) || pr.trace.length === 0);
    check(
      'Persona Traces Non-Empty',
      emptyTraces.length === 0,
      emptyTraces.length === 0 ? 'All persona runs have non-empty trace[]' : `${emptyTraces.length} persona run(s) have empty trace[] — walkthrough did not write live data`
    );

    const reqKeys = ['persona_id', 'persona_name', 'task_index', 'task', 'trace', 'patience_end', 'abandoned'];
    const pr0 = personaResults[0];
    const missingKeys = reqKeys.filter(k => !(k in pr0));
    check(
      'Persona Result Schema',
      missingKeys.length === 0,
      missingKeys.length === 0 ? 'All required keys present' : `MISSING keys: ${missingKeys.join(', ')}`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORER 4: Evaluation Summary Propagation
// Ensures render-report.js correctly populated evaluation-summary.json
// ═══════════════════════════════════════════════════════════════════════════════

const summary = readJson('evaluation-summary.json');

check(
  'Evaluation Summary Exists',
  summary !== null,
  summary ? 'evaluation-summary.json loaded' : 'MISSING: evaluation-summary.json not found'
);

if (summary) {
  const usability = summary.usability;
  check(
    'Summary Usability Not Null',
    usability && usability.overall_score !== null,
    usability && usability.overall_score !== null ? `overall_score = ${usability.overall_score}` : 'PROPAGATION FAILURE: usability.overall_score is null — journey-log.json schema mismatch prevented render-report.js from reading the data'
  );

  check(
    'Summary Personas Populated',
    usability && Array.isArray(usability.personas_evaluated) && usability.personas_evaluated.length > 0,
    usability && usability.personas_evaluated && usability.personas_evaluated.length > 0 ? `${usability.personas_evaluated.length} personas` : 'PROPAGATION FAILURE: personas_evaluated is empty'
  );

  check(
    'Summary Dimensions Populated',
    usability && Array.isArray(usability.dimensions) && usability.dimensions.length > 0,
    usability && usability.dimensions && usability.dimensions.length > 0 ? `${usability.dimensions.length} dimensions` : 'PROPAGATION FAILURE: dimensions is empty — usability scoring data not reaching the report'
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORER 5: Iteration Log Complete
// Ensures iteration-log.json has exit_reason and phase_b data
// ═══════════════════════════════════════════════════════════════════════════════

const iterationLog = readJson('iteration-log.json');

check(
  'Iteration Log Exists',
  iterationLog !== null,
  iterationLog ? 'iteration-log.json loaded' : 'MISSING: iteration-log.json'
);

if (iterationLog) {
  check(
    'Exit Reason Not Pending',
    iterationLog.exit_reason && iterationLog.exit_reason !== 'pending',
    iterationLog.exit_reason && iterationLog.exit_reason !== 'pending' ? `exit_reason = ${iterationLog.exit_reason}` : 'INCOMPLETE: exit_reason is "pending" — pipeline did not set final state'
  );

  check(
    'Phase B Data Present',
    iterationLog.phase_b && iterationLog.phase_b.usability_score,
    iterationLog.phase_b && iterationLog.phase_b.usability_score ? `usability_score = ${iterationLog.phase_b.usability_score}` : 'MISSING: phase_b.usability_score not populated — append-iteration-log.js did not pick up persona data'
  );

  check(
    'Phase B Personas Listed',
    iterationLog.phase_b && Array.isArray(iterationLog.phase_b.personas_evaluated) && iterationLog.phase_b.personas_evaluated.length > 0,
    iterationLog.phase_b && iterationLog.phase_b.personas_evaluated && iterationLog.phase_b.personas_evaluated.length > 0 ? `personas: ${iterationLog.phase_b.personas_evaluated.join(', ')}` : 'MISSING: phase_b.personas_evaluated is empty'
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORER 6: Fix History Tab Data
// Ensures fix-log.json exists when pipeline-infrastructure or AC fixes were applied
// ═══════════════════════════════════════════════════════════════════════════════

const fixLog = readJson('fix-log.json');
const refinementSuggestions = readJson('refinement-suggestions.json');

if (iterationLog && iterationLog.iterations && iterationLog.iterations.length > 1) {
  check(
    'Fix Log Exists When Iterations > 1',
    fixLog !== null,
    fixLog ? `fix-log.json: ${Array.isArray(fixLog) ? fixLog.length : 0} entries` : 'MISSING: fix-log.json should exist when multiple iterations ran (fixes were attempted)'
  );
}

if (fixLog) {
  check(
    'Fix Log Is Array',
    Array.isArray(fixLog),
    Array.isArray(fixLog) ? `${fixLog.length} fix entries` : 'SCHEMA ERROR: fix-log.json should be an array'
  );

  if (Array.isArray(fixLog) && fixLog.length > 0) {
    const reqKeys = ['description', 'applied', 'timestamp'];
    const f0 = fixLog[0];
    const missingKeys = reqKeys.filter(k => !(k in f0));
    check(
      'Fix Log Entry Schema',
      missingKeys.length === 0,
      missingKeys.length === 0 ? 'Fix entries have required keys (description, applied, timestamp)' : `MISSING keys in fix-log[0]: ${missingKeys.join(', ')}`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// OUTPUT
// ═══════════════════════════════════════════════════════════════════════════════

const passCount = results.filter(r => r.pass).length;
const failCount = results.filter(r => !r.pass).length;

console.log(JSON.stringify({ results, pass_count: passCount, fail_count: failCount, all_pass: !hasFailure }, null, 2));

process.exit(hasFailure ? 1 : 0);
