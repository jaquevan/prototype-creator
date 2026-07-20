#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const artifactsDir = process.argv[2];
if (!artifactsDir) {
  console.error('Usage: validate-fix-log.js <artifacts-dir>');
  process.exit(1);
}

const fixLogPath = path.join(artifactsDir, 'fix-log.json');

if (!fs.existsSync(fixLogPath)) {
  process.exit(0);
}

let raw;
try {
  raw = JSON.parse(fs.readFileSync(fixLogPath, 'utf8'));
} catch (e) {
  console.error(`fix-log.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

let entries;
if (Array.isArray(raw)) {
  entries = raw;
  raw = { applied: entries };
} else if (raw && Array.isArray(raw.applied)) {
  entries = raw.applied;
} else {
  console.error('fix-log.json must have a non-empty "applied" array or be a top-level array');
  process.exit(1);
}

if (entries.length === 0) {
  console.error('fix-log.json "applied" array is empty');
  process.exit(1);
}

const errors = [];
for (let i = 0; i < entries.length; i++) {
  const e = entries[i];
  if (!e || typeof e !== 'object') {
    errors.push(`Entry ${i}: not an object`);
    continue;
  }
  if (!e.criterion_id && !e.ac_id && !e.guideline_id) {
    errors.push(`Entry ${i}: missing criterion_id, ac_id, and guideline_id (need at least one)`);
  }
  if (!e.file) {
    errors.push(`Entry ${i}: missing file`);
  }
  if (!e.description && !e.rationale && !e.change) {
    errors.push(`Entry ${i}: missing description, rationale, and change (need at least one)`);
  }

  if (!e.criterion_id) {
    e.criterion_id = e.ac_id || e.guideline_id;
  }
}

if (errors.length > 0) {
  console.error(`fix-log.json validation failed:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}

fs.writeFileSync(fixLogPath, JSON.stringify(raw, null, 2));
console.log(`fix-log.json validated OK (${entries.length} entries)`);
