#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const artifactsBase = path.join(projectRoot, '.artifacts');

// Andy's 17 manual evaluations from the Google Sheet
// Source: https://docs.google.com/spreadsheets/d/1pVpmc4RKLwM-fLAH8mR2uj2hlWX30TGiot8kpg5ETEo
const andyEvals = [
  { key: 'RHAISTRAT-1527', mr: 168, lofi: 'Pass', hifi: 'Pass', navIssue: false, note: 'AI enabled existing feature flag — designer\'s work appeared' },
  { key: 'RHAISTRAT-133', mr: 169, lofi: 'Pass', hifi: 'Fail', navIssue: false, note: 'Debug toggle interaction not perfect but implementation sufficient' },
  { key: 'RHAISTRAT-1492', mr: 170, lofi: 'Pass', hifi: 'IDK', navIssue: false, note: 'Reasonable page at Experiments — domain knowledge needed to assess' },
  { key: 'RHAISTRAT-1267', mr: 167, lofi: 'Pass', hifi: 'Fail', navIssue: false, note: 'Dashboards page functional but not a great experience' },
  { key: 'RHAISTRAT-1536', mr: 171, lofi: 'Pass', hifi: 'IDK', navIssue: false, note: 'Robust Roles tab with form, templates, YAML preview — lo-fi good' },
  { key: 'RHAISTRAT-1535', mr: 172, lofi: 'Fail', hifi: 'Fail', navIssue: true, note: 'Route created but not accessible from nav or Model Deployments area' },
  { key: 'RHAISTRAT-1745', mr: 176, lofi: 'Pass', hifi: 'IDK', navIssue: false, note: 'Export code modal augmented — sufficient for lo-fi conversation' },
  { key: 'RHAISTRAT-1474', mr: 173, lofi: 'Fail', hifi: 'Fail', navIssue: false, note: 'Homepage redesign overwhelming — bunch of launch cards' },
  { key: 'RHAISTRAT-1740', mr: 175, lofi: 'Fail', hifi: 'Fail', navIssue: true, note: 'Agent Catalog page not accessible from left nav' },
  { key: 'RHAISTRAT-432', mr: 174, lofi: 'Fail', hifi: 'Fail', navIssue: false, note: 'Deployments list empty — changes not reviewable' },
  { key: 'RHAISTRAT-1521', mr: 177, lofi: 'Pass', hifi: 'Fail', navIssue: false, note: 'KALE page created but experience doesn\'t make sense — unclear Jira' },
  { key: 'RHAISTRAT-1433', mr: 178, lofi: 'Pass', hifi: 'IDK', navIssue: false, note: 'MLFlow page decent but mentions MLFlow in nav (against guidelines)' },
  { key: 'RHAISTRAT-1762', mr: 180, lofi: 'Pass', hifi: 'IDK', navIssue: false, note: 'MCP Registry page decent enough to express the idea' },
  { key: 'RHAISTRAT-1761', mr: 183, lofi: 'N/A', hifi: 'N/A', navIssue: false, note: 'Incorrectly tagged — no dashboard changes needed' },
  { key: 'RHAISTRAT-1758', mr: 181, lofi: 'Fail', hifi: 'Fail', navIssue: true, note: 'Agent Deployments page not discoverable from nav' },
  { key: 'RHAISTRAT-1744', mr: 182, lofi: 'Fail', hifi: 'Fail', navIssue: true, note: 'Page created but not navigable from obvious location' },
  { key: 'RHAISTRAT-1742', mr: 184, lofi: 'Pass', hifi: 'Fail', navIssue: false, note: 'Agents page positionally correct but form doesn\'t make sense' },
  { key: 'RHAISTRAT-1741', mr: 179, lofi: 'Pass', hifi: 'Fail', navIssue: false, note: 'Tenant management page good enough to discuss' },
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
  const lines = raw.split('\n');
  if (lines.length < 2) return null;

  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const vals = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });

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
  console.log('\nAndy vs Automated Eval — Comparison\n');
  console.log('Andy\'s data: 17 STRATs from Google Sheet');
  console.log('Our data: eval CSVs from .artifacts/\n');

  const evaluated = [];
  const notEvaluated = [];
  let agree = 0, disagree = 0, navRecallHits = 0, navRecallTotal = 0;
  let falsePos = 0, falseNeg = 0;

  for (const andy of andyEvals) {
    if (andy.lofi === 'N/A') continue;

    const ours = readEvalCSV(andy.key);

    if (!ours) {
      notEvaluated.push(andy.key);
      continue;
    }

    const andyPass = andy.lofi === 'Pass';
    const ourPass = ours.ourLofi === 'Pass';

    const match = andyPass === ourPass;
    if (match) agree++;
    else {
      disagree++;
      if (ourPass && !andyPass) falseNeg++;
      if (!ourPass && andyPass) falsePos++;
    }

    if (andy.navIssue) {
      navRecallTotal++;
      if (ours.navFail) navRecallHits++;
    }

    evaluated.push({ andy, ours, match });
  }

  // Results table
  console.log('  STRAT            | Andy Lo-fi | Our Verdict     | Match | Nav');
  console.log('  -----------------+------------+-----------------+-------+-----');

  for (const { andy, ours, match } of evaluated) {
    const m = match ? '  ✓  ' : '  ✗  ';
    const nav = andy.navIssue ? (ours.navFail ? ' ✓ ' : ' ✗ ') : '   ';
    console.log(`  ${andy.key.padEnd(17)}| ${andy.lofi.padEnd(11)}| ${ours.ourLofi.padEnd(16)}| ${m} | ${nav}`);
  }

  if (notEvaluated.length) {
    console.log(`\n  Not yet evaluated (${notEvaluated.length}):`);
    for (const key of notEvaluated) {
      const andy = andyEvals.find(a => a.key === key);
      console.log(`    ${key} — Andy: ${andy.lofi}`);
    }
  }

  // Summary
  const total = agree + disagree;
  console.log('\n--- Summary ---\n');
  console.log(`  Evaluated:       ${total}/${andyEvals.filter(a => a.lofi !== 'N/A').length} STRATs`);
  console.log(`  Agreement:       ${agree}/${total} (${total ? Math.round(agree / total * 100) : 0}%)`);
  console.log(`  False negatives: ${falseNeg} (we PASS, Andy says Fail)`);
  console.log(`  False positives: ${falsePos} (we FAIL, Andy says Pass)`);

  if (navRecallTotal > 0) {
    console.log(`\n  Nav failure recall: ${navRecallHits}/${navRecallTotal} (Andy flagged ${navRecallTotal} as "path not findable")`);
  }

  // Write report
  const outDir = path.join(artifactsBase, 'runs');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'andy-comparison.md');

  let md = `# Andy vs Automated Eval — Comparison\n\n`;
  md += `**Date:** ${new Date().toISOString().split('T')[0]}\n`;
  md += `**Andy's data:** 17 STRATs from [Google Sheet](https://docs.google.com/spreadsheets/d/1pVpmc4RKLwM-fLAH8mR2uj2hlWX30TGiot8kpg5ETEo)\n\n`;
  md += `## Results\n\n`;
  md += `| STRAT | Andy Lo-fi | Our Verdict | Match | Nav Recall |\n`;
  md += `|-------|-----------|-------------|-------|------------|\n`;

  for (const { andy, ours, match } of evaluated) {
    const m = match ? 'Yes' : '**No**';
    const nav = andy.navIssue ? (ours.navFail ? 'Caught' : '**Missed**') : '—';
    md += `| ${andy.key} | ${andy.lofi} | ${ours.ourLofi} | ${m} | ${nav} |\n`;
  }

  md += `\n## Summary\n\n`;
  md += `- Evaluated: ${total}/${andyEvals.filter(a => a.lofi !== 'N/A').length}\n`;
  md += `- Agreement: ${agree}/${total} (${total ? Math.round(agree / total * 100) : 0}%)\n`;
  md += `- False negatives: ${falseNeg}\n`;
  md += `- False positives: ${falsePos}\n`;
  if (navRecallTotal > 0) {
    md += `- Nav failure recall: ${navRecallHits}/${navRecallTotal}\n`;
  }

  md += `\n## Not Yet Evaluated\n\n`;
  for (const key of notEvaluated) {
    const andy = andyEvals.find(a => a.key === key);
    md += `- ${key} — Andy: ${andy.lofi}\n`;
  }

  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`\n  Report written to ${outPath}`);
}

main();
