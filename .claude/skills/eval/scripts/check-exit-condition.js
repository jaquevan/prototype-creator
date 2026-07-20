#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('--'));
const positional = args.filter(a => !a.startsWith('--'));

const artifactsDir = positional[0];
const iteration = parseInt(positional[1], 10);
const maxIterations = parseInt(positional[2], 10);

if (!artifactsDir || isNaN(iteration) || isNaN(maxIterations)) {
  console.error('Usage: check-exit-condition.js <artifacts-dir> <iteration> <max-iterations> [--no-fix] [--no-iterate]');
  process.exit(2);
}

const noFix = flags.includes('--no-fix');
const noIterate = flags.includes('--no-iterate');

function parseSection1Verdicts(csvPath) {
  if (!fs.existsSync(csvPath)) return null;
  const lines = fs.readFileSync(csvPath, 'utf8').split('\n');

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^(ac_id|criterion_id|id)/i.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return null;

  const header = parseCsvLine(lines[headerIdx]);
  const verdictCol = header.findIndex(h => /^verdict$/i.test(h.trim()));
  const idCol = header.findIndex(h => /^(ac_id|criterion_id|id)$/i.test(h.trim()));
  if (verdictCol === -1 || idCol === -1) return null;

  const verdicts = {};
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Stop at section markers
    if (/^#\s*SECTION/i.test(line) || /^dimension_id/i.test(line)) break;

    const fields = parseCsvLine(line);
    const id = (fields[idCol] || '').trim();
    const verdict = (fields[verdictCol] || '').trim().toUpperCase();
    if (id && verdict) verdicts[id] = verdict;
  }
  return verdicts;
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// Parse current CSV
const csvPath = path.join(artifactsDir, 'evaluation-report.csv');
const verdicts = parseSection1Verdicts(csvPath);

if (!verdicts || Object.keys(verdicts).length === 0) {
  console.error('Could not parse evaluation-report.csv Section 1');
  process.exit(2);
}

const passCount = Object.values(verdicts).filter(v => v === 'PASS').length;
const failCount = Object.values(verdicts).filter(v => v === 'FAIL').length;
const flaggedCount = Object.values(verdicts).filter(v => v === 'FLAGGED').length;

// Check 1: All pass
if (failCount === 0 && flaggedCount === 0) {
  console.log('all_pass');
  process.exit(1);
}

// Check 2: Flagged but unfixable (iteration > 1, fix-log has 0 applied)
if (failCount === 0 && flaggedCount > 0 && iteration > 1) {
  const fixLogPath = path.join(artifactsDir, 'fix-log.json');
  if (fs.existsSync(fixLogPath)) {
    try {
      const fixLog = JSON.parse(fs.readFileSync(fixLogPath, 'utf8'));
      const applied = Array.isArray(fixLog) ? fixLog : (fixLog.applied || []);
      if (applied.length === 0) {
        console.log('flagged_unfixable');
        process.exit(1);
      }
    } catch (_) { /* ignore parse errors, continue */ }
  }
}

// Check 3: Regression (iteration > 1)
if (iteration > 1) {
  const prevCsvPath = path.join(artifactsDir, `evaluation-report-iter-${iteration - 1}.csv`);
  const prevVerdicts = parseSection1Verdicts(prevCsvPath);
  if (prevVerdicts) {
    for (const [id, prevVerdict] of Object.entries(prevVerdicts)) {
      if (prevVerdict === 'PASS' && verdicts[id] === 'FAIL') {
        console.log(`regression:${id}`);
        process.exit(1);
      }
    }
  }
}

// Check 4: Max iterations
if (iteration >= maxIterations) {
  console.log('max_iterations');
  process.exit(1);
}

// Check 5: --no-iterate flag
if (noIterate) {
  console.log('no_iterate');
  process.exit(1);
}

// Check 6: --no-fix flag
if (noFix) {
  console.log('no_fix');
  process.exit(1);
}

// Otherwise: continue
console.log('continue');
process.exit(0);
