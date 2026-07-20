#!/usr/bin/env node
'use strict';

const fs = require('fs');

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: list-failing-acs.js <csv-path>');
  process.exit(1);
}

if (!fs.existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  process.exit(1);
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

const lines = fs.readFileSync(csvPath, 'utf8').split('\n');

let headerIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (/^(ac_id|criterion_id|id)/i.test(lines[i])) {
    headerIdx = i;
    break;
  }
}

if (headerIdx === -1) {
  console.error('Could not find CSV header row');
  process.exit(1);
}

const header = parseCsvLine(lines[headerIdx]);
const verdictCol = header.findIndex(h => /^verdict$/i.test(h.trim()));
const idCol = header.findIndex(h => /^(ac_id|criterion_id|id)$/i.test(h.trim()));

if (verdictCol === -1 || idCol === -1) {
  console.error('CSV missing required columns (id/ac_id/criterion_id and verdict)');
  process.exit(1);
}

const failing = [];
for (let i = headerIdx + 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  if (/^#\s*SECTION/i.test(line) || /^dimension_id/i.test(line)) break;

  const fields = parseCsvLine(line);
  const id = (fields[idCol] || '').trim();
  const verdict = (fields[verdictCol] || '').trim().toUpperCase();
  if (id && (verdict === 'FAIL' || verdict === 'FLAGGED')) {
    failing.push(id);
  }
}

console.log(failing.join(','));
