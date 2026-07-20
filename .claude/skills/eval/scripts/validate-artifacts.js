#!/usr/bin/env node
/**
 * validate-artifacts.js — Pre-flight schema check for eval pipeline artifacts.
 * Run before render-report.js to catch schema drift from agent-produced JSON.
 *
 * Usage: node validate-artifacts.js .artifacts/<KEY>/
 * Exit code 0 = all checks pass, 1 = violations found (prints fix instructions).
 */
const fs = require('fs');
const path = require('path');

const artifactsDir = process.argv[2];
if (!artifactsDir) {
  console.error('Usage: node validate-artifacts.js <artifacts-dir>');
  process.exit(1);
}

const abs = path.resolve(artifactsDir);
let violations = 0;

function check(condition, file, message, fix) {
  if (!condition) {
    violations++;
    console.error(`  FAIL [${file}]: ${message}`);
    if (fix) console.error(`        Fix: ${fix}`);
  }
}

function readJson(filename) {
  const p = path.join(abs, filename);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// --- journey-log.json ---
const jl = readJson('journey-log.json');
if (jl) {
  console.log('Checking journey-log.json...');
  check(jl.depth, 'journey-log', 'Missing top-level "depth" field', 'Add "depth": "deep"');
  check(jl.prototype_url, 'journey-log', 'Missing top-level "prototype_url" field', 'Add the prototype URL');
  check(jl.evaluated_at, 'journey-log', 'Missing top-level "evaluated_at" field', 'Add ISO timestamp');

  if (Array.isArray(jl.journeys)) {
    for (const j of jl.journeys) {
      const jid = j.id || '?';
      check(j.id && j.id.match(/^journey-\d+$/), 'journey-log', `Journey "${jid}": id must be "journey-N" format`);
      check(j.persona, 'journey-log', `Journey "${jid}": missing "persona" field`);
      check(j.source, 'journey-log', `Journey "${jid}": missing "source" field`);
      check(j.steps_expected != null, 'journey-log', `Journey "${jid}": missing "steps_expected"`, 'Set to steps.length');
      check(j.steps_completed != null, 'journey-log', `Journey "${jid}": missing "steps_completed"`, 'Set to steps.length');

      if (Array.isArray(j.steps)) {
        for (const s of j.steps) {
          check(typeof s.step === 'number', 'journey-log', `Journey "${jid}" step: "step" must be a number`);
          check(s.result === 'success' || s.result === 'fail', 'journey-log',
            `Journey "${jid}" step ${s.step}: "result" must be "success" or "fail", got "${s.result}"`,
            'Change to exactly "success" or "fail"');
          check(s.narration, 'journey-log', `Journey "${jid}" step ${s.step}: missing "narration"`);
          if (s.screenshot) {
            check(!s.screenshot.startsWith('/'), 'journey-log',
              `Journey "${jid}" step ${s.step}: screenshot path is absolute`,
              'Use relative path like "screenshots/journey-1-step-1.png"');
          }
        }
      }
    }
  }

  if (jl.usability_dimensions) {
    const ud = jl.usability_dimensions;
    check(Array.isArray(ud.personas_evaluated) && ud.personas_evaluated.length > 0, 'journey-log',
      'usability_dimensions.personas_evaluated must be a non-empty array at top level');
    check(Array.isArray(ud.dimensions), 'journey-log',
      'usability_dimensions.dimensions must be an array (not flat key-value)',
      'Restructure as: dimensions: [{ id, name, scores: {persona: {score, confidence, finding}}, composite_score }]');
    check(ud.overall_score && String(ud.overall_score).includes('/'), 'journey-log',
      'usability_dimensions.overall_score must be "X/21" format');
    check(Array.isArray(ud.persona_overlays), 'journey-log',
      'usability_dimensions.persona_overlays must be an array');
    check(ud.think_aloud && Array.isArray(ud.think_aloud.traces), 'journey-log',
      'usability_dimensions.think_aloud.traces must be an array');

    if (ud.think_aloud && Array.isArray(ud.think_aloud.traces)) {
      for (const t of ud.think_aloud.traces) {
        if (t.dimension_scores) {
          for (const [key, val] of Object.entries(t.dimension_scores)) {
            check(typeof val === 'object' && val !== null && val.score != null, 'journey-log',
              `think_aloud.traces[${t.persona}].dimension_scores.${key} must be {score, confidence}, got ${typeof val}`,
              'Wrap number as { score: N, confidence: "medium" }');
          }
        }
      }
    }
  }
} else {
  console.log('journey-log.json: not found (skipping)');
}

// --- persona-results.json ---
const pr = readJson('persona-results.json');
if (pr) {
  console.log('Checking persona-results.json...');
  check(Array.isArray(pr), 'persona-results', 'Must be an array, not an object',
    'Wrap as array: [{ persona, task_index, trace, screenshots, ... }]');

  if (Array.isArray(pr)) {
    for (const entry of pr) {
      const pid = entry.persona || '?';
      check(entry.task_index != null, 'persona-results', `Entry "${pid}": missing task_index`);
      check(Array.isArray(entry.trace) && entry.trace.length > 0, 'persona-results',
        `Entry "${pid}" task ${entry.task_index}: trace must be a non-empty array`);
      check(Array.isArray(entry.screenshots), 'persona-results',
        `Entry "${pid}" task ${entry.task_index}: missing screenshots array`);

      if (Array.isArray(entry.trace)) {
        for (const t of entry.trace) {
          check(t.what_i_see != null, 'persona-results',
            `Entry "${pid}" step ${t.step}: missing "what_i_see"`, 'Add persona observation text');
          check(t.what_im_thinking != null, 'persona-results',
            `Entry "${pid}" step ${t.step}: missing "what_im_thinking"`, 'Add persona inner monologue');
          check(t.evidence_for_acs != null, 'persona-results',
            `Entry "${pid}" step ${t.step}: missing "evidence_for_acs"`, 'Add [] if no AC relevance');
        }
      }
    }
  }
} else {
  console.log('persona-results.json: not found (skipping)');
}

// --- consistency-report.json ---
const cr = readJson('consistency-report.json');
if (cr) {
  console.log('Checking consistency-report.json...');
  if (!cr.skipped) {
    check(cr.source_mode != null, 'consistency-report', 'Missing source_mode section');
    check(cr.visual_mode != null, 'consistency-report', 'Missing visual_mode section');
    check(cr.summary != null, 'consistency-report', 'Missing summary section');
  }
} else {
  console.log('consistency-report.json: not found (skipping)');
}

// --- extract-state.json ---
const es = readJson('extract-state.json');
if (es) {
  console.log('Checking extract-state.json...');
  check(es.key, 'extract-state', 'Missing "key" field');
  check(es.title, 'extract-state', 'Missing "title" field');
  check(Array.isArray(es.ac_list) && es.ac_list.length > 0, 'extract-state', 'ac_list must be a non-empty array');
  if (!es.feature_context) {
    console.warn('  WARN [extract-state]: Missing "feature_context" field (non-fatal)');
  }
}

// --- component-map.json ---
const cm = readJson('component-map.json');
if (cm) {
  console.log('Checking component-map.json...');
  check(cm.target_page, 'component-map', 'Missing "target_page" field');
  check(cm.ui_type, 'component-map', 'Missing "ui_type" field (expected: table, form, wizard, dashboard, or mixed)');
  check(cm.content_ready_selector, 'component-map', 'Missing "content_ready_selector" field');
  check(cm.ac_element_mapping || cm.ac_column_mapping, 'component-map',
    'Missing "ac_element_mapping" field', 'Map each AC to its target element and interaction type');
  if (cm.ui_type === 'table') {
    check(cm.table_columns, 'component-map', 'Table UI type requires "table_columns" field');
  }
} else {
  console.log('component-map.json: not found (skipping)');
}

// --- navigation-hints.json ---
const nh = readJson('navigation-hints.json');
if (nh) {
  console.log('Checking navigation-hints.json...');
  check(nh.routes && (Array.isArray(nh.routes) || typeof nh.routes === 'object'), 'navigation-hints',
    'Missing or invalid "routes" (expected array or object)');
  check(nh.nav_sections && (Array.isArray(nh.nav_sections) || typeof nh.nav_sections === 'object'), 'navigation-hints',
    'Missing or invalid "nav_sections" (expected array or object)');
} else {
  console.log('navigation-hints.json: not found (skipping)');
}

// --- screenshots directory ---
const ssDir = path.join(abs, 'screenshots');
if (fs.existsSync(ssDir)) {
  console.log('Checking screenshots...');
  const files = fs.readdirSync(ssDir).filter(f => f.endsWith('.png'));
  check(files.length > 0, 'screenshots', 'Screenshots directory is empty');

  const journeyScreenshots = files.filter(f => f.startsWith('journey-'));
  const personaScreenshots = files.filter(f => f.startsWith('persona-'));
  console.log(`  Found ${journeyScreenshots.length} journey + ${personaScreenshots.length} persona screenshots`);
}

// --- Summary ---
console.log('');
if (violations === 0) {
  console.log('All checks passed.');
  process.exit(0);
} else {
  console.error(`${violations} violation(s) found. Fix before running render-report.js.`);
  process.exit(1);
}
