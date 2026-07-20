#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

let jsYaml;
try { jsYaml = require('js-yaml'); } catch {
  try { jsYaml = require(path.join(__dirname, '../../node_modules/js-yaml')); } catch {}
}

const artifactsDir = process.argv[2];
if (!artifactsDir) {
  console.error('Usage: node validate-all-artifacts.js <artifacts-dir>');
  console.error('  Validates JSON, CSV, and YAML files are well-formed. Checks for zero-byte files and blank PNGs.');
  process.exit(1);
}

const abs = path.resolve(artifactsDir);
if (!fs.existsSync(abs)) {
  console.error(`FAIL: directory not found: ${abs}`);
  process.exit(1);
}

let issues = 0;
let checked = 0;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

const allFiles = walk(abs);

for (const filePath of allFiles) {
  const rel = path.relative(abs, filePath);
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);

  // Zero-byte check (applies to all files)
  if (stat.size === 0) {
    console.log(`FAIL: ${rel} — zero-byte file (empty)`);
    issues++;
    continue;
  }

  if (ext === '.json') {
    checked++;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        const keys = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
        if (keys === 0) {
          console.log(`FAIL: ${rel} — JSON parses but has no keys/elements (empty object or array)`);
          issues++;
        } else {
          console.log(`PASS: ${rel} — valid JSON (${Array.isArray(parsed) ? keys + ' elements' : keys + ' keys'})`);
        }
      } else {
        console.log(`PASS: ${rel} — valid JSON (primitive value)`);
      }
    } catch (err) {
      console.log(`FAIL: ${rel} — JSON parse error: ${err.message}`);
      issues++;
    }
  } else if (ext === '.csv') {
    checked++;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const lines = raw.split('\n').filter(l => l.trim().length > 0 && !l.trim().startsWith('#'));
      if (lines.length === 0) {
        console.log(`FAIL: ${rel} — CSV has no data rows (only comments or empty)`);
        issues++;
      } else {
        const headerFields = parseCSVLine(lines[0]);
        if (headerFields.length === 0) {
          console.log(`FAIL: ${rel} — CSV header row is empty`);
          issues++;
        } else {
          let badRows = 0;
          for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim().startsWith('#')) continue;
            const fields = parseCSVLine(lines[i]);
            if (fields.length !== headerFields.length) {
              badRows++;
            }
          }
          if (badRows > 0) {
            console.log(`WARN: ${rel} — ${badRows} data row(s) have different column count than header (${headerFields.length} columns)`);
          }
          console.log(`PASS: ${rel} — valid CSV (${headerFields.length} columns, ${lines.length - 1} data rows)`);
        }
      }
    } catch (err) {
      console.log(`FAIL: ${rel} — CSV read error: ${err.message}`);
      issues++;
    }
  } else if (ext === '.yaml' || ext === '.yml') {
    checked++;
    if (!jsYaml) {
      console.log(`SKIP: ${rel} — js-yaml not available, cannot validate YAML`);
      continue;
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = jsYaml.load(raw);
      if (parsed === null || parsed === undefined) {
        console.log(`WARN: ${rel} — YAML parses to null/undefined`);
      } else {
        console.log(`PASS: ${rel} — valid YAML`);
      }
    } catch (err) {
      console.log(`FAIL: ${rel} — YAML parse error: ${err.message}`);
      issues++;
    }
  } else if (ext === '.png') {
    checked++;
    if (stat.size <= 5120) {
      console.log(`FAIL: ${rel} — PNG is ${stat.size} bytes (<=5KB, likely blank screenshot)`);
      issues++;
    } else {
      console.log(`PASS: ${rel} — PNG ${(stat.size / 1024).toFixed(1)}KB`);
    }
  }
}

console.log(`\n${'='.repeat(50)}`);
if (issues === 0) {
  console.log(`RESULT: ALL PASS — ${checked} files validated, 0 issues`);
  process.exit(0);
} else {
  console.log(`RESULT: FAIL — ${issues} issue(s) found across ${checked} files checked`);
  process.exit(1);
}

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}
