#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const artifactsBase = path.join(projectRoot, '.artifacts');

// UX Designer manual evaluations from the Google Sheet (last synced 2026-06-16)
// Source: https://docs.google.com/spreadsheets/d/1pVpmc4RKLwM-fLAH8mR2uj2hlWX30TGiot8kpg5ETEo
// These are ground truth baselines used to calibrate the automated eval's recall/precision.
// In the future, the eval loop will run without manual review — these train the initial thresholds.
const manualEvals = [
  { key: 'RHAISTRAT-1527', mr: 168, lofi: 'Pass', lofiQualifier: '', hifi: 'Pass', hifiQualifier: '', navIssue: false, failReason: '',
    note: 'Already implemented by designer behind feature flag. AI just enabled it.' },
  { key: 'RHAISTRAT-133', mr: 169, lofi: 'Pass', lofiQualifier: '', hifi: 'Fail', hifiQualifier: '', navIssue: false, failReason: 'design',
    note: 'Debug toggle interaction not perfect, but good enough for low-fi discussions about metrics/traces in Playground.' },
  { key: 'RHAISTRAT-1492', mr: 170, lofi: 'Pass', lofiQualifier: '', hifi: 'IDK', hifiQualifier: '', navIssue: false, failReason: '',
    note: 'Reasonable Experiments page with creation form. Domain expertise needed to assess quality.' },
  { key: 'RHAISTRAT-1267', mr: 167, lofi: 'Pass', lofiQualifier: 'barely', hifi: 'Fail', hifiQualifier: '', navIssue: false, failReason: 'design',
    note: 'Dashboards page links to Perses — functional but not great. Jira didn\'t describe desired changes well.' },
  { key: 'RHAISTRAT-1536', mr: 171, lofi: 'Pass', lofiQualifier: '', hifi: 'IDK', hifiQualifier: 'probably not', navIssue: false, failReason: '',
    note: 'Robust Roles tab with form, templates, rules, YAML preview. Good for lo-fi conversation but finesse is rough.' },
  { key: 'RHAISTRAT-1535', mr: 172, lofi: 'Fail', lofiQualifier: 'path not findable', hifi: 'Fail', hifiQualifier: '', navIssue: true, failReason: 'nav',
    note: 'Created route for YAML editor GA but not accessible from nav or Model Deployments. Design is a regression.' },
  { key: 'RHAISTRAT-1745', mr: 176, lofi: 'Pass', lofiQualifier: '', hifi: 'IDK', hifiQualifier: 'maybe', navIssue: false, failReason: '',
    note: 'Export code modal with Llama Stack, OpenAI SDK, cURL examples. Sufficient for lo-fi.' },
  { key: 'RHAISTRAT-1474', mr: 173, lofi: 'Fail', lofiQualifier: 'requires more taste', hifi: 'Fail', hifiQualifier: '', navIssue: false, failReason: 'design',
    note: 'Homepage redesign is just launch cards — overwhelming. Not good enough to discuss as lo-fi. Actual designers did better.' },
  { key: 'RHAISTRAT-1740', mr: 175, lofi: 'Fail', lofiQualifier: 'path not findable', hifi: 'Fail', hifiQualifier: '', navIssue: true, failReason: 'nav',
    note: 'Agent Catalog not accessible from left nav. Page design barely okay for lo-fi. Not ready for implementation.' },
  { key: 'RHAISTRAT-432', mr: 174, lofi: 'Fail', lofiQualifier: 'empty table', hifi: 'Fail', hifiQualifier: '', navIssue: false, failReason: 'broken',
    note: 'Deployments list rendered empty — changes not reviewable. Playwright should have caught this.' },
  { key: 'RHAISTRAT-1521', mr: 177, lofi: 'Pass', lofiQualifier: 'barely', hifi: 'Fail', hifiQualifier: '', navIssue: false, failReason: 'design',
    note: 'KALE page in Develop & train but experience doesn\'t make sense — Jira wasn\'t clear.' },
  { key: 'RHAISTRAT-1433', mr: 178, lofi: 'Pass', lofiQualifier: 'barely', hifi: 'IDK', hifiQualifier: 'probably not', navIssue: false, failReason: '',
    note: 'Decent page in Develop & train but mentions MLFlow in nav (against guidelines). No CRUD operations.' },
  { key: 'RHAISTRAT-1762', mr: 180, lofi: 'Pass', lofiQualifier: '', hifi: 'IDK', hifiQualifier: '', navIssue: false, failReason: '',
    note: 'MCP Registry page at AI Hub > MCP Servers > Registry. Decent enough to express the idea.' },
  { key: 'RHAISTRAT-1761', mr: 183, lofi: 'N/A', lofiQualifier: '', hifi: 'N/A', hifiQualifier: '', navIssue: false, failReason: '',
    note: 'Incorrectly tagged as needing Dashboard changes. AI added a Settings page that doesn\'t make sense.' },
  { key: 'RHAISTRAT-1758', mr: 181, lofi: 'Fail', lofiQualifier: 'path not findable', hifi: 'Fail', hifiQualifier: '', navIssue: true, failReason: 'nav',
    note: 'Agent Deployments page created but nav not updated. Page itself looks okay.' },
  { key: 'RHAISTRAT-1744', mr: 182, lofi: 'Fail', lofiQualifier: 'path not findable', hifi: 'Fail', hifiQualifier: '', navIssue: true, failReason: 'nav',
    note: 'Pipeline playground page not navigable. Also requires user to provide Responses API Endpoint.' },
  { key: 'RHAISTRAT-1742', mr: 184, lofi: 'Pass', lofiQualifier: '', hifi: 'Fail', hifiQualifier: '', navIssue: false, failReason: 'design',
    note: 'Agents page in AI Hub is positionally correct. Deploy Agent form doesn\'t make sense — needs container image.' },
  { key: 'RHAISTRAT-1741', mr: 179, lofi: 'Pass', lofiQualifier: '', hifi: 'Fail', hifiQualifier: 'probably', navIssue: false, failReason: 'design',
    note: 'Tenant management Settings page good enough to discuss but not ready for implementation.' },
];

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

