#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

function buildDeltaHtml() {
  const deltaPath = path.join(absArtifacts, 'mr-delta.json');
  const delta = readJsonOr(deltaPath, null);
  if (!delta) return '<p class="muted small">No MR delta data available. Run with --workspace to enable.</p>';

  const addIcon = '<span class="delta-added" title="Added">+</span>';
  const modIcon = '<span class="delta-modified" title="Modified">~</span>';

  const protoId = extractPrototypeId();
  const knownMRs = { 'RHAISTRAT-1527':168,'RHAISTRAT-133':169,'RHAISTRAT-1492':170,'RHAISTRAT-1267':167,'RHAISTRAT-1536':171,'RHAISTRAT-1535':172,'RHAISTRAT-1745':176,'RHAISTRAT-1474':173,'RHAISTRAT-1740':175,'RHAISTRAT-432':174,'RHAISTRAT-1521':177,'RHAISTRAT-1433':178,'RHAISTRAT-1762':180,'RHAISTRAT-1761':183,'RHAISTRAT-1758':181,'RHAISTRAT-1744':182,'RHAISTRAT-1742':184,'RHAISTRAT-1741':179 };
  const mrNum = delta.mr_number || knownMRs[protoId];
  const mrDiffUrl = mrNum ? `https://gitlab.cee.redhat.com/uxd/prototypes/rhoai/-/merge_requests/${mrNum}/diffs` : '';

  let html = `<p class="small"><strong>${delta.total_files_changed || 0} files changed</strong> against <code>${escapeHtml(delta.base_branch || '?')}</code>`;
  if (mrNum) html += ` · <a href="${mrDiffUrl}" target="_blank">View full diff on GitLab (MR !${mrNum})</a>`;
  html += `</p>`;

  // Metadata row with icons
  html += `<div class="delta-meta">`;
  html += `<span>${delta.route_changes ? '✓' : '✗'} Routes</span>`;
  html += `<span>${delta.nav_changes ? '✓' : '✗'} Sidebar nav</span>`;
  html += `<span>${delta.feature_flag_changes ? '✓' : '✗'} Feature flags</span>`;
  html += `</div>`;

  // Navigation warning
  if (delta.nav_warning) {
    html += `<div class="delta-nav-warn">${escapeHtml(delta.nav_warning)}</div>`;
  }

  // File lists with icons
  const newFiles = delta.new_files || [];
  const modFiles = delta.modified_files || [];

  html += `<div class="delta-files">`;
  if (newFiles.length) {
    html += `<div class="delta-file-group"><h4>${addIcon} ${newFiles.length} Added</h4><ul class="delta-file-list">`;
    for (const f of newFiles.slice(0, 8)) {
      const short = f.replace('src/app/', '').replace('src/', '');
      html += `<li>${addIcon} <code>${escapeHtml(short)}</code></li>`;
    }
    if (newFiles.length > 8) html += `<li class="muted">+${newFiles.length - 8} more</li>`;
    html += `</ul></div>`;
  }
  if (modFiles.length) {
    // Highlight important modified files
    const important = modFiles.filter(f => f.includes('AppLayout') || f.includes('routes') || f.includes('FeatureFlag'));
    const other = modFiles.filter(f => !important.includes(f));

    html += `<div class="delta-file-group"><h4>${modIcon} ${modFiles.length} Modified</h4><ul class="delta-file-list">`;
    for (const f of important) {
      const short = f.replace('src/app/', '').replace('src/', '');
      html += `<li>${modIcon} <code><strong>${escapeHtml(short)}</strong></code></li>`;
    }
    for (const f of other.slice(0, 5)) {
      const short = f.replace('src/app/', '').replace('src/', '');
      html += `<li>${modIcon} <code>${escapeHtml(short)}</code></li>`;
    }
    if (other.length > 5) html += `<li class="muted">+${other.length - 5} more</li>`;
    html += `</ul></div>`;
  }
  html += `</div>`;

  // New routes
  if (delta.new_routes && delta.new_routes.length) {
    html += `<p class="small muted mt1">New routes: ${delta.new_routes.map(r => '<code>' + escapeHtml(r) + '</code>').join(', ')}</p>`;
  }

  if (delta.summary) html += `<p class="small mt1">${escapeHtml(delta.summary)}</p>`;
  return html;
}

