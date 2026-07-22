#!/usr/bin/env node
/**
 * validate-report-rendering.js
 *
 * Unit test: given pipeline artifacts, runs render-report.js and asserts
 * the output HTML contains all expected sections and data.
 *
 * Catches: data that exists in JSON artifacts but fails to render in the HTML
 * due to field name mismatches, missing template placeholders, or broken lookups.
 *
 * Usage:
 *   node validate-report-rendering.js <artifacts-dir>
 *
 * Exit codes:
 *   0 = all checks pass
 *   1 = one or more checks failed
 */

const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const { execSync } = require('child_process');

const artifactsDir = process.argv[2];
if (!artifactsDir) {
  console.error('Usage: node validate-report-rendering.js <artifacts-dir>');
  process.exit(1);
}

const absArtifacts = require('path').resolve(artifactsDir);
const results = [];
let hasFailure = false;

function check(name, condition, detail) {
  const passed = !!condition;
  if (!passed) hasFailure = true;
  results.push({ scorer: name, pass: passed, detail });
}

// ─── Step 1: Render the report ───────────────────────────────────────────────
const renderScript = join(__dirname, '..', 'scripts', 'render-report.js');
try {
  execSync(`node "${renderScript}" "${absArtifacts}" --note="test-render"`, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: join(__dirname, '..', '..', '..', '..')
  });
} catch (e) {
  check('Report Renders Without Error', false, `render-report.js crashed: ${e.stderr ? e.stderr.toString().slice(0, 200) : e.message}`);
  console.log(JSON.stringify({ results, pass_count: 0, fail_count: 1, all_pass: false }, null, 2));
  process.exit(1);
}

const reportPath = join(absArtifacts, 'evaluation-report.html');
check('Report File Created', existsSync(reportPath), existsSync(reportPath) ? 'evaluation-report.html exists' : 'MISSING: report not generated');

if (!existsSync(reportPath)) {
  console.log(JSON.stringify({ results, pass_count: results.filter(r => r.pass).length, fail_count: results.filter(r => !r.pass).length, all_pass: false }, null, 2));
  process.exit(1);
}

const html = readFileSync(reportPath, 'utf8');