function readEvalCSV(key) {
  const csvPath = path.join(artifactsBase, key, 'evaluation-report.csv');
  if (!fs.existsSync(csvPath)) return null;

  const raw = fs.readFileSync(csvPath, 'utf8').trim();
  // Parse only the AC section (skip comment lines, stop at next section)
  const allLines = raw.split('\n').filter(l => !l.startsWith('#'));
  if (allLines.length < 2) return null;

  const headers = parseCSVLine(allLines[0]);
  const rows = [];
  for (let i = 1; i < allLines.length; i++) {
    const line = allLines[i].trim();
    if (!line) continue;
    const vals = parseCSVLine(line);
    if (vals.length >= 2 && /^[a-z_]+$/.test(vals[0]) && vals[0].includes('_') && !vals[0].startsWith('RHAISTRAT')) break;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
    rows.push(obj);
  }

  const jiraRows = rows.filter(r => (r.source || '').toLowerCase() !== 'inferred');
  const navRows = rows.filter(r => (r.criterion_id || '').startsWith('NAV'));

  const hasJiraFail = jiraRows.some(r => r.verdict === 'FAIL');
  const hasNavFail = navRows.some(r => r.verdict === 'FAIL');
  const allJiraPass = jiraRows.every(r => r.verdict === 'PASS');

  let ourLofi;
  if (hasNavFail) ourLofi = 'Fail (nav)';
  else if (hasJiraFail) ourLofi = 'Fail';
  else if (allJiraPass) ourLofi = 'Pass';
  else ourLofi = 'Mixed';

  return {
    key,
    totalCriteria: rows.length,
    jiraPass: jiraRows.filter(r => r.verdict === 'PASS').length,
    jiraFail: jiraRows.filter(r => r.verdict === 'FAIL').length,
    jiraFlagged: jiraRows.filter(r => r.verdict === 'FLAGGED').length,
    navFail: hasNavFail,
    ourLofi,
  };
}

