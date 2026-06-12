#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const artifactsDir = process.argv[2];
if (!artifactsDir) {
  console.error('Usage: node scripts/render-report.js <artifacts-dir>');
  console.error('  e.g. node scripts/render-report.js .artifacts/RHAISTRAT-1536/');
  process.exit(1);
}

const absArtifacts = path.resolve(artifactsDir);
const projectRoot = path.resolve(__dirname, '..');
const templatePath = path.join(projectRoot, 'templates', 'evaluation-report.html');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFileOr(filePath, fallback) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return fallback; }
}

function readJsonOr(filePath, fallback) {
  const raw = readFileOr(filePath, null);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badgeHtml(verdict) {
  const v = String(verdict).toUpperCase();
  const cls = v === 'PASS' ? 'badge-pass' : v === 'FAIL' ? 'badge-fail' : 'badge-flagged';
  return `<span class="badge ${cls}">${v}</span>`;
}

function extractPrototypeId() {
  return path.basename(absArtifacts);
}

// ---------------------------------------------------------------------------
// Parse CSV
// ---------------------------------------------------------------------------

function parseCsv(raw) {
  if (!raw) return [];
  const lines = raw.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });
}

function parseCSVLine(line) {
  const result = [];
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
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// Parse markdown sections
// ---------------------------------------------------------------------------

function extractMdSection(md, heading) {
  if (!md) return '';
  const regex = new RegExp(`^(#{1,3})\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im');
  const match = md.match(regex);
  if (!match) return '';
  const headingLevel = match[1].length;
  const start = match.index + match[0].length;
  const sameOrHigher = new RegExp(`^#{1,${headingLevel}}\\s`, 'm');
  const nextHeading = md.slice(start).search(sameOrHigher);
  const section = nextHeading === -1 ? md.slice(start) : md.slice(start, start + nextHeading);
  return section.trim();
}

function mdToHtml(text) {
  if (!text) return '';
  let html = text;

  // Convert markdown tables to HTML tables
  html = html.replace(/^(\|.+\|)\n(\|[\s:|-]+\|)\n((?:\|.+\|\n?)+)/gm, (match, header, sep, body) => {
    const ths = header.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
    const rows = body.trim().split('\n').map(row => {
      const tds = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    return `<table class="tbl"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Convert ### headings to h4 (inside cards they're subsections)
  html = html.replace(/^### (.+)$/gm, '</p><h4>$1</h4><p>');

  // Convert numbered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/gs, m => `<ol>${m}</ol>`);

  // Inline formatting
  html = html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Bullet lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>(?:(?!<\/ol>).)*<\/li>\n?)+/gs, m => {
    if (m.includes('<ol>')) return m;
    return `<ul>${m}</ul>`;
  });

  // Paragraphs
  html = html
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');

  // Clean up empty/nested tags
  html = html
    .replace(/<p><\/p>/g, '')
    .replace(/<p>(<ul>)/g, '$1')
    .replace(/(<\/ul>)<\/p>/g, '$1')
    .replace(/<p>(<ol>)/g, '$1')
    .replace(/(<\/ol>)<\/p>/g, '$1')
    .replace(/<p>(<table)/g, '$1')
    .replace(/(<\/table>)<\/p>/g, '$1')
    .replace(/<p>(<h4>)/g, '$1')
    .replace(/(<\/h4>)<\/p>/g, '$1');

  return html;
}

// ---------------------------------------------------------------------------
// Encode screenshots
// ---------------------------------------------------------------------------

function loadScreenshots(screenshotsDir) {
  const map = {};
  if (!fs.existsSync(screenshotsDir)) return map;
  const files = fs.readdirSync(screenshotsDir).filter(f => f.endsWith('.png')).sort();
  for (const file of files) {
    const data = fs.readFileSync(path.join(screenshotsDir, file));
    map[file] = 'data:image/png;base64,' + data.toString('base64');
  }
  return map;
}

// ---------------------------------------------------------------------------
// Build tokens
// ---------------------------------------------------------------------------

function buildTokens() {
  const protoId = extractPrototypeId();
  const csvRaw = readFileOr(path.join(absArtifacts, 'evaluation-report.csv'), '');
  const journeyLog = readJsonOr(path.join(absArtifacts, 'journey-log.json'), null);
  const mdRaw = readFileOr(path.join(absArtifacts, 'evaluation-report.md'), '');
  const screenshotsDir = path.join(absArtifacts, 'screenshots');
  const screenshots = loadScreenshots(screenshotsDir);

  const csvRows = parseCsv(csvRaw);

  // Gather think-aloud files
  const taFiles = [];
  try {
    const allFiles = fs.readdirSync(absArtifacts);
    for (const f of allFiles) {
      if (f.startsWith('usability-thinkaloud-') && f.endsWith('.md')) {
        taFiles.push({ name: f, content: readFileOr(path.join(absArtifacts, f), '') });
      }
    }
  } catch {}

  // Counts
  let passCount = 0, failCount = 0, flaggedCount = 0;
  for (const r of csvRows) {
    const v = (r.verdict || '').toUpperCase();
    if (v === 'PASS') passCount++;
    else if (v === 'FAIL') failCount++;
    else if (v === 'FLAGGED') flaggedCount++;
  }

  // Journey info
  const journeys = journeyLog ? journeyLog.journeys || [] : [];
  const journeyPass = journeys.filter(j => j.verdict === 'PASS').length;
  const journeyTotal = journeys.length;
  const journeyRatio = `${journeyPass}/${journeyTotal}`;

  // Usability
  const ud = journeyLog ? journeyLog.usability_dimensions : null;
  const usabilityScore = ud ? ud.overall_score || '—' : '—';

  // Description from md
  const storyLine = mdRaw.match(/\*\*Story\*\*:\s*(.+)/);
  const storyTitle = storyLine ? storyLine[1].trim() : protoId;
  const depthLine = mdRaw.match(/\*\*Depth\*\*:\s*(.+)/);
  const depth = depthLine ? depthLine[1].trim() : 'quick';
  const evalDateLine = mdRaw.match(/\*\*Evaluated at\*\*:\s*(.+)/);
  const evalDateRaw = evalDateLine ? evalDateLine[1].trim() : (journeyLog ? journeyLog.evaluated_at || '' : '');
  const evalDate = evalDateRaw ? new Date(evalDateRaw).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  let description = '';
  const conclusionBody = extractMdSection(mdRaw, 'Conclusion');
  if (conclusionBody) {
    const firstPara = conclusionBody.split('\n').find(l => l.trim() && !l.trim().startsWith('#'));
    if (firstPara) description = firstPara.trim();
  }
  if (!description) {
    const methodMatch = mdRaw.match(/This evaluation checks\b[^\n]*/i);
    if (methodMatch) description = methodMatch[0].trim();
  }
  if (!description) {
    description = storyTitle !== protoId ? `${storyTitle} — prototype evaluation` : `Evaluation of ${protoId}`;
  }

  const failedIds = csvRows
    .filter(r => (r.verdict || '').toUpperCase() === 'FAIL')
    .map(r => {
      const id = r.criterion_id || '?';
      const text = r.criterion_text || '';
      const short = text.length > 20 ? text.slice(0, 20).replace(/\s+\S*$/, '') : text;
      return short ? `${id} (${short})` : id;
    });
  const failPart = failedIds.length ? failedIds.join(', ') : `${failCount} fail`;
  const flagPart = flaggedCount ? `${flaggedCount} flagged for human review` : '';
  const gapsSummary = [failPart, flagPart].filter(Boolean).join(' · ');
  const journeySummary = `${journeyPass}/${journeyTotal} completed`;

  const jiraUrl = `https://issues.redhat.com/browse/${protoId}`;
  const prototypeUrl = journeyLog ? journeyLog.prototype_url || '#' : '#';

  // ---- AC Table Rows ----
  const acTableRows = csvRows.map(r => {
    const id = escapeHtml(r.criterion_id);
    const story = escapeHtml(r.story_id);
    const criterion = escapeHtml(r.criterion_text);
    const tier = escapeHtml(r.tier);
    const verdict = badgeHtml(r.verdict);
    const rationale = escapeHtml(r.rationale);
    return `<tr><td><strong>${id}</strong></td><td>${story}</td><td>${criterion}</td><td>${tier}</td><td>${verdict}</td><td class="small">${rationale}</td></tr>`;
  }).join('\n');

  // ---- Breadcrumb ----
  let breadcrumbHtml = '';
  if (journeyLog && journeyLog.breadcrumb) {
    const bc = journeyLog.breadcrumb;
    const parts = [];
    if (bc.rfe) parts.push(`<a href="${escapeHtml(bc.rfe.url)}">${escapeHtml(bc.rfe.key)}</a>`);
    if (bc.strat) parts.push(`<a href="${escapeHtml(bc.strat.url)}">${escapeHtml(bc.strat.key)}</a>`);
    if (bc.mr) parts.push(`<a href="${escapeHtml(bc.mr.url)}">${escapeHtml(bc.mr.id)}</a>`);
    else if (bc.prototype) parts.push(`<a href="${escapeHtml(bc.prototype.url)}">${escapeHtml(bc.prototype.label)}</a>`);
    parts.push('Eval Report');
    breadcrumbHtml = parts.join('<span class="sep">→</span>');
  } else {
    const rfeMatch = mdRaw.match(/RHAIRFE-\d+/);
    const rfeKey = rfeMatch ? rfeMatch[0] : null;
    const parts = [];
    if (rfeKey) {
      parts.push(`<a href="https://issues.redhat.com/browse/${rfeKey}">${rfeKey} (RFE)</a>`);
    }
    parts.push(`<a href="${escapeHtml(jiraUrl)}">${escapeHtml(protoId)} (STRAT)</a>`);
    if (journeyLog && journeyLog.prototype_url) {
      parts.push(`<a href="${escapeHtml(journeyLog.prototype_url)}">Prototype</a>`);
    }
    parts.push('<strong>Eval Report</strong>');
    breadcrumbHtml = parts.join('<span class="sep"> → </span>');
  }

  // ---- Screenshot array for modal JS ----
  const screenshotArray = [];
  let screenshotIdx = 0;
  const screenshotIndexMap = {};

  function registerScreenshot(filename, narration) {
    const src = screenshots[filename];
    if (!src) return -1;
    const idx = screenshotIdx++;
    screenshotIndexMap[filename] = idx;
    screenshotArray.push({ src, narration: narration || '', filename });
    return idx;
  }

  // ---- Journey Blocks ----
  let journeyBlocksHtml = '';
  const pathRows = [];

  for (const journey of journeys) {
    const divider = journeyBlocksHtml ? '<div class="journey-divider"></div>' : '';
    let block = `${divider}<h3>${escapeHtml(journey.title)}</h3>`;
    block += `<p class="small muted"><strong>Persona:</strong> ${escapeHtml(journey.persona)} · <strong>Source:</strong> ${escapeHtml(journey.source)} · <strong>Verdict:</strong> ${badgeHtml(journey.verdict)}</p>`;

    const steps = journey.steps || [];
    for (const step of steps) {
      block += `<div style="margin:1rem 0">`;
      block += `<p class="small"><strong>Step ${step.step}</strong> — ${escapeHtml(step.action)} → <code>${escapeHtml(step.target)}</code> · ${badgeHtml(step.result === 'success' ? 'PASS' : 'FAIL')}`;
      if (step.timestamp_ms !== undefined) block += ` · <span class="mono muted">${step.timestamp_ms}ms</span>`;
      block += `</p>`;

      if (step.screenshot) {
        const filename = path.basename(step.screenshot);
        const idx = registerScreenshot(filename, step.narration || '');
        if (idx >= 0) {
          block += `<div class="screenshot" data-idx="${idx}"><img src="${screenshots[filename]}" alt="Step ${step.step}"></div>`;
        }
      }

      if (step.narration) {
        block += `<div class="narration">${escapeHtml(step.narration)}</div>`;
      }

      if (step.error) {
        block += `<div class="ta-callout ta-callout-confusion"><strong>Error:</strong> ${escapeHtml(step.error)}</div>`;
      }
      if (step.root_cause) {
        block += `<div class="ta-callout ta-callout-expected"><strong>Root cause:</strong> ${escapeHtml(step.root_cause)}</div>`;
      }

      block += `</div>`;
    }

    journeyBlocksHtml += block;

    const matchPct = journey.steps_expected > 0
      ? Math.round((journey.steps_completed / journey.steps_expected) * 100) + '%'
      : '—';
    const drift = journey.verdict === 'PASS' ? '—' : `Blocked at step ${(steps.find(s => s.result !== 'success') || {}).step || '?'}`;
    pathRows.push(`<tr><td>${escapeHtml(journey.title)}</td><td>${escapeHtml(journey.persona)}</td><td>${journey.steps_expected}</td><td>${journey.steps_completed}</td><td>${matchPct}</td><td class="small">${escapeHtml(drift)}</td></tr>`);
  }

  const pathComparisonTable = pathRows.length
    ? `<table class="tbl mb1"><thead><tr><th>Journey</th><th>Persona</th><th>Expected</th><th>Actual</th><th>Match</th><th>Drift Notes</th></tr></thead><tbody>${pathRows.join('\n')}</tbody></table>`
    : '';

  // ---- Usability Table ----
  let usabilityTable = '';
  let personaSensitivity = '';
  let patienceTracking = '';

  if (ud && ud.dimensions) {
    const personas = ud.personas_evaluated || [];
    let thHeaders = '<th>Dimension</th>';
    for (const p of personas) thHeaders += `<th>${escapeHtml(p)}</th>`;
    thHeaders += '<th>Composite</th><th>Confidence</th><th>Key Finding</th>';

    let tbodyRows = '';
    const sensitivityItems = [];

    for (const dim of ud.dimensions) {
      let row = `<td>${escapeHtml(dim.name)}</td>`;
      const scores = [];
      let anyConf = '';

      for (const p of personas) {
        const s = dim.scores[p];
        if (s) {
          row += `<td>${s.score}/3</td>`;
          scores.push(s.score);
          anyConf = s.confidence || anyConf;
        } else {
          row += `<td>—</td>`;
        }
      }

      row += `<td><strong>${dim.composite_score}/3</strong></td>`;
      row += `<td>${escapeHtml(anyConf)}</td>`;
      const finding = dim.scores[personas[0]] ? dim.scores[personas[0]].finding : '';
      row += `<td class="small">${escapeHtml(finding)}</td>`;
      tbodyRows += `<tr>${row}</tr>`;

      if (scores.length >= 2) {
        const maxS = Math.max(...scores);
        const minS = Math.min(...scores);
        if (maxS - minS >= 1) {
          sensitivityItems.push(`<li><strong>${escapeHtml(dim.name)}</strong>: scores range ${minS}/3 to ${maxS}/3 across personas</li>`);
        }
      }
    }

    usabilityTable = `<table class="tbl"><thead><tr>${thHeaders}</tr></thead><tbody>${tbodyRows}</tbody></table>`;

    if (sensitivityItems.length) {
      personaSensitivity = `<h3>Persona Sensitivity</h3><div class="card card-warning"><ul>${sensitivityItems.join('')}</ul></div>`;
    }

    // Patience tracking
    const overlays = ud.persona_overlays || [];
    if (overlays.length) {
      let pRows = '';
      for (const o of overlays) {
        const friction = o.confusion_events && o.confusion_events.length
          ? escapeHtml(o.confusion_events[0].trigger)
          : 'None';
        pRows += `<tr><td>${escapeHtml(o.persona_name || o.persona)}</td><td>${escapeHtml(o.journey_id)}</td><td>100%</td><td>${o.patience_end}%</td><td>${o.abandoned ? 'Yes' : 'No'}</td><td>${o.confusion_events ? o.confusion_events.length : 0}</td><td class="small">${friction}</td></tr>`;
      }
      patienceTracking = `<h3>Patience Tracking</h3><table class="tbl"><thead><tr><th>Persona</th><th>Journey</th><th>Start</th><th>End</th><th>Abandoned</th><th>Confusion</th><th>Key Friction</th></tr></thead><tbody>${pRows}</tbody></table>`;
    }
  }

  // ---- Think-Aloud Comparison (INF vs TA) ----
  let thinkAloudComparison = '';
  if (ud && ud.think_aloud && ud.think_aloud.traces && ud.think_aloud.traces.length > 0) {
    const dimNames = {
      workflow_continuity: 'Workflow Continuity',
      cross_persona_handoffs: 'Cross-Persona Handoffs',
      scalability_progressive_complexity: 'Scalability & Complexity',
      system_status_trust: 'System Status & Trust',
      technical_abstraction: 'Technical Abstraction',
      mental_model_fidelity: 'Mental Model Fidelity',
      accessibility_inclusion: 'Accessibility'
    };

    const infDims = {};
    if (ud.dimensions) {
      for (const d of ud.dimensions) {
        infDims[d.id] = d.composite_score;
      }
    }

    let compRows = '';
    const taAvg = {};
    for (const trace of ud.think_aloud.traces) {
      if (trace.dimension_scores) {
        for (const [key, val] of Object.entries(trace.dimension_scores)) {
          if (!taAvg[key]) taAvg[key] = { sum: 0, count: 0 };
          taAvg[key].sum += val.score;
          taAvg[key].count++;
        }
      }
    }

    for (const [key, label] of Object.entries(dimNames)) {
      const inf = infDims[key] !== undefined ? infDims[key] : '—';
      const ta = taAvg[key] ? (taAvg[key].sum / taAvg[key].count).toFixed(1) : '—';
      const delta = (inf !== '—' && ta !== '—') ? (parseFloat(ta) - parseFloat(inf)).toFixed(1) : '—';
      const deltaStr = delta !== '—' && parseFloat(delta) !== 0 ? (parseFloat(delta) > 0 ? '+' + delta : delta) : '0';
      compRows += `<tr><td>${label}</td><td>${inf}/3</td><td>${ta}/3</td><td><strong>${deltaStr}</strong></td></tr>`;
    }

    thinkAloudComparison = `<h2>INF vs Think-Aloud Comparison</h2><table class="tbl"><thead><tr><th>Dimension</th><th>INF Score</th><th>TA Score</th><th>Delta</th></tr></thead><tbody>${compRows}</tbody></table>`;
  }

  // ---- Think-Aloud Narratives ----
  let thinkAloudNarratives = '';
  if (ud && ud.think_aloud && ud.think_aloud.traces && ud.think_aloud.traces.length > 0) {
    thinkAloudNarratives = '<h2>Think-Aloud Narratives</h2>';

    for (const trace of ud.think_aloud.traces) {
      const pName = escapeHtml(trace.persona_name || trace.persona);
      const outcome = escapeHtml(trace.outcome || '');
      const patience = trace.patience_end || 0;
      const patienceClass = patience > 60 ? 'ta-patience-high' : patience > 30 ? 'ta-patience-med' : 'ta-patience-low';

      thinkAloudNarratives += `<details><summary>${pName} — ${outcome}</summary>`;
      thinkAloudNarratives += `<p class="small muted">Patience: ${patience}% · Confusion: ${trace.confusion_events || 0} · CLI escapes: ${trace.cli_escapes || 0}</p>`;

      if (trace.response_strategies) {
        const rs = trace.response_strategies;
        thinkAloudNarratives += `<p class="small muted">Strategies: `;
        if (rs.guess_and_continue) thinkAloudNarratives += `<span class="ta-strategy ta-strategy-guess">${rs.guess_and_continue} guess</span> `;
        if (rs.help_seeking) thinkAloudNarratives += `<span class="ta-strategy ta-strategy-help">${rs.help_seeking} help</span> `;
        if (rs.abandon) thinkAloudNarratives += `<span class="ta-strategy ta-strategy-abandon">${rs.abandon} abandon</span> `;
        thinkAloudNarratives += `</p>`;
      }

      // Parse the think-aloud MD file for this persona if available
      const taFile = taFiles.find(f => f.name.includes(trace.persona));
      if (taFile && taFile.content) {
        const steps = parseTaSteps(taFile.content);
        for (const step of steps) {
          thinkAloudNarratives += renderTaStep(step);
        }
      }

      // Expected vs Actual
      if (trace.expected_vs_actual && trace.expected_vs_actual.length) {
        for (const ea of trace.expected_vs_actual) {
          thinkAloudNarratives += `<div class="ta-callout ta-callout-expected"><strong>Expected vs Actual (Step ${ea.step})</strong><br>Expected: ${escapeHtml(ea.expected)}<br>Actual: ${escapeHtml(ea.actual)}<br>Impact: ${escapeHtml(ea.impact)}</div>`;
        }
      }

      // Missing feedback
      if (trace.missing_feedback && trace.missing_feedback.length) {
        for (const mf of trace.missing_feedback) {
          thinkAloudNarratives += `<div class="ta-callout ta-callout-feedback"><strong>Missing Feedback (Step ${mf.step})</strong><br>${escapeHtml(mf.context)}</div>`;
        }
      }

      // Patience bar
      thinkAloudNarratives += `<div class="ta-patience ${patienceClass}"><span class="ta-patience-bar"><span class="ta-patience-fill" style="width:${patience}%"></span></span> ${patience}%</div>`;

      thinkAloudNarratives += `</details>`;
    }
  }

  // ---- Flagged HTML ----
  const flaggedRows = csvRows.filter(r => (r.verdict || '').toUpperCase() === 'FLAGGED');
  let flaggedHtml = '';
  if (flaggedRows.length) {
    let rows = '';
    for (const r of flaggedRows) {
      rows += `<tr><td><strong>${escapeHtml(r.criterion_id)}</strong></td><td class="small">${escapeHtml(r.criterion_text)}</td><td>${escapeHtml(r.tier)}</td><td class="small">${escapeHtml(r.rationale)}</td><td class="small">${escapeHtml(r.human_action)}</td></tr>`;
    }
    flaggedHtml = `<table class="tbl"><thead><tr><th>ID</th><th>Criterion</th><th>Tier</th><th>Why Flagged</th><th>Action Needed</th></tr></thead><tbody>${rows}</tbody></table>`;
  } else {
    flaggedHtml = '<p class="muted">No items flagged for human review.</p>';
  }

  // ---- Methodology ----
  const methodologySection = extractMdSection(mdRaw, 'How This Evaluation Was Conducted');
  const methodologyHtml = methodologySection ? mdToHtml(methodologySection) : '<p>Methodology details not available.</p>';

  // ---- Conclusion ----
  const conclusionSection = extractMdSection(mdRaw, 'Conclusion');
  const conclusionHtml = conclusionSection ? mdToHtml(conclusionSection) : '<p>Conclusion not available.</p>';

  // ---- AI Insights ----
  const aiInsightsSection = extractMdSection(mdRaw, 'Key Diagnostic Insights');
  const aiInsights = aiInsightsSection ? mdToHtml(aiInsightsSection) : '';
  const aiInsightsDisplay = aiInsights ? '' : 'display:none';

  // ---- Screenshot array for JS ----
  const screenshotArrayStr = screenshotArray.map(s =>
    `{src:${JSON.stringify(s.src)},narration:${JSON.stringify(s.narration)},filename:${JSON.stringify(s.filename)}}`
  ).join(',\n');

  // ---- CSV data for download ----
  const csvDataEscaped = csvRaw.replace(/`/g, '\\`').replace(/\\/g, '\\\\').replace(/\$/g, '\\$');

  // Build link URLs
  const rfeKeyMatch = mdRaw.match(/RHAIRFE-\d+/);
  const rfeKey = rfeKeyMatch ? rfeKeyMatch[0] : '';
  const rfeUrl = rfeKey ? `https://issues.redhat.com/browse/${rfeKey}` : jiraUrl;
  const protoRepoUrl = 'https://gitlab.cee.redhat.com/uxd/prototypes/rhoai/-/tree/3.5';
  const mrUrl = 'https://gitlab.cee.redhat.com/uxd/prototypes/rhoai/-/merge_requests';

  return {
    '{{PROTOTYPE_ID}}': protoId,
    '{{JIRA_URL}}': jiraUrl,
    '{{PROTOTYPE_URL}}': prototypeUrl,
    '{{RFE_URL}}': rfeUrl,
    '{{PROTOTYPE_REPO_URL}}': protoRepoUrl,
    '{{MR_URL}}': mrUrl,
    '{{DESCRIPTION}}': escapeHtml(description),
    '{{STORY_TITLE}}': escapeHtml(storyTitle),
    '{{DEPTH}}': escapeHtml(depth),
    '{{EVAL_DATE}}': escapeHtml(evalDate),
    '{{USABILITY_SCORE}}': escapeHtml(String(usabilityScore)),
    '{{JOURNEY_SUMMARY}}': escapeHtml(journeySummary),
    '{{GAPS_SUMMARY}}': escapeHtml(gapsSummary),
    '{{PASS_COUNT}}': String(passCount),
    '{{FAIL_COUNT}}': String(failCount),
    '{{FLAGGED_COUNT}}': String(flaggedCount),
    '{{JOURNEY_RATIO}}': journeyRatio,
    '{{BREADCRUMB_HTML}}': breadcrumbHtml,
    '{{AC_TABLE_ROWS}}': acTableRows,
    '{{METHODOLOGY_HTML}}': methodologyHtml,
    '{{USABILITY_TABLE}}': usabilityTable,
    '{{PERSONA_SENSITIVITY}}': personaSensitivity,
    '{{PATIENCE_TRACKING}}': patienceTracking,
    '{{THINK_ALOUD_COMPARISON}}': thinkAloudComparison,
    '{{PATH_COMPARISON_TABLE}}': pathComparisonTable,
    '{{JOURNEY_BLOCKS}}': journeyBlocksHtml,
    '{{THINK_ALOUD_NARRATIVES}}': thinkAloudNarratives,
    '{{FLAGGED_HTML}}': flaggedHtml,
    '{{CONCLUSION_HTML}}': conclusionHtml,
    '{{AI_INSIGHTS}}': aiInsights,
    '{{AI_INSIGHTS_DISPLAY}}': aiInsightsDisplay,
    '{{CSV_DATA}}': csvDataEscaped,
    '{{SCREENSHOT_ARRAY}}': screenshotArrayStr,
    '{{TA_TAB_DISPLAY}}': thinkAloudNarratives ? '' : 'display:none'
  };
}

// ---------------------------------------------------------------------------
// Parse think-aloud markdown into step objects
// ---------------------------------------------------------------------------

function parseTaSteps(md) {
  const steps = [];
  const stepRegex = /^###\s+STEP\s+(\d+)\s*[—–-]\s*(.+)$/gm;
  let match;
  const positions = [];

  while ((match = stepRegex.exec(md)) !== null) {
    positions.push({ index: match.index, num: match[1], title: match[2], fullMatch: match[0] });
  }

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index + positions[i].fullMatch.length;
    const end = i + 1 < positions.length ? positions[i + 1].index : md.length;
    const body = md.slice(start, end).trim();

    const seeMatch = body.match(/\*\*What I see\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*|\n###|\n---|\n\n>|$)/);
    const thinkMatch = body.match(/\*\*What I'm thinking\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*|\n###|\n---|\n\n>|$)/);
    const confMatch = body.match(/\*\*Confidence\*\*:\s*(.*)/);
    const patMatch = body.match(/\*\*Patience\*\*:\s*(\d+)%/);

    const confusions = [];
    const expectedActuals = [];
    const missingFeedback = [];
    const strategies = [];

    const confusionRegex = />\s*\*\*Confusion\*\*\s*[—–-]\s*([\s\S]*?)(?=\n>|\n\n|\n###|\n---|$)/g;
    let cm;
    while ((cm = confusionRegex.exec(body)) !== null) {
      confusions.push(cm[1].trim());
    }

    const eaRegex = />\s*\*\*Expected vs Actual\*\*\s*[—–-]\s*([\s\S]*?)(?=\n>|\n\n|\n###|\n---|$)/g;
    while ((cm = eaRegex.exec(body)) !== null) {
      expectedActuals.push(cm[1].trim());
    }

    const mfRegex = />\s*\*\*Missing feedback\*\*\s*[—–-]\s*([\s\S]*?)(?=\n>|\n\n|\n###|\n---|$)/g;
    while ((cm = mfRegex.exec(body)) !== null) {
      missingFeedback.push(cm[1].trim());
    }

    const stratRegex = /ta-strategy-(\w+)/g;
    while ((cm = stratRegex.exec(body)) !== null) {
      strategies.push(cm[1]);
    }

    steps.push({
      num: positions[i].num,
      title: positions[i].title,
      see: seeMatch ? seeMatch[1].trim() : '',
      think: thinkMatch ? thinkMatch[1].trim() : '',
      confidence: confMatch ? confMatch[1].replace(/<[^>]+>/g, '').trim().toLowerCase() : '',
      patience: patMatch ? parseInt(patMatch[1], 10) : null,
      confusions,
      expectedActuals,
      missingFeedback,
      strategies
    });
  }

  return steps;
}

function renderTaStep(step) {
  const pClass = step.patience !== null
    ? (step.patience > 60 ? 'ta-patience-high' : step.patience > 30 ? 'ta-patience-med' : 'ta-patience-low')
    : '';

  const confClass = step.confidence.includes('high') ? 'ta-confidence-high'
    : step.confidence.includes('none') ? 'ta-confidence-none'
    : 'ta-confidence-low';

  let html = `<div class="ta-step">`;
  html += `<div class="ta-step-head">Step ${step.num} — ${escapeHtml(step.title)}</div>`;

  if (step.think) {
    html += `<div class="ta-think">${escapeHtml(step.think.substring(0, 300))}${step.think.length > 300 ? '...' : ''}</div>`;
  }

  html += `<div style="display:flex;gap:1rem;align-items:center;margin-top:0.35rem">`;
  if (step.confidence) {
    html += `<span class="ta-confidence ${confClass}">${escapeHtml(step.confidence)}</span>`;
  }
  if (step.patience !== null) {
    html += `<span class="ta-patience ${pClass}"><span class="ta-patience-bar"><span class="ta-patience-fill" style="width:${step.patience}%"></span></span> ${step.patience}%</span>`;
  }
  html += `</div>`;

  for (const c of step.confusions) {
    const stratMatch = step.strategies.length ? step.strategies.shift() : '';
    html += `<div class="ta-callout ta-callout-confusion"><strong>Confusion</strong> — ${escapeHtml(c)}`;
    if (stratMatch) html += ` <span class="ta-strategy ta-strategy-${stratMatch}">${stratMatch}</span>`;
    html += `</div>`;
  }

  for (const ea of step.expectedActuals) {
    html += `<div class="ta-callout ta-callout-expected"><strong>Expected vs Actual</strong> — ${escapeHtml(ea)}</div>`;
  }

  for (const mf of step.missingFeedback) {
    html += `<div class="ta-callout ta-callout-feedback"><strong>Missing Feedback</strong> — ${escapeHtml(mf)}</div>`;
  }

  html += `</div>`;
  return html;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(templatePath)) {
    console.error(`Template not found: ${templatePath}`);
    process.exit(1);
  }

  let template = fs.readFileSync(templatePath, 'utf8');
  const tokens = buildTokens();

  for (const [token, value] of Object.entries(tokens)) {
    template = template.split(token).join(value);
  }

  // Clean up any remaining unreplaced tokens
  template = template.replace(/\{\{[A-Z_]+\}\}/g, '');

  const outPath = path.join(absArtifacts, 'evaluation-report.html');
  fs.writeFileSync(outPath, template, 'utf8');
  console.log(`✓ Report written to ${outPath}`);
  console.log(`  Size: ${(Buffer.byteLength(template) / 1024).toFixed(0)} KB`);
}

main();