function buildPersonaSelectionHtml() {
  const journeyLog = readJsonOr(path.join(absArtifacts, 'journey-log.json'), null);
  const ud = journeyLog ? journeyLog.usability_dimensions : null;
  if (!ud || !ud.personas_evaluated || !ud.personas_evaluated.length) {
    return '<p class="muted small">No persona data available.</p>';
  }

  const selection = ud.persona_selection;
  if (selection) {
    let html = `<p class="small"><strong>Target audience:</strong> ${escapeHtml(selection.target_audience_text || '—')}</p>`;
    if (selection.target_audience_source) html += `<p class="small muted"><strong>Source:</strong> ${escapeHtml(selection.target_audience_source)}</p>`;
    html += `<p class="small"><strong>Reasoning:</strong> ${escapeHtml(selection.reasoning || '—')}</p>`;
    html += `<p class="small"><strong>Selected:</strong> ${(selection.selected || []).map(p => '<code>' + escapeHtml(p) + '</code>').join(', ')}</p>`;
    if (selection.considered_but_rejected && selection.considered_but_rejected.length) {
      html += `<details><summary class="small muted">Considered but rejected</summary><ul class="small">`;
      for (const r of selection.considered_but_rejected) {
        html += `<li><code>${escapeHtml(r.persona)}</code> — ${escapeHtml(r.reason)}</li>`;
      }
      html += `</ul></details>`;
    }
    return html;
  }

  // No formal selection data — build a reasonable explanation from what we have
  let html = `<p class="small"><strong>Personas evaluated:</strong> ${ud.personas_evaluated.map(p => '<code>' + escapeHtml(p) + '</code>').join(', ')}</p>`;
  html += `<p class="small muted">Persona selection reasoning was not logged for this run. To enable, the eval should write <code>persona_selection</code> data to journey-log.json (see SKILL.md Step 3b.1). The personas above were selected based on the RFE's target audience.</p>`;
  return html;
}

function buildPersonaProfilesHtml() {
  const journeyLog = readJsonOr(path.join(absArtifacts, 'journey-log.json'), null);
  const ud = journeyLog ? journeyLog.usability_dimensions : null;
  if (!ud || !ud.personas_evaluated) return '';

  const contextDir = path.join(path.resolve(__dirname, '..'), '.context', 'usability-testing', 'personas');
  let html = '';

  for (const pid of ud.personas_evaluated) {
    const yamlPath = path.join(contextDir, pid + '.yaml');
    const raw = readFileOr(yamlPath, '');
    if (!raw) continue;

    const nameMatch = raw.match(/^name:\s*"?(.+?)"?\s*$/m);
    const roleMatch = raw.match(/^rh_persona:\s*(.+)$/m);
    const archetypeMatch = raw.match(/^rh_persona_archetype:\s*(.+)$/m);
    const levelMatch = raw.match(/^experience_level:\s*(.+)$/m);
    const patienceMatch = raw.match(/^\s+patience:\s*(\w+)/m);
    const explorationMatch = raw.match(/^\s+exploration_tendency:\s*(\w+)/m);
    const errorRecoveryMatch = raw.match(/^\s+error_recovery:\s*(\w+)/m);

    const name = nameMatch ? nameMatch[1] : pid;
    const role = roleMatch ? roleMatch[1].trim() : '';
    const archetype = archetypeMatch ? archetypeMatch[1].trim() : '';
    const level = levelMatch ? levelMatch[1].trim() : '';
    const patience = patienceMatch ? patienceMatch[1].trim() : '';
    const exploration = explorationMatch ? explorationMatch[1].trim() : '';
    const errorRecovery = errorRecoveryMatch ? errorRecoveryMatch[1].trim() : '';

    html += `<div class="persona-card">`;
    html += `<h4>${escapeHtml(name)}</h4>`;
    html += `<div class="persona-meta">`;
    html += `<span>${escapeHtml(role)}</span>`;
    if (archetype) html += `<span>${escapeHtml(archetype)}</span>`;
    html += `<span>${escapeHtml(level)}</span>`;
    html += `</div>`;

    // Behavioral attributes
    html += `<div class="persona-meta">`;
    html += `<span>Patience: <strong>${escapeHtml(patience)}</strong></span>`;
    if (exploration) html += `<span>Exploration: <strong>${escapeHtml(exploration)}</strong></span>`;
    if (errorRecovery) html += `<span>Error recovery: <strong>${escapeHtml(errorRecovery)}</strong></span>`;
    html += `</div>`;

    // Domain knowledge as color-coded tags
    const knowledgeSection = raw.match(/domain_knowledge:\n((?:\s+\w+:.+\n?)+)/);
    if (knowledgeSection) {
      const entries = knowledgeSection[1].match(/^\s+(\w+):\s*(\w+)/gm);
      if (entries) {
        html += `<div class="persona-knowledge">`;
        for (const entry of entries) {
          const [, domain, level] = entry.trim().match(/(\w+):\s*(\w+)/) || [];
          if (!domain) continue;
          let cls = 'knowledge-tag';
          if (['strong', 'competent', 'intermediate'].includes(level)) cls += ' strong';
          else if (['basic', 'minimal'].includes(level)) cls += ' basic';
          else if (level === 'none') cls += ' none';
          html += `<span class="${cls}">${escapeHtml(domain)}: ${escapeHtml(level)}</span>`;
        }
        html += `</div>`;
      }
    }

    // Pain points
    const painMatch = raw.match(/known_pain_points:\n((?:\s+-\s+.+\n?)+)/);
    if (painMatch) {
      const pains = painMatch[1].match(/-\s+"?(.+?)"?\s*$/gm);
      if (pains && pains.length) {
        html += `<details><summary class="small muted">Known pain points</summary><ul class="small" style="margin:0.25rem 0 0 1rem">`;
        for (const p of pains.slice(0, 5)) {
          html += `<li>${escapeHtml(p.replace(/^-\s+"?/, '').replace(/"$/, ''))}</li>`;
        }
        html += `</ul></details>`;
      }
    }
    html += `</div>`;
  }
  return html;
}