function main() {
  console.log('\nGround Truth vs Automated Eval — Comparison\n');
  console.log('Ground truth: ' + manualEvals.length + ' STRATs from Google Sheet');
  console.log('Our data: eval CSVs from .artifacts/\n');

  const evaluated = [];
  const notEvaluated = [];
  let agree = 0, disagree = 0, navRecallHits = 0, navRecallTotal = 0;
  let falsePos = 0, falseNeg = 0;

  for (const manual of manualEvals) {
    if (manual.lofi === 'N/A') continue;

    const ours = readEvalCSV(manual.key);

    if (!ours) {
      notEvaluated.push(manual.key);
      continue;
    }

    const manualPass = manual.lofi === 'Pass';
    const ourPass = ours.ourLofi === 'Pass';

    const match = manualPass === ourPass;
    if (match) agree++;
    else {
      disagree++;
      if (ourPass && !manualPass) falseNeg++;
      if (!ourPass && manualPass) falsePos++;
    }

    if (manual.navIssue) {
      navRecallTotal++;
      if (ours.navFail) navRecallHits++;
    }

    evaluated.push({ manual, ours, match });
  }

  // Results table
  const manualTotal = manualEvals.filter(a => a.lofi !== 'N/A').length;
  console.log(`  STRAT            | Manual Lo-fi          | Our Verdict     | Match | Fail Reason`);
  console.log(`  -----------------+---------------------+-----------------+-------+------------------`);

  for (const { manual, ours, match } of evaluated) {
    const m = match ? '  ✓  ' : '  ✗  ';
    const manualLabel = manual.lofi + (manual.lofiQualifier ? ` (${manual.lofiQualifier})` : '');
    const reason = manual.failReason || '—';
    console.log(`  ${manual.key.padEnd(17)}| ${manualLabel.padEnd(20)}| ${ours.ourLofi.padEnd(16)}| ${m} | ${reason}`);
  }

  if (notEvaluated.length) {
    console.log(`\n  Not yet evaluated (${notEvaluated.length}):`);
    for (const key of notEvaluated) {
      const manual = manualEvals.find(a => a.key === key);
      const manualLabel = manual.lofi + (manual.lofiQualifier ? ` (${manual.lofiQualifier})` : '');
      const hifiLabel = manual.hifi + (manual.hifiQualifier ? ` (${manual.hifiQualifier})` : '');
      console.log(`    ${key} — Lo-fi: ${manualLabel} | Hi-fi: ${hifiLabel}`);
      console.log(`      ${manual.note}`);
    }
  }

  // Summary
  const total = agree + disagree;
  console.log('\n--- Summary ---\n');
  console.log(`  Manual review totals:   Lo-fi ${manualEvals.filter(a => a.lofi === 'Pass').length}/${manualTotal} pass | Hi-fi ${manualEvals.filter(a => a.hifi === 'Pass').length}/${manualTotal} pass`);
  console.log(`  Evaluated:       ${total}/${manualTotal} STRATs`);
  console.log(`  Agreement:       ${agree}/${total} (${total ? Math.round(agree / total * 100) : 0}%)`);
  console.log(`  False negatives: ${falseNeg} (we PASS, manual says Fail)`);
  console.log(`  False positives: ${falsePos} (we FAIL, manual says Pass)`);

  if (navRecallTotal > 0) {
    console.log(`\n  Nav failure recall: ${navRecallHits}/${navRecallTotal} (Manual review flagged ${navRecallTotal} as "path not findable")`);
  }

  // Write report
  const outDir = path.join(artifactsBase, 'runs');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'manual-comparison.md');

  let md = `# Ground Truth vs Automated Eval — Comparison\n\n`;
  md += `**Date:** ${new Date().toISOString().split('T')[0]}\n`;
  md += `**Ground truth:** ${manualTotal} STRATs from [Google Sheet](https://docs.google.com/spreadsheets/d/1pVpmc4RKLwM-fLAH8mR2uj2hlWX30TGiot8kpg5ETEo)\n`;
  md += `**Manual review totals:** Lo-fi ${manualEvals.filter(a => a.lofi === 'Pass').length}/${manualTotal} pass, Hi-fi ${manualEvals.filter(a => a.hifi === 'Pass').length}/${manualTotal} pass\n\n`;
  md += `## Evaluated\n\n`;
  md += `| STRAT | Manual Lo-fi | Fail Reason | Our Verdict | Match | Nav Recall |\n`;
  md += `|-------|-----------|-------------|-------------|-------|------------|\n`;

  for (const { manual, ours, match } of evaluated) {
    const m = match ? 'Yes' : '**No**';
    const nav = manual.navIssue ? (ours.navFail ? 'Caught' : '**Missed**') : '—';
    const manualLabel = manual.lofi + (manual.lofiQualifier ? ` (${manual.lofiQualifier})` : '');
    const reason = manual.failReason || '—';
    md += `| ${manual.key} | ${manualLabel} | ${reason} | ${ours.ourLofi} | ${m} | ${nav} |\n`;
  }

  md += `\n## Summary\n\n`;
  md += `- Evaluated: ${total}/${manualTotal}\n`;
  md += `- Agreement: ${agree}/${total} (${total ? Math.round(agree / total * 100) : 0}%)\n`;
  md += `- False negatives: ${falseNeg} (we PASS, manual says Fail)\n`;
  md += `- False positives: ${falsePos} (we FAIL, manual says Pass)\n`;
  if (navRecallTotal > 0) {
    md += `- Nav failure recall: ${navRecallHits}/${navRecallTotal} (Manual review flagged ${navRecallTotal} as "path not findable")\n`;
  }

  md += `\n## Failure Patterns in Manual Reviews\n\n`;
  const navFails = manualEvals.filter(a => a.failReason === 'nav');
  const designFails = manualEvals.filter(a => a.failReason === 'design');
  const brokenFails = manualEvals.filter(a => a.failReason === 'broken');
  md += `| Pattern | Count | STRATs | Our eval can catch? |\n`;
  md += `|---------|-------|--------|--------------------|\n`;
  md += `| Path not findable (nav) | ${navFails.length} | ${navFails.map(a => a.key).join(', ')} | Yes — NAV checks from MR delta |\n`;
  md += `| Design quality / taste | ${designFails.length} | ${designFails.map(a => a.key).join(', ')} | Partially — usability dimensions + consistency checker |\n`;
  md += `| Broken / empty content | ${brokenFails.length} | ${brokenFails.map(a => a.key).join(', ')} | Yes — Playwright verify steps |\n`;

  md += `\n## Not Yet Evaluated\n\n`;
  md += `| STRAT | Manual Lo-fi | Manual Hi-fi | Fail Reason | Reviewer Note |\n`;
  md += `|-------|-----------|-----------|-------------|-------------|\n`;
  for (const key of notEvaluated) {
    const manual = manualEvals.find(a => a.key === key);
    const loLabel = manual.lofi + (manual.lofiQualifier ? ` (${manual.lofiQualifier})` : '');
    const hiLabel = manual.hifi + (manual.hifiQualifier ? ` (${manual.hifiQualifier})` : '');
    md += `| ${key} | ${loLabel} | ${hiLabel} | ${manual.failReason || '—'} | ${manual.note} |\n`;
  }

  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`\n  Report written to ${outPath}`);
}

main();
