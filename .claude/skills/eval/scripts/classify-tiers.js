#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const artifactsDir = process.argv[2];
if (!artifactsDir) {
  console.error('Usage: node classify-tiers.js <artifacts-dir>');
  console.error('  Reads extract-state.json ac_list, writes tier assignments to evaluation-report.csv');
  process.exit(1);
}

const abs = path.resolve(artifactsDir);
const extractPath = path.join(abs, 'extract-state.json');

if (!fs.existsSync(extractPath)) {
  console.error('extract-state.json not found in ' + abs);
  process.exit(1);
}

const extractState = JSON.parse(fs.readFileSync(extractPath, 'utf8'));
const acList = extractState.ac_list || extractState.acceptance_criteria || [];

if (acList.length === 0) {
  console.error('No acceptance criteria found in extract-state.json');
  process.exit(1);
}

// Keywords that suggest backend-only (T3) when NO UI keywords are present
const BACKEND_KEYWORDS = [
  'bff', 'api rate', 'schema valid', 'request body', 'server-side',
  'database', 'backend', 'rate limit', 'request size', 'catalog yaml',
  'server response', 'http status', 'payload', 'endpoint',
];

// UI keywords — presence alongside backend keywords means T1, not T3
const UI_KEYWORDS = [
  'display', 'show', 'page', 'button', 'column', 'label',
  'error message', 'modal', 'table', 'form', 'wizard',
  'tooltip', 'tab', 'panel', 'sidebar', 'icon', 'banner',
  'notification', 'dropdown', 'menu', 'checkbox', 'toggle',
  'indicator', 'badge', 'status', 'visible', 'hidden', 'render',
];

// Keywords that suggest subjective/human-judgment (T4) when no concrete UI elements present
const SUBJECTIVE_KEYWORDS = [
  'user-friendly', 'intuitive', 'appropriate', 'natural language',
  'clear hierarchy', 'well-organized', 'easy to understand',
  'readable', 'aesthetically', 'looks good', 'feels right',
  'professional', 'polished',
];

// Concrete UI elements that override subjective classification back to T1
// e.g. "clear error message" has a concrete element ("error message")
const CONCRETE_ELEMENTS = [
  'error message', 'button', 'column', 'label', 'table', 'form',
  'modal', 'page', 'tooltip', 'tab', 'panel', 'icon', 'dropdown',
  'checkbox', 'toggle', 'indicator', 'badge', 'notification',
  'wizard', 'banner', 'sidebar', 'menu',
];

function hasKeyword(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.some(kw => {
    const pattern = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return pattern.test(lower);
  });
}

function classifyAC(acText) {
  const lower = acText.toLowerCase();

  // T3: backend keywords present AND no UI keywords
  if (hasKeyword(lower, BACKEND_KEYWORDS) && !hasKeyword(lower, UI_KEYWORDS)) {
    return 'T3';
  }

  // T4: subjective keywords present AND no concrete UI elements
  if (hasKeyword(lower, SUBJECTIVE_KEYWORDS) && !hasKeyword(lower, CONCRETE_ELEMENTS)) {
    return 'T4';
  }

  // T1: default — when in doubt, T1
  return 'T1';
}

function escapeCSV(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

const counts = { T1: 0, T3: 0, T4: 0 };
const rows = [];

for (let i = 0; i < acList.length; i++) {
  const ac = acList[i];
  const id = ac.id || ac.criterion_id || `AC-${i + 1}`;
  const source = ac.source || 'jira';
  const text = ac.text || ac.criterion_text || ac.description || '';
  const tier = classifyAC(text);

  counts[tier] = (counts[tier] || 0) + 1;

  const verdict = tier === 'T3' ? 'PASS' : '';
  const rationale = tier === 'T3' ? 'Backend-only criterion — auto-passed' : '';
  const evidence = '';
  const fixAction = '';
  const fixFile = '';
  const humanAction = tier === 'T4'
    ? 'Assess whether this criterion meets its subjective quality standard'
    : '';

  rows.push([id, source, tier, text, verdict, rationale, evidence, fixAction, fixFile, humanAction]
    .map(escapeCSV)
    .join(','));
}

const csvHeader = '# ACCEPTANCE CRITERIA\ncriterion_id,source,tier,criterion_text,verdict,rationale,evidence,fix_action,fix_file,human_action';
const csvContent = csvHeader + '\n' + rows.join('\n') + '\n';

const csvPath = path.join(abs, 'evaluation-report.csv');
fs.writeFileSync(csvPath, csvContent, 'utf8');

const total = acList.length;
console.log(`Classified ${total} criteria: ${counts.T1} T1, ${counts.T3} T3, ${counts.T4} T4`);
