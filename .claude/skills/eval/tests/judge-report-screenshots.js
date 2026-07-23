#!/usr/bin/env node
'use strict';

/**
 * judge-report-screenshots.js
 *
 * LLM judge that reads Playwright screenshots of the evaluation report
 * and verifies each section rendered correctly. Uses Claude's vision
 * to check that data from JSON artifacts actually appears in the rendered HTML.
 *
 * Usage:
 *   node judge-report-screenshots.js <artifacts-dir> [--model=claude-sonnet-4-20250514]
 *
 * Reads:
 *   <artifacts-dir>/report-screenshots/manifest.json  — section list with assertions
 *   <artifacts-dir>/report-screenshots/*.png           — section screenshots
 *   <artifacts-dir>/journey-log.json                   — source data for cross-check
 *   <artifacts-dir>/fix-log.json
 *   <artifacts-dir>/consistency-report.json
 *   <artifacts-dir>/evaluation-summary.json
 *
 * Writes:
 *   <artifacts-dir>/report-screenshots/judge-results.json — per-section verdicts
 *
 * Exit code:
 *   0 = all sections pass
 *   1 = one or more sections fail
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const artifactsDir = process.argv[2];
if (!artifactsDir) {
  console.error('Usage: node judge-report-screenshots.js <artifacts-dir>');
  process.exit(1);
}

const absArtifacts = path.resolve(artifactsDir);
const screenshotDir = path.join(absArtifacts, 'report-screenshots');
const manifestPath = path.join(screenshotDir, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error(`Manifest not found: ${manifestPath}`);
  console.error('Run the Playwright visual verification tests first.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const modelFlag = process.argv.find(a => a.startsWith('--model='));
const model = modelFlag ? modelFlag.split('=')[1] : 'claude-sonnet-4-20250514';

function loadJson(filename) {
  const p = path.join(absArtifacts, filename);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

const sourceData = {
  journeyLog: loadJson('journey-log.json'),
  fixLog: loadJson('fix-log.json'),
  consistencyReport: loadJson('consistency-report.json'),
  evaluationSummary: loadJson('evaluation-summary.json'),
  iterationLog: loadJson('iteration-log.json'),
};

function buildSourceContext() {
  const ctx = [];
  if (sourceData.evaluationSummary) {
    const s = sourceData.evaluationSummary;
    ctx.push(`Overall: ${s.pass_count || '?'}/${s.total_count || '?'} ACs passing`);
    if (s.usability) ctx.push(`Usability score: ${s.usability.overall_score}/21`);
    if (s.usability?.personas_evaluated) ctx.push(`Personas: ${s.usability.personas_evaluated.join(', ')}`);
  }
  if (sourceData.fixLog) {
    const fl = sourceData.fixLog;
    const applied = Array.isArray(fl) ? fl : fl.applied || [];
    ctx.push(`Fixes applied: ${applied.length}`);
    for (const f of applied.slice(0, 3)) {
      ctx.push(`  - ${f.criterion_id || f.ac_id}: ${(f.description || f.change || '').slice(0, 80)}`);
    }
  }
  if (sourceData.consistencyReport?.summary) {
    const cs = sourceData.consistencyReport.summary;
    ctx.push(`Consistency: ${cs.total_guidelines_checked} guidelines, ${cs.violations} violations`);
  }
  if (sourceData.iterationLog) {
    const il = sourceData.iterationLog;
    ctx.push(`Iterations: ${il.iterations?.length || 0}, exit: ${il.exit_reason}`);
  }
  return ctx.join('\n');
}

async function judgeSection(section) {
  const imgPath = path.join(screenshotDir, section.screenshot);
  if (!fs.existsSync(imgPath)) {
    return {
      section: section.name,
      pass: false,
      reason: `Screenshot not found: ${section.screenshot}`,
      assertions: section.assertions.map(a => ({ assertion: a, pass: false, reason: 'Screenshot missing' })),
    };
  }

  const imgBase64 = fs.readFileSync(imgPath).toString('base64');
  const mimeType = 'image/png';

  const prompt = `You are a QA judge reviewing a screenshot of an evaluation report section.

## Source Data (ground truth from JSON artifacts)
${buildSourceContext()}

## Section: ${section.name}

## Assertions to verify
${section.assertions.map((a, i) => `${i + 1}. ${a}`).join('\n')}

## Instructions
Look at the screenshot and verify each assertion. For each assertion, respond with:
- "PASS" if the assertion is clearly satisfied in the screenshot
- "FAIL" if the assertion is clearly NOT satisfied
- "SKIP" if the screenshot doesn't contain the relevant area or the data is not applicable

Respond in this exact JSON format:
{
  "assertions": [
    {"index": 1, "verdict": "PASS|FAIL|SKIP", "reason": "brief explanation"},
    ...
  ],
  "overall_pass": true|false,
  "summary": "one-sentence summary of what you see"
}`;

  const requestBody = {
    model,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: imgBase64 },
        },
        { type: 'text', text: prompt },
      ],
    }],
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      section: section.name,
      pass: null,
      reason: 'ANTHROPIC_API_KEY not set — skipping LLM judge',
      assertions: section.assertions.map(a => ({ assertion: a, pass: null, reason: 'API key not set' })),
    };
  }

  try {
    const curlCmd = `curl -s -X POST https://api.anthropic.com/v1/messages \
      -H "Content-Type: application/json" \
      -H "x-api-key: ${apiKey}" \
      -H "anthropic-version: 2023-06-01" \
      -d '${JSON.stringify(requestBody).replace(/'/g, "'\\''")}'`;

    const response = JSON.parse(execSync(curlCmd, { maxBuffer: 10 * 1024 * 1024, timeout: 60000 }).toString());
    const text = response.content?.[0]?.text || '';

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        section: section.name,
        pass: false,
        reason: `LLM response not parseable: ${text.slice(0, 200)}`,
        assertions: section.assertions.map(a => ({ assertion: a, pass: false, reason: 'Unparseable response' })),
      };
    }

    const judgeResult = JSON.parse(jsonMatch[0]);
    const assertionResults = section.assertions.map((a, i) => {
      const jr = judgeResult.assertions?.find(j => j.index === i + 1);
      return {
        assertion: a,
        pass: jr?.verdict === 'PASS' ? true : jr?.verdict === 'SKIP' ? null : false,
        reason: jr?.reason || 'No judge response for this assertion',
      };
    });

    return {
      section: section.name,
      pass: judgeResult.overall_pass,
      summary: judgeResult.summary,
      reason: judgeResult.summary,
      assertions: assertionResults,
    };
  } catch (e) {
    return {
      section: section.name,
      pass: false,
      reason: `LLM judge error: ${e.message.slice(0, 200)}`,
      assertions: section.assertions.map(a => ({ assertion: a, pass: false, reason: e.message.slice(0, 100) })),
    };
  }
}

async function main() {
  console.log(`Judging ${manifest.sections.length} report sections...`);
  console.log(`Model: ${model}`);
  console.log(`Screenshots: ${screenshotDir}`);
  console.log('');

  const results = [];
  let allPass = true;

  for (const section of manifest.sections) {
    process.stdout.write(`  ${section.name}... `);
    const result = await judgeSection(section);
    results.push(result);

    if (result.pass === false) {
      allPass = false;
      console.log(`FAIL — ${result.reason}`);
    } else if (result.pass === null) {
      console.log(`SKIP — ${result.reason}`);
    } else {
      console.log(`PASS — ${result.summary || 'OK'}`);
    }
  }

  const output = {
    model,
    judged_at: new Date().toISOString(),
    all_pass: allPass,
    total: results.length,
    passed: results.filter(r => r.pass === true).length,
    failed: results.filter(r => r.pass === false).length,
    skipped: results.filter(r => r.pass === null).length,
    results,
  };

  const outputPath = path.join(screenshotDir, 'judge-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log('');
  console.log(`Results: ${output.passed} passed, ${output.failed} failed, ${output.skipped} skipped`);
  console.log(`Written to: ${outputPath}`);

  process.exit(allPass ? 0 : 1);
}

main();