function buildCodeDeltasHtml() {
  const delta = readJsonOr(path.join(absArtifacts, 'mr-delta.json'), null);
  if (!delta) return '<p class="muted small">No MR delta data. Run with --workspace to enable code delta analysis.</p>';

  const protoId = extractPrototypeId();
  const knownMRs = { 'RHAISTRAT-1527':168,'RHAISTRAT-133':169,'RHAISTRAT-1492':170,'RHAISTRAT-1267':167,'RHAISTRAT-1536':171,'RHAISTRAT-1535':172,'RHAISTRAT-1745':176,'RHAISTRAT-1474':173,'RHAISTRAT-1740':175,'RHAISTRAT-432':174,'RHAISTRAT-1521':177,'RHAISTRAT-1433':178,'RHAISTRAT-1762':180,'RHAISTRAT-1761':183,'RHAISTRAT-1758':181,'RHAISTRAT-1744':182,'RHAISTRAT-1742':184,'RHAISTRAT-1741':179 };
  const mrNum = delta.mr_number || knownMRs[protoId];
  const baseUrl = 'https://gitlab.cee.redhat.com/uxd/prototypes/rhoai/-/merge_requests';

  const workspaceDir = path.join(absArtifacts, 'workspace');
  const canReadDiff = fs.existsSync(workspaceDir);

  function getFileDiff(filePath, maxLines) {
    if (!canReadDiff) return null;
    try {
      const diff = execSync(`git diff origin/3.5 HEAD -- "${filePath}" 2>/dev/null`, { cwd: workspaceDir, encoding: 'utf8', maxBuffer: 1024 * 100 });
      if (!diff) return null;
      const lines = diff.split('\n');
      return lines.slice(0, maxLines || 40).join('\n');
    } catch { return null; }
  }

  function renderDiffBlock(diff) {
    if (!diff) return '';
    let out = `<details><summary class="small muted">View diff</summary><div class="diff-block"><pre>`;
    for (const line of diff.split('\n')) {
      if (line.startsWith('@@')) {
        out += `<span class="diff-line diff-line-header">${escapeHtml(line)}</span>\n`;
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        out += `<span class="diff-line diff-line-add">${escapeHtml(line)}</span>\n`;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        out += `<span class="diff-line diff-line-del">${escapeHtml(line)}</span>\n`;
      } else if (/^(diff |index |---|[+]{3})/.test(line)) {
        // skip headers
      } else {
        out += `<span class="diff-line diff-line-context">${escapeHtml(line)}</span>\n`;
      }
    }
    out += `</pre></div></details>`;
    return out;
  }

  // Classify every file into a tier with metadata
  const newFiles = new Set(delta.new_files || []);
  const allFiles = [...(delta.new_files || []), ...(delta.modified_files || [])];
  const boilerplate = /\/(index|types|__tests__|\.test\.|\.spec\.|\.stories\.)(\.\w+)?$/;
  const rendered = new Set();

  function classify(f) {
    if (f.includes('AppLayout') || f.includes('Sidebar') || f.includes('Nav'))
      return { tier: 0, severity: 'critical', label: 'Navigation', reason: delta.nav_changes ? 'Sidebar nav updated' : 'Sidebar nav NOT updated — pages orphaned' };
    if (f.includes('routes'))
      return { tier: 1, severity: 'critical', label: 'Routing', reason: 'Route registration — controls which URLs exist' };
    if (f.includes('FeatureFlag'))
      return { tier: 2, severity: 'high', label: 'Feature Flags', reason: 'Controls runtime feature visibility' };
    if (f.match(/\/(pages|AIHub)\//) && !boilerplate.test(f) && newFiles.has(f))
      return { tier: 3, severity: 'medium', label: 'New Page', reason: null };
    if (f.match(/\/(pages|AIHub)\//) && !boilerplate.test(f))
      return { tier: 4, severity: 'low', label: 'Modified Page', reason: null };
    if (boilerplate.test(f))
      return { tier: 9, severity: 'skip', label: 'Boilerplate', reason: null };
    return { tier: 5, severity: 'low', label: 'Support', reason: null };
  }

  const classified = allFiles
    .map(f => ({ path: f, short: f.replace('src/app/', '').replace('src/', ''), isNew: newFiles.has(f), ...classify(f) }))
    .filter(f => f.severity !== 'skip')
    .sort((a, b) => a.tier - b.tier);

  // Deduplicate: group files from the same directory together
  const seen = new Set();
  const deduped = [];
  for (const f of classified) {
    const dir = f.path.replace(/\/[^/]+$/, '');
    const key = f.tier <= 2 ? f.path : dir;
    if (f.tier <= 2 || !seen.has(key)) {
      seen.add(key);
      deduped.push(f);
    }
  }

  let html = '';

  // Summary header
  const critCount = deduped.filter(f => f.severity === 'critical').length;
  const highCount = deduped.filter(f => f.severity === 'high').length;
  const newCount = (delta.new_files || []).filter(f => !boilerplate.test(f)).length;
  const modCount = (delta.modified_files || []).length;

  html += `<div class="delta-summary">`;
  html += `<div class="delta-summary-row">`;
  html += `<div class="delta-stat"><span class="delta-stat-n">${delta.total_files_changed || 0}</span><span class="delta-stat-l">Files</span></div>`;
  html += `<div class="delta-stat"><span class="delta-stat-n delta-added">${newCount}</span><span class="delta-stat-l">Added</span></div>`;
  html += `<div class="delta-stat"><span class="delta-stat-n delta-modified">${modCount}</span><span class="delta-stat-l">Modified</span></div>`;
  if (critCount) html += `<div class="delta-stat"><span class="delta-stat-n" style="color:var(--status-danger)">${critCount}</span><span class="delta-stat-l">Critical</span></div>`;
  html += `</div>`;
  html += `<p class="small muted" style="margin:0.5rem 0 0">Base: <code>${escapeHtml(delta.base_branch || '?')}</code>`;
  if (mrNum) html += ` · <a href="${baseUrl}/${mrNum}/diffs" target="_blank">View full diff (MR !${mrNum})</a>`;
  html += `</p>`;
  html += `</div>`;

  // Nav warning — prominent banner
  if (delta.nav_warning) {
    html += `<div class="delta-nav-warn"><strong>⚠ Navigation Gap</strong> — ${escapeHtml(delta.nav_warning)}</div>`;
  }

  // Status indicators
  html += `<div class="delta-meta">`;
  html += `<span class="${delta.route_changes ? 'delta-added' : ''}">${delta.route_changes ? '✓' : '✗'} Routes</span>`;
  html += `<span class="${delta.nav_changes ? 'delta-added' : ''}" style="${!delta.nav_changes && delta.route_changes ? 'color:var(--status-danger);font-weight:500' : ''}">${delta.nav_changes ? '✓' : '✗'} Sidebar nav</span>`;
  html += `<span class="${delta.feature_flag_changes ? 'delta-modified' : ''}">${delta.feature_flag_changes ? '✓' : '✗'} Feature flags</span>`;
  html += `</div>`;

  // New routes
  if (delta.new_routes && delta.new_routes.length) {
    html += `<div class="delta-routes">`;
    for (const r of delta.new_routes) {
      html += `<code class="delta-route">${escapeHtml(r)}</code>`;
    }
    html += `</div>`;
  }

  // File list grouped by severity
  let currentSeverity = '';
  for (const f of deduped) {
    if (f.severity !== currentSeverity) {
      currentSeverity = f.severity;
      const heading = f.severity === 'critical' ? 'Critical — Score Impact'
        : f.severity === 'high' ? 'High — Runtime Impact'
        : f.severity === 'medium' ? 'New Feature Files'
        : 'Modified Support Files';
      html += `<h3 class="delta-group-heading">${heading}</h3>`;
    }

    const typeTag = f.isNew
      ? '<span class="delta-tag delta-tag-add">added</span>'
      : '<span class="delta-tag delta-tag-mod">modified</span>';
    const severityTag = f.severity === 'critical'
      ? '<span class="delta-tag delta-tag-critical">critical</span>'
      : f.severity === 'high'
      ? '<span class="delta-tag delta-tag-high">high</span>'
      : '';

    html += `<div class="delta-file-card delta-file-${f.severity}">`;
    html += `<div class="delta-file-head">`;
    html += `<code class="delta-file-name">${escapeHtml(f.short)}</code>`;
    html += `<span class="delta-tags">${typeTag}${severityTag}</span>`;
    html += `</div>`;

    if (f.reason) {
      const reasonClass = f.severity === 'critical' ? 'delta-file-reason-critical' : 'delta-file-reason';
      html += `<p class="${reasonClass}">${f.reason}</p>`;
    }

    // Score impact for critical files
    if (f.severity === 'critical') {
      let impact = '';
      if (f.path.includes('AppLayout') && !delta.nav_changes) {
        impact = 'Caps Workflow Continuity + Mental Model Fidelity at 1/3 for all personas';
      } else if (f.path.includes('routes') && !delta.nav_changes) {
        impact = 'Pages exist at URLs but unreachable without nav — nav-assisted only';
      } else if (f.path.includes('FeatureFlag')) {
        impact = 'May hide/show features depending on runtime flag state';
      }
      if (impact) {
        html += `<p class="delta-score-impact">${impact}</p>`;
      }
    }

    html += renderDiffBlock(getFileDiff(f.path, 40));
    html += `</div>`;
  }

  if (delta.summary) {
    html += `<p class="small muted mt1">${escapeHtml(delta.summary)}</p>`;
  }

  return html;
}

function buildExplorationHtml() {
  const journeyLog = readJsonOr(path.join(absArtifacts, 'journey-log.json'), null);
  if (!journeyLog || !journeyLog.exploration || !journeyLog.exploration.length) return '';

  let html = '';

  for (const expl of journeyLog.exploration) {
    const pName = escapeHtml(expl.persona_name || expl.persona);
    const goal = escapeHtml(expl.goal || '');
    const gap = escapeHtml(expl.prescribed_gap || '');
    const paths = (expl.paths_covered || []).map(p => '<code>' + escapeHtml(p) + '</code>').join(', ');

    html += `<div class="card" style="margin:0.75rem 0;border-left:3px solid var(--status-warning)">`;
    html += `<h4 style="margin:0 0 0.25rem">${pName} — Exploratory Navigation</h4>`;
    html += `<p class="small muted" style="margin:0 0 0.35rem">${goal}</p>`;
    if (gap) html += `<p class="small" style="margin:0 0 0.35rem"><strong>Why explored:</strong> ${gap}</p>`;
    if (paths) html += `<p class="small" style="margin:0"><strong>Paths covered:</strong> ${paths}</p>`;
    html += `</div>`;

    const steps = expl.steps || [];
    if (steps.length) {
      html += `<details><summary>Exploration Steps (${steps.length})</summary>`;
      for (const step of steps) {
        html += `<div class="ta-step">`;
        html += `<div class="ta-step-head">Step ${step.step} — ${escapeHtml(step.action || '')} → <code>${escapeHtml(step.target || '')}</code> · ${badgeHtml(step.result === 'success' ? 'PASS' : 'FAIL')}</div>`;

        if (step.narration) {
          html += `<div class="narration">${escapeHtml(step.narration)}</div>`;
        }
        if (step.persona_reaction) {
          html += `<div class="ta-think">${escapeHtml(step.persona_reaction)}</div>`;
        }

        // Screenshot
        const ssFile = step.screenshot ? path.basename(step.screenshot) : null;
        if (ssFile) {
          const ssPath = path.join(absArtifacts, 'screenshots', ssFile);
          if (fs.existsSync(ssPath)) {
            const data = fs.readFileSync(ssPath);
            const src = 'data:image/png;base64,' + data.toString('base64');
            html += `<div class="screenshot"><img src="${src}" alt="Step ${step.step}"></div>`;
          }
        }

        if (step.error) {
          html += `<div class="ta-callout ta-callout-confusion"><strong>Error:</strong> ${escapeHtml(step.error)}</div>`;
        }
        html += `</div>`;
      }
      html += `</details>`;
    }
  }

  return html;
}

function buildExternalUsabilityHtml() {
  const extDir = path.join(absArtifacts, 'zack-skill-output');
  if (!fs.existsSync(extDir)) return '';

  const summary = readFileOr(path.join(extDir, 'summary.md'), '');
  const thinkaloud = readFileOr(path.join(extDir, 'phase1-thinkaloud.md'), '');
  const evaluation = readFileOr(path.join(extDir, 'phase2-evaluation.md'), '');
  if (!summary && !thinkaloud) return '';

  let html = '';

  // Summary card
  const personaMatch = summary.match(/\|\s*Persona\s*\|\s*(.+?)\s*\|/);
  const outcomeMatch = summary.match(/\|\s*Outcome\s*\|\s*(.+?)\s*\|/);
  const patienceMatch = summary.match(/\|\s*Patience remaining\s*\|\s*(\d+)%/);
  const scoreMatch = summary.match(/\|\s*Overall score\s*\|\s*\*\*(.+?)\*\*/);
  const stepsMatch = summary.match(/\|\s*Steps\s*\|\s*(\d+)/);

  const persona = personaMatch ? personaMatch[1].trim() : 'Unknown';
  const outcome = outcomeMatch ? outcomeMatch[1].trim() : '—';
  const patience = patienceMatch ? parseInt(patienceMatch[1], 10) : 0;
  const score = scoreMatch ? scoreMatch[1].trim() : '—';
  const steps = stepsMatch ? stepsMatch[1].trim() : '—';

  const pClass = patience > 60 ? 'ta-patience-high' : patience > 30 ? 'ta-patience-med' : 'ta-patience-low';

  html += `<div class="card card-compact" style="border-left:3px solid var(--accent)">`;
  html += `<p class="small" style="margin:0 0 0.25rem"><strong>Source:</strong> <a href="https://gitlab.cee.redhat.com/zbodnar/automated-usability-testing" target="_blank">automated-usability-testing</a> (Zack Bodnar)</p>`;
  html += `<p class="small" style="margin:0"><strong>Persona:</strong> ${escapeHtml(persona)} · <strong>Outcome:</strong> ${escapeHtml(outcome)} · <strong>Steps:</strong> ${escapeHtml(steps)} · <strong>Score:</strong> ${escapeHtml(score)}</p>`;
  html += `<span class="ta-patience ${pClass}" style="margin-top:0.35rem"><span class="ta-patience-bar"><span class="ta-patience-fill" style="width:${patience}%"></span></span> Patience: ${patience}%</span>`;
  html += `</div>`;

  // Dimension scores table from summary.md
  const dimTableMatch = summary.match(/## Dimension Scores\s*\n\n((?:\|.+\|\n?)+)/);
  if (dimTableMatch) {
    const tableLines = dimTableMatch[1].trim().split('\n');
    if (tableLines.length >= 3) {
      html += `<h3>Dimension Scores (External Skill)</h3>`;
      html += `<table class="tbl"><thead><tr>`;
      const headers = tableLines[0].split('|').filter(c => c.trim());
      for (const h of headers) html += `<th>${escapeHtml(h.trim())}</th>`;
      html += `</tr></thead><tbody>`;
      for (const row of tableLines.slice(2)) {
        const cells = row.split('|').filter(c => c.trim());
        if (cells.length < 2) continue;
        html += `<tr>`;
        for (const c of cells) {
          const val = c.trim();
          if (val.includes('/3')) {
            const n = parseInt(val);
            const cls = n <= 1 ? 'color:var(--status-danger)' : n === 2 ? 'color:var(--status-warning)' : 'color:var(--status-success)';
            html += `<td style="${cls};font-weight:500">${escapeHtml(val)}</td>`;
          } else {
            html += `<td>${escapeHtml(val)}</td>`;
          }
        }
        html += `</tr>`;
      }
      html += `</tbody></table>`;
    }
  }

  // Top findings from summary.md
  const findingsSection = extractMdSection(summary, 'Top 3 Findings');
  if (findingsSection) {
    html += `<details><summary>Top Findings</summary><div class="card">${mdToHtml(findingsSection)}</div></details>`;
  }

  // Think-aloud narrative (collapsed)
  if (thinkaloud) {
    const taSteps = parseTaExternalSteps(thinkaloud);
    if (taSteps.length) {
      html += `<details><summary>Think-Aloud Trace (${taSteps.length} steps)</summary>`;
      for (const step of taSteps) {
        html += `<div class="ta-step">`;
        html += `<div class="ta-step-head">Step ${escapeHtml(step.num)} ${step.action ? '— ' + escapeHtml(step.action) : ''}</div>`;
        if (step.think) {
          html += `<div class="ta-think">${escapeHtml(step.think.substring(0, 400))}${step.think.length > 400 ? '...' : ''}</div>`;
        }
        if (step.patience !== null) {
          const spClass = step.patience > 60 ? 'ta-patience-high' : step.patience > 30 ? 'ta-patience-med' : 'ta-patience-low';
          html += `<span class="ta-patience ${spClass}"><span class="ta-patience-bar"><span class="ta-patience-fill" style="width:${step.patience}%"></span></span> ${step.patience}%</span>`;
        }
        if (step.escape) {
          html += `<div class="ta-callout ta-callout-confusion"><strong>CLI Escape</strong> — ${escapeHtml(step.escape)}</div>`;
        }
        if (step.contextLoss) {
          html += `<div class="ta-callout ta-callout-expected"><strong>Context Loss</strong> — ${escapeHtml(step.contextLoss)}</div>`;
        }
        html += `</div>`;
      }
      html += `</details>`;
    }
  }

  // Annotated screenshots from Zack's output
  const extScreensDir = path.join(extDir, 'screenshots');
  if (fs.existsSync(extScreensDir)) {
    const extScreenshots = fs.readdirSync(extScreensDir).filter(f => f.endsWith('.png')).sort();
    if (extScreenshots.length) {
      html += `<details><summary>Screenshots (${extScreenshots.length})</summary>`;
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0.75rem;margin:0.75rem 0">`;
      for (const file of extScreenshots) {
        const data = fs.readFileSync(path.join(extScreensDir, file));
        const src = 'data:image/png;base64,' + data.toString('base64');
        const label = file.replace('.png', '').replace(/-/g, ' ').replace(/_/g, ' ');
        html += `<div style="text-align:center"><img src="${src}" alt="${escapeHtml(label)}" style="width:100%;border-radius:0.375rem;border:1px solid var(--border)"><p class="small muted" style="margin:0.25rem 0">${escapeHtml(label)}</p></div>`;
      }
      html += `</div></details>`;
    }
  }

  return html;
}

function parseTaExternalSteps(md) {
  const steps = [];
  const stepRegex = /^STEP\s+(\d+):\s*$/gm;
  let match;
  const positions = [];

  while ((match = stepRegex.exec(md)) !== null) {
    positions.push({ index: match.index, num: match[1], fullMatch: match[0] });
  }

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index + positions[i].fullMatch.length;
    const end = i + 1 < positions.length ? positions[i + 1].index : md.length;
    const body = md.slice(start, end).trim();

    const thinkMatch = body.match(/\*\*What I'm thinking\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*|\n\nSTEP|\n\n---|\n\[CLI|\n\[CONTEXT|$)/);
    const actionMatch = body.match(/\*\*What I'll try\*\*:\s*(.*)/);
    const patMatch = body.match(/\*\*Patience\*\*:\s*(\d+)%/);

    let escape = null;
    const escapeMatch = body.match(/\[CLI ESCAPE\]:\s*(.*)/);
    if (escapeMatch) escape = escapeMatch[1].trim();

    let contextLoss = null;
    const clMatch = body.match(/\[CONTEXT LOSS\]:\s*(.*)/);
    if (clMatch) contextLoss = clMatch[1].trim();

    // Also check for escape/context loss between this step and the next
    if (i + 1 < positions.length) {
      const between = md.slice(start, positions[i + 1].index);
      const betweenEscape = between.match(/\[CLI ESCAPE\]:\s*(.*)/);
      if (betweenEscape && !escape) escape = betweenEscape[1].trim();
      const betweenCl = between.match(/\[CONTEXT LOSS\]:\s*(.*)/);
      if (betweenCl && !contextLoss) contextLoss = betweenCl[1].trim();
    }

    steps.push({
      num: positions[i].num,
      action: actionMatch ? actionMatch[1].trim() : '',
      think: thinkMatch ? thinkMatch[1].trim() : '',
      patience: patMatch ? parseInt(patMatch[1], 10) : null,
      escape,
      contextLoss
    });
  }

  return steps;
}

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

  // ---- AC Table Rows (split by source) ----
  const jiraRows = csvRows.filter(r => (r.source || '').toLowerCase() !== 'inferred');
  const inferredRows = csvRows.filter(r => (r.source || '').toLowerCase() === 'inferred');

  const acTableRowsJira = jiraRows.map(r => {
    const id = escapeHtml(r.criterion_id);
    const criterion = escapeHtml(r.criterion_text);
    const verdict = badgeHtml(r.verdict);
    const evidence = escapeHtml(r.rationale || r.evidence || '');
    return `<tr><td><strong>${id}</strong></td><td>${criterion}</td><td>${verdict}</td><td class="small">${evidence}</td></tr>`;
  }).join('\n');

  const acTableRowsInferred = inferredRows.map(r => {
    const id = escapeHtml(r.criterion_id);
    const criterion = escapeHtml(r.criterion_text);
    const verdict = badgeHtml(r.verdict);
    const evidence = escapeHtml(r.rationale || r.evidence || '');
    return `<tr><td><strong>${id}</strong></td><td>${criterion}</td><td>${verdict}</td><td class="small">${evidence}</td></tr>`;
  }).join('\n');

  const acJiraCount = jiraRows.length;

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

      // Find screenshot: explicit path in JSON, or auto-detect by naming convention
      let ssFilename = step.screenshot ? path.basename(step.screenshot) : null;
      if (!ssFilename) {
        const jIdx = journeys.indexOf(journey) + 1;
        const candidates = [
          `journey-${jIdx}-step-${step.step}.png`,
          `journey-${jIdx}-step-${step.step}-FAIL.png`
        ];
        for (const c of candidates) {
          if (screenshots[c]) { ssFilename = c; break; }
        }
      }
      if (ssFilename && screenshots[ssFilename]) {
        const idx = registerScreenshot(ssFilename, step.narration || '');
        if (idx >= 0) {
          block += `<div class="screenshot" data-idx="${idx}"><img src="${screenshots[ssFilename]}" alt="Step ${step.step}"></div>`;
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
  // Extract RFE key from markdown or journey-log
  const rfeKeyMatch = mdRaw.match(/RHAIRFE-\d+/);
  const rfeKey = rfeKeyMatch ? rfeKeyMatch[0] : '';
  const rfeUrl = rfeKey ? `https://issues.redhat.com/browse/${rfeKey}` : jiraUrl;

  // Prototype repo — detect from journey-log or default
  const protoRepoBase = 'https://gitlab.cee.redhat.com/uxd/prototypes/rhoai';
  const protoRepoUrl = (journeyLog && journeyLog.breadcrumb && journeyLog.breadcrumb.prototype)
    ? journeyLog.breadcrumb.prototype.url
    : `${protoRepoBase}/-/tree/3.5`;

  // MR detection — known mapping from prototype evaluator spreadsheet
  const knownMRs = {
    'RHAISTRAT-1527': 168, 'RHAISTRAT-133': 169, 'RHAISTRAT-1492': 170,
    'RHAISTRAT-1267': 167, 'RHAISTRAT-1536': 171, 'RHAISTRAT-1535': 172,
    'RHAISTRAT-1745': 176, 'RHAISTRAT-1474': 173, 'RHAISTRAT-1740': 175,
    'RHAISTRAT-432': 174, 'RHAISTRAT-1521': 177, 'RHAISTRAT-1433': 178,
    'RHAISTRAT-1762': 180, 'RHAISTRAT-1761': 183, 'RHAISTRAT-1758': 181,
    'RHAISTRAT-1744': 182, 'RHAISTRAT-1742': 184, 'RHAISTRAT-1741': 179
  };
  const mrNumber = knownMRs[protoId];
  const mrUrl = mrNumber
    ? `${protoRepoBase}/-/merge_requests/${mrNumber}`
    : `${protoRepoBase}/-/merge_requests`;
  const protoDeployUrl = mrNumber
    ? `https://rhoai-5171de.pages.redhat.com/mr-${mrNumber}/`
    : prototypeUrl;

  return {
    '{{PROTOTYPE_ID}}': protoId,
    '{{JIRA_URL}}': jiraUrl,
    '{{PROTOTYPE_URL}}': prototypeUrl,
    '{{RFE_URL}}': rfeUrl,
    '{{PROTOTYPE_REPO_URL}}': protoRepoUrl,
    '{{MR_URL}}': mrUrl,
    '{{MR_LABEL}}': mrNumber ? `MR !${mrNumber}` : 'MRs',
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
    '{{AC_TABLE_ROWS_JIRA}}': acTableRowsJira,
    '{{AC_TABLE_ROWS_INFERRED}}': acTableRowsInferred,
    '{{AC_JIRA_COUNT}}': String(acJiraCount),
    '{{INFERRED_CHECKS_DISPLAY}}': inferredRows.length ? '' : 'display:none',
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
    '{{DELTA_HTML}}': buildDeltaHtml(),
    '{{DELTA_DISPLAY}}': fs.existsSync(path.join(absArtifacts, 'mr-delta.json')) ? '' : 'display:none',
    '{{CSV_DATA}}': csvDataEscaped,
    '{{SCREENSHOT_ARRAY}}': screenshotArrayStr,
    '{{PERSONAS_TAB_DISPLAY}}': (ud && ud.personas_evaluated && ud.personas_evaluated.length) ? '' : 'display:none',
    '{{DELTAS_TAB_DISPLAY}}': fs.existsSync(path.join(absArtifacts, 'mr-delta.json')) ? '' : 'display:none',
    '{{PERSONA_SELECTION_HTML}}': buildPersonaSelectionHtml(),
    '{{PERSONA_PROFILES_HTML}}': buildPersonaProfilesHtml(),
    '{{CODE_DELTAS_HTML}}': buildCodeDeltasHtml(),
    '{{EXPLORATION_HTML}}': buildExplorationHtml(),
    '{{EXPLORATION_DISPLAY}}': (readJsonOr(path.join(absArtifacts, 'journey-log.json'), {}).exploration || []).length ? '' : 'display:none',
    '{{EXTERNAL_USABILITY_HTML}}': buildExternalUsabilityHtml(),
    '{{EXTERNAL_USABILITY_DISPLAY}}': fs.existsSync(path.join(absArtifacts, 'zack-skill-output')) ? '' : 'display:none'
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