// ─── Step 2: Load source artifacts for comparison ────────────────────────────
function readJson(filename) {
  const p = join(absArtifacts, filename);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

const journeyLog = readJson('journey-log.json');
const personaResults = readJson('persona-results.json');
const consistencyReport = readJson('consistency-report.json');
const iterationLog = readJson('iteration-log.json');

// ─── SCORER A: Usability Dimensions Render ───────────────────────────────────
if (journeyLog && journeyLog.usability_dimensions) {
  const ud = journeyLog.usability_dimensions;

  check(
    'Usability Score In Report',
    html.includes(String(ud.overall_score)),
    ud.overall_score ? `Score "${ud.overall_score}" found in HTML` : 'overall_score not in HTML'
  );

  if (Array.isArray(ud.dimensions)) {
    for (const dim of ud.dimensions.slice(0, 3)) {
      check(
        `Dimension "${dim.name}" Renders`,
        html.includes(dim.name),
        html.includes(dim.name) ? `"${dim.name}" found` : `MISSING: "${dim.name}" not in HTML despite being in journey-log.json`
      );
    }
  }

  if (Array.isArray(ud.personas_evaluated)) {
    for (const pid of ud.personas_evaluated) {
      check(
        `Persona "${pid}" Renders`,
        html.includes(pid),
        html.includes(pid) ? `"${pid}" found in HTML` : `MISSING: "${pid}" not rendered despite being in personas_evaluated`
      );
    }
  }
}

// ─── SCORER B: Persona Selection Reasoning ───────────────────────────────────
const ps = journeyLog && journeyLog.persona_selection;
if (ps) {
  check(
    'Persona Selection Reasoning Renders (not fallback warning)',
    !html.includes('Full persona selection reasoning was not logged'),
    !html.includes('Full persona selection reasoning was not logged')
      ? 'No fallback warning — real reasoning rendered'
      : 'RENDERING BUG: Fallback warning present despite persona_selection data existing in JSON'
  );

  if (ps.target_audience_text) {
    check(
      'Target Audience Text In Report',
      html.includes(ps.target_audience_text.slice(0, 30)),
      html.includes(ps.target_audience_text.slice(0, 30))
        ? 'target_audience_text rendered'
        : `MISSING: "${ps.target_audience_text.slice(0, 40)}..." not in HTML`
    );
  }

  if (Array.isArray(ps.considered_but_rejected) && ps.considered_but_rejected.length > 0) {
    const first = ps.considered_but_rejected[0];
    const idToCheck = first.persona_id || first.persona;
    check(
      'Considered-But-Rejected Persona Renders',
      html.includes(idToCheck),
      html.includes(idToCheck)
        ? `"${idToCheck}" rendered in rejected list`
        : `MISSING: "${idToCheck}" not in HTML despite being in considered_but_rejected`
    );
  }
}

// ─── SCORER C: Walkthrough Steps Render ──────────────────────────────────────
const walkthroughMatch = html.match(/var personaWalkthroughData = ({.*?});/s);
if (walkthroughMatch) {
  try {
    const walkthroughData = JSON.parse(walkthroughMatch[1]);
    let totalSteps = 0;
    for (const [pid, pd] of Object.entries(walkthroughData)) {
      for (const task of (pd.tasks || [])) {
        totalSteps += (task.steps || []).length;
      }
    }

    const hasTraceData = Array.isArray(personaResults) && personaResults.some(r => r.trace && r.trace.length > 0);
    check(
      'Walkthrough Steps Populated',
      totalSteps > 0 || !hasTraceData,
      totalSteps > 0
        ? `${totalSteps} walkthrough steps rendered`
        : hasTraceData
          ? 'RENDERING BUG: persona-results.json has trace data but 0 steps rendered in HTML'
          : 'No trace data available (expected)'
    );
  } catch (e) {
    check('Walkthrough Data Parses', false, `personaWalkthroughData JSON is malformed: ${e.message}`);
  }
} else if (personaResults) {
  check('Walkthrough Data Present', false, 'MISSING: personaWalkthroughData variable not in HTML despite persona-results.json existing');
}

// ─── SCORER D: Consistency Report Renders ────────────────────────────────────
if (consistencyReport && consistencyReport.summary) {
  const total = consistencyReport.summary.total_guidelines_checked;
  if (total) {
    check(
      'Consistency Guidelines Count In Report',
      html.includes(String(total)),
      html.includes(String(total))
        ? `"${total}" guidelines count rendered`
        : `MISSING: consistency count "${total}" not in HTML`
    );
  }

  if (consistencyReport.source_mode && Array.isArray(consistencyReport.source_mode.violations)) {
    const violationCount = consistencyReport.source_mode.violations.length;
    if (violationCount > 0) {
      const firstViolation = consistencyReport.source_mode.violations[0];
      const gid = firstViolation.guideline_id || '';
      const desc = firstViolation.description || '';
      const file = firstViolation.file || '';
      // render-report.js converts guideline_id to a display title and may strip path prefixes
      const gidTitle = gid.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      const fileBasename = file.split('/').pop();
      const found = (gid && html.includes(gid))
        || (desc && html.includes(desc.slice(0, 30)))
        || (file && html.includes(file))
        || (fileBasename && html.includes(fileBasename))
        || (gidTitle && html.toLowerCase().includes(gidTitle.toLowerCase()));
      check(
        'Consistency Violation Renders',
        found,
        found
          ? `Violation content found in HTML (checked: id, desc, file, title)`
          : `MISSING: violation "${gid}" / "${desc.slice(0, 40)}" / "${file}" not rendered`
      );
    }
  }
}

// ─── SCORER E: Think-Aloud Narratives ────────────────────────────────────────
if (journeyLog && journeyLog.usability_dimensions && journeyLog.usability_dimensions.think_aloud) {
  const ta = journeyLog.usability_dimensions.think_aloud;
  if (ta.traces && ta.traces.length > 0) {
    check(
      'Think-Aloud Section Renders',
      html.toLowerCase().includes('think-aloud') || html.toLowerCase().includes('thinkaloud'),
      (html.toLowerCase().includes('think-aloud') || html.toLowerCase().includes('thinkaloud'))
        ? 'Think-aloud section present in HTML'
        : 'MISSING: think_aloud data exists in JSON but no think-aloud section in HTML'
    );
  }
}

// ─── OUTPUT ──────────────────────────────────────────────────────────────────

const passCount = results.filter(r => r.pass).length;
const failCount = results.filter(r => !r.pass).length;

console.log(JSON.stringify({ results, pass_count: passCount, fail_count: failCount, all_pass: !hasFailure }, null, 2));

process.exit(hasFailure ? 1 : 0);
