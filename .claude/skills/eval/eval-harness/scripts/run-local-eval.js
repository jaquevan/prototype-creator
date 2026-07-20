#!/usr/bin/env node
'use strict';

/**
 * Lightweight local eval runner for deterministic skills.
 * Runs the skill's script directly, then evaluates check judges from eval.yaml.
 *
 * Usage: node run-local-eval.js <config.yaml> <skill-script> [script-args...]
 *
 * Example:
 *   node run-local-eval.js configs/eval-classify.yaml \
 *     ../../scripts/classify-tiers.js {artifacts_dir}
 *
 * The {artifacts_dir} placeholder is replaced per-case with a temp dir
 * containing the case's fixture files.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
let jsYaml;
for (const tryPath of ['js-yaml', path.join(__dirname, '../../node_modules/js-yaml')]) {
  try { jsYaml = require(tryPath); break; } catch {}
}

const HARNESS_ROOT = path.resolve(__dirname, '..');
const configPath = process.argv[2];
const skillScript = process.argv[3];

if (!configPath || !skillScript) {
  console.error('Usage: node run-local-eval.js <config.yaml> <skill-script>');
  process.exit(1);
}

function loadYaml(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  try {
    const y = require('js-yaml');
    return y.load(content);
  } catch {
    const lines = content.split('\n');
    const result = {};
    for (const line of lines) {
      const match = line.match(/^(\w[\w_]*)\s*:\s*(.+)/);
      if (match) {
        let val = match[2].trim();
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (/^\d+$/.test(val)) val = parseInt(val);
        else if (/^\[.*\]$/.test(val)) {
          try { val = JSON.parse(val.replace(/'/g, '"')); } catch {}
        }
        result[match[1]] = val;
      }
    }
    return result;
  }
}

function parseYamlConfig(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  try {
    const y = require('js-yaml');
    return y.load(content);
  } catch {
    console.error('js-yaml not available, using basic parser');
    return { judges: [] };
  }
}

const config = parseYamlConfig(path.resolve(configPath));
const datasetPath = path.resolve(config.dataset?.path || '');

if (!fs.existsSync(datasetPath)) {
  console.error(`Dataset path not found: ${datasetPath}`);
  process.exit(1);
}

const caseDirs = fs.readdirSync(datasetPath)
  .filter(d => fs.statSync(path.join(datasetPath, d)).isDirectory())
  .sort();

console.log(`\n${'='.repeat(60)}`);
console.log(`EVAL: ${config.name || 'unknown'}`);
console.log(`Cases: ${caseDirs.length}`);
console.log(`Judges: ${(config.judges || []).length}`);
console.log(`${'='.repeat(60)}\n`);

const results = [];

for (const caseId of caseDirs) {
  const caseDir = path.join(datasetPath, caseId);
  console.log(`--- ${caseId} ---`);

  const annotationsPath = path.join(caseDir, 'annotations.yaml');
  const annotations = fs.existsSync(annotationsPath) ? loadYaml(annotationsPath) : {};

  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'eval-'));
  const fixturesDir = path.join(caseDir, 'fixtures');
  if (fs.existsSync(fixturesDir)) {
    for (const f of fs.readdirSync(fixturesDir)) {
      fs.copyFileSync(path.join(fixturesDir, f), path.join(tmpDir, f));
    }
  }

  const scriptCmd = skillScript.replace(/\{artifacts_dir\}/g, tmpDir);
  let scriptOutput = '';
  let scriptExitCode = 0;
  try {
    scriptOutput = execSync(`node ${scriptCmd}`, {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30000,
    });
    console.log(`  Script: ${scriptOutput.trim()}`);
  } catch (err) {
    scriptExitCode = err.status || 1;
    scriptOutput = err.stdout || '';
    console.log(`  Script FAILED (exit ${scriptExitCode}): ${(err.stderr || '').trim()}`);
  }

  const outputFiles = {};
  if (fs.existsSync(tmpDir)) {
    for (const f of fs.readdirSync(tmpDir)) {
      const fp = path.join(tmpDir, f);
      if (fs.statSync(fp).isFile()) {
        outputFiles[f] = fs.readFileSync(fp, 'utf8');
      }
    }
  }

  const outputs = {
    files: outputFiles,
    annotations,
    exit_code: scriptExitCode,
    conversation: scriptOutput,
    cost_usd: 0,
    num_turns: 1,
    duration_s: 0,
  };

  const caseResults = { case: caseId, judges: {} };

  for (const judge of (config.judges || [])) {
    if (!judge.check) continue;

    try {
      const checkResult = evalCheckJudge(judge.check, outputs, judge.arguments || {});
      const passed = checkResult[0];
      const reason = checkResult[1];
      caseResults.judges[judge.name] = { passed, reason };
      const icon = passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
      console.log(`  ${icon} ${judge.name}: ${reason}`);
    } catch (err) {
      caseResults.judges[judge.name] = { passed: false, reason: `ERROR: ${err.message}` };
      console.log(`  \x1b[31mERROR\x1b[0m ${judge.name}: ${err.message}`);
    }
  }

  results.push(caseResults);

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('');
}

console.log(`${'='.repeat(60)}`);
console.log('SUMMARY');
console.log(`${'='.repeat(60)}`);

let totalPassed = 0;
let totalFailed = 0;

for (const r of results) {
  const judges = Object.entries(r.judges);
  const passed = judges.filter(([, v]) => v.passed).length;
  const failed = judges.filter(([, v]) => !v.passed).length;
  totalPassed += passed;
  totalFailed += failed;
  const icon = failed === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${icon} ${r.case}: ${passed}/${judges.length} judges passed`);
}

console.log(`\nTotal: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed > 0 ? 1 : 0);

function evalCheckJudge(code, outputs, args) {
  const tmpScript = path.join(require('os').tmpdir(), `judge-${Date.now()}.py`);
  const indentedCode = code.split('\n').map(l => '    ' + l).join('\n');
  const tmpOutputs = tmpScript + '.outputs.json';
  const tmpArgs = tmpScript + '.args.json';
  const wrapper = `
import json, sys, pathlib
outputs = json.loads(pathlib.Path(sys.argv[1]).read_text())
arguments = json.loads(pathlib.Path(sys.argv[2]).read_text())
def _run(outputs, arguments):
${indentedCode}
result = _run(outputs, arguments)
print(json.dumps(result))
`;
  fs.writeFileSync(tmpScript, wrapper, 'utf8');
  fs.writeFileSync(tmpOutputs, JSON.stringify(outputs), 'utf8');
  fs.writeFileSync(tmpArgs, JSON.stringify(args), 'utf8');
  try {
    const result = execSync(
      `python3 ${tmpScript} ${tmpOutputs} ${tmpArgs}`,
      { encoding: 'utf8', timeout: 15000, maxBuffer: 10 * 1024 * 1024 }
    );
    const lines = result.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    try {
      return JSON.parse(lastLine);
    } catch {
      return [false, `Could not parse judge output: ${lastLine}`];
    }
  } finally {
    try { fs.unlinkSync(tmpScript); } catch {}
    try { fs.unlinkSync(tmpOutputs); } catch {}
    try { fs.unlinkSync(tmpArgs); } catch {}
  }
}
