#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const artifactsDir = process.argv[2];
if (!artifactsDir) {
  console.error('Usage: node .claude/skills/eval/scripts/render-report.js <artifacts-dir>');
  console.error('  e.g. node .claude/skills/eval/scripts/render-report.js .artifacts/RHAISTRAT-1536/');
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

function badgeHtml(verdict, acId) {
  const v = String(verdict).toUpperCase();
  const cls = v === 'PASS' ? 'badge-pass' : v === 'FAIL' ? 'badge-fail' : 'badge-flagged';
  if (v === 'FLAGGED' && acId) {
    return `<span class="badge ${cls}" style="cursor:pointer" onclick="openReviewModal('${escapeHtml(acId)}')" title="Click to review">${v}</span>`;
  }
  return `<span class="badge ${cls}">${v}</span>`;
}

function extractPrototypeId() {
  return path.basename(absArtifacts);
}

// ---------------------------------------------------------------------------
// Parse CSV
// ---------------------------------------------------------------------------

// CSV schema: config/csv-schema.yaml — column names and order are enforced there
function parseCsv(raw) {
  if (!raw) return [];
  const lines = raw.trim().split('\n');
  if (lines.length < 2) return [];

  // Parse Section 1 (Acceptance Criteria) — skip # headers
  let headers = null;
  const rows = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      if (headers && trimmed.startsWith('# USABILITY') || trimmed.startsWith('# BASELINE')) break;
      continue;
    }
    if (!headers) {
      headers = parseCSVLine(trimmed);
      continue;
    }
    const vals = parseCSVLine(trimmed);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
    rows.push(obj);
  }
  return rows;
}

function parseCsvSection(raw, sectionName) {
  if (!raw) return [];
  const lines = raw.trim().split('\n');
  let inSection = false;
  let headers = null;
  const rows = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      if (trimmed.toUpperCase().includes(sectionName.toUpperCase())) { inSection = true; headers = null; continue; }
      else if (inSection) break;
      continue;
    }
    if (!inSection || !trimmed) continue;
    if (!headers) { headers = parseCSVLine(trimmed); continue; }
    const vals = parseCSVLine(trimmed);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
    rows.push(obj);
  }
  return rows;
}

function buildFullCsv(csvRaw, journeyLog, passCount, failCount, flaggedCount) {
  let fullCsv = csvRaw.trim();

  // Append Section 2 (Usability Dimensions) if not already present and data exists
  if (!fullCsv.includes('# USABILITY DIMENSIONS')) {
    const ud = journeyLog ? journeyLog.usability_dimensions : null;
    if (ud && ud.dimensions) {
      fullCsv += '\n\n# USABILITY DIMENSIONS\ndimension_id,dimension_name,score,confidence,evidence,persona_scores\n';
      for (const dim of ud.dimensions) {
        const pScores = dim.persona_scores ? JSON.stringify(dim.persona_scores).replace(/"/g, '""') : '';
        fullCsv += `${dim.id || ''},${escapeCSVField(dim.name || '')},${dim.composite_score || 0},${dim.confidence || 'medium'},${escapeCSVField(dim.evidence || '')},"${pScores}"\n`;
      }
    }
  }

  // Append Section 3 (Persona Insights) if not already present
  if (!fullCsv.includes('# PERSONA INSIGHTS')) {
    const ud = journeyLog ? journeyLog.usability_dimensions : null;
    if (ud && ud.persona_overlays && ud.persona_overlays.length) {
      fullCsv += '\n\n# PERSONA INSIGHTS\npersona,patience_start,patience_end,abandoned,confusion_events,cli_escapes,key_friction\n';
      for (const overlay of ud.persona_overlays) {
        const frictions = (overlay.confusion_events || []).map(e => e.trigger || '').filter(Boolean).slice(0, 3).join('; ');
        fullCsv += `${escapeCSVField(overlay.persona_name || overlay.persona)},${overlay.patience_start || 100},${overlay.patience_end || 100},${overlay.abandoned || false},${(overlay.confusion_events || []).length},${overlay.cli_escapes || 0},${escapeCSVField(frictions)}\n`;
      }
    }
  }

  // Append Section 4 (Baseline) if not already present
  if (!fullCsv.includes('# BASELINE')) {
    const total = passCount + failCount + flaggedCount;
    const passRate = total > 0 ? (passCount / total).toFixed(2) : '0';
    const ud = journeyLog ? journeyLog.usability_dimensions : null;
    const usabilityComposite = ud ? (ud.overall_score || 0) : 0;
    const journeys = journeyLog ? journeyLog.journeys || [] : [];
    const journeyPassRate = journeys.length > 0 ? (journeys.filter(j => j.verdict === 'PASS').length / journeys.length).toFixed(2) : '0';

    // Build conclusion summary
    let conclusion = '';
    if (total > 0) {
      conclusion = `${passCount}/${total} criteria passed (${(passCount/total*100).toFixed(0)}%)`;
      if (failCount > 0) conclusion += `. ${failCount} failed`;
      if (flaggedCount > 0) conclusion += `. ${flaggedCount} need human review`;
    }

    fullCsv += '\n\n# BASELINE\nmetric,value,source\n';
    fullCsv += `total_criteria,${total},evaluation-report.csv\n`;
    fullCsv += `pass_count,${passCount},evaluation-report.csv\n`;
    fullCsv += `fail_count,${failCount},evaluation-report.csv\n`;
    fullCsv += `flagged_count,${flaggedCount},evaluation-report.csv\n`;
    fullCsv += `pass_rate,${passRate},computed\n`;
    fullCsv += `usability_composite,${usabilityComposite},journey-log.json\n`;
    fullCsv += `journey_pass_rate,${journeyPassRate},journey-log.json\n`;
    fullCsv += `conclusion,${escapeCSVField(conclusion)},computed\n`;

    // Add persona patience summaries
    if (ud && ud.persona_overlays) {
      for (const overlay of ud.persona_overlays) {
        const name = overlay.persona_name || overlay.persona;
        fullCsv += `patience_${(overlay.persona || '').replace(/[^a-z]/g, '_')},${overlay.patience_end || 100}%,persona-overlay\n`;
      }
    }
  }

  return fullCsv;
}

function escapeCSVField(str) {
  if (!str) return '';
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
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

  // Detect stale screenshots: if journey-log.json is newer than all screenshots,
  // the screenshots may be from a prior iteration (not re-captured after refine).
  const journeyLogPath = path.join(path.dirname(screenshotsDir), 'journey-log.json');
  let journeyLogMtime = 0;
  try { journeyLogMtime = fs.statSync(journeyLogPath).mtimeMs; } catch {}

  let staleWarning = false;
  for (const file of files) {
    const filePath = path.join(screenshotsDir, file);
    if (journeyLogMtime > 0) {
      const ssMtime = fs.statSync(filePath).mtimeMs;
      if (ssMtime < journeyLogMtime - 60000) {
        staleWarning = true;
      }
    }
    const data = fs.readFileSync(filePath);
    map[file] = 'data:image/png;base64,' + data.toString('base64');
  }

  if (staleWarning) {
    console.warn('  ⚠ WARNING: Screenshots appear older than journey-log.json — they may be stale from a prior iteration.');
  }
  return map;
}

// ---------------------------------------------------------------------------
// Build tokens
// ---------------------------------------------------------------------------

function buildReportIntroHtml() {
  const extractState = readJsonOr(path.join(absArtifacts, 'extract-state.json'), null);
  const delta = readJsonOr(path.join(absArtifacts, 'mr-delta.json'), null);
  const protoId = extractPrototypeId();

  const knownMRs = { 'RHAISTRAT-1527':168,'RHAISTRAT-133':169,'RHAISTRAT-1492':170,'RHAISTRAT-1267':167,'RHAISTRAT-1536':171,'RHAISTRAT-1535':172,'RHAISTRAT-1745':176,'RHAISTRAT-1474':173,'RHAISTRAT-1740':175,'RHAISTRAT-432':174,'RHAISTRAT-1521':177,'RHAISTRAT-1433':178,'RHAISTRAT-1762':180,'RHAISTRAT-1761':183,'RHAISTRAT-1758':181,'RHAISTRAT-1744':182,'RHAISTRAT-1742':184,'RHAISTRAT-1741':179 };
  const mrNum = delta ? (delta.mr_number || knownMRs[protoId]) : knownMRs[protoId];
  const filesChanged = delta ? (delta.stats?.files_changed || (delta.changed_files || []).length || 0) : 0;
  const baseBranch = delta ? (delta.base_branch || '3.5') : '3.5';

  const title = extractState ? (extractState.story_title || extractState.title || '') : '';
  const rfeKey = extractState ? (extractState.rfe_key || '') : '';
  const tasks = extractState ? (extractState.tasks_to_be_done || []) : [];
  const taskSummary = tasks.length ? tasks[0].task : '';

  let html = '';
  html += `<p style="margin:0 0 0.25rem;font-size:1rem;font-weight:600">${escapeHtml(title || protoId)}</p>`;

  const meta = [];
  meta.push(`<strong>${escapeHtml(protoId)}</strong>`);
  if (rfeKey) meta.push(`from ${escapeHtml(rfeKey)}`);
  if (mrNum) meta.push(`MR !${mrNum}`);
  if (filesChanged) meta.push(`${filesChanged} files changed against ${escapeHtml(baseBranch)}`);
  html += `<p class="small muted" style="margin:0 0 0.35rem">${meta.join(' · ')}</p>`;

  if (taskSummary) {
    html += `<p class="small" style="margin:0;color:var(--text)"><strong>User task:</strong> ${escapeHtml(taskSummary)}</p>`;
  }

  return html;
}

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

  let html = `<p class="small"><strong>${delta.stats?.files_changed || delta.total_files_changed || 0} files changed</strong> against <code>${escapeHtml(delta.base_branch || '?')}</code>`;
  if (mrNum) html += ` · <a href="${mrDiffUrl}" target="_blank">View full diff on GitLab (MR !${mrNum})</a>`;
  html += `</p>`;

  // Show modified file list
  const allChanged = delta.changed_files || [...(delta.new_files || []), ...(delta.modified_files || [])];
  if (allChanged.length) {
    html += `<div class="delta-meta">`;
    const shortFiles = allChanged.slice(0, 5).map(f => f.replace('src/app/', '').replace('src/', ''));
    html += `<span class="small muted">${shortFiles.join(', ')}${allChanged.length > 5 ? ` +${allChanged.length - 5} more` : ''}</span>`;
    html += `</div>`;
  }

  // Navigation warning
  if (delta.nav_warning) {
    html += `<div class="delta-nav-warn">${escapeHtml(delta.nav_warning)}</div>`;
  }

  // File lists with icons
  const newFiles = delta.new_files || [];
  const modFiles = delta.modified_files || [];
  const changedFiles = delta.changed_files || [];

  html += `<div class="delta-files">`;

  if (newFiles.length || modFiles.length) {
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
  } else if (changedFiles.length) {
    html += `<div class="delta-file-group"><h4>${modIcon} ${changedFiles.length} Changed</h4><ul class="delta-file-list">`;
    for (const f of changedFiles.slice(0, 8)) {
      const short = f.replace('src/app/', '').replace('src/', '');
      const isImportant = f.includes('AppLayout') || f.includes('routes') || f.includes('FeatureFlag');
      html += `<li>${modIcon} <code${isImportant ? '><strong' : ''}>${escapeHtml(short)}${isImportant ? '</strong>' : ''}</code></li>`;
    }
    if (changedFiles.length > 8) html += `<li class="muted">+${changedFiles.length - 8} more</li>`;
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

  // No formal selection data — auto-generate from available persona and RFE context
  const personas = ud.personas_evaluated;
  let html = `<p class="small"><strong>Personas evaluated:</strong> ${personas.map(p => '<code>' + escapeHtml(p) + '</code>').join(', ')}</p>`;

  // Attempt to infer reasoning from the persona IDs and any RFE snapshot
  const hasJunior = personas.some(p => p.includes('junior'));
  const hasSenior = personas.some(p => p.includes('senior'));
  const families = [...new Set(personas.map(p => p.replace(/-junior|-senior|-experienced/, '')))];

  let inferredReasoning = '';
  if (hasJunior && hasSenior) {
    inferredReasoning = `Junior + senior pair selected from the ${families.join('/')} persona family for maximum friction range.`;
  } else if (families.length > 1) {
    inferredReasoning = `Cross-domain selection: ${families.join(' + ')} personas to test different expertise levels.`;
  } else {
    inferredReasoning = `${families[0] || 'Unknown'} persona family selected based on RFE target audience.`;
  }

  html += `<p class="small"><strong>Inferred reasoning:</strong> ${escapeHtml(inferredReasoning)}</p>`;
  html += `<p class="small muted" style="margin-top:0.5rem;padding:0.4rem 0.6rem;background:rgba(234,179,8,0.06);border-radius:0.25rem;border-left:2px solid var(--status-warning)">Full persona selection reasoning was not logged for this run. This is auto-generated from the evaluated personas list. To get full reasoning (target audience source, considered-but-rejected personas), ensure the eval writes <code>persona_selection</code> to journey-log.json before scoring (see SKILL.md Step 3b.1).</p>`;
  return html;
}

function getPersonaAvatar(pid) {
  const colorMap = {
    'deena-junior': '#e86e30',
    'deena-senior': '#c45a26',
    'alex-junior': '#6b5b95',
    'alex-senior': '#4a3d7a',
    'maude': '#8b6914',
    'paula': '#1a8cba',
    'sam': '#4a5568',
    'raj': '#b8860b',
  };
  const base = pid.replace(/-junior|-senior/, '');
  const color = colorMap[pid] || colorMap[base] || '#6b7280';
  const svg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>`;
  return { svg, color };
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
    const avatar = getPersonaAvatar(pid);

    html += `<div class="persona-card">`;
    html += `<div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem">`;
    html += `<div style="width:2.5rem;height:2.5rem;border-radius:50%;background:${avatar.color};display:flex;align-items:center;justify-content:center;flex-shrink:0">${avatar.svg}</div>`;
    html += `<div><h4 style="margin:0">${escapeHtml(name)}</h4>`;
    html += `<span style="font-size:0.75rem;color:var(--text2)">${escapeHtml(level)}</span></div>`;
    html += `</div>`;
    html += `<div class="persona-meta">`;
    html += `<span>${escapeHtml(role)}</span>`;
    if (archetype) html += `<span>${escapeHtml(archetype)}</span>`;
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

function buildPersonaWalkthroughsHtml() {
  const screenshotsDir = path.join(absArtifacts, 'screenshots');
  const journeyLog = readJsonOr(path.join(absArtifacts, 'journey-log.json'), null);
  const extractState = readJsonOr(path.join(absArtifacts, 'extract-state.json'), null);
  const ud = journeyLog ? journeyLog.usability_dimensions : null;

  if (!ud || !ud.personas_evaluated || !ud.personas_evaluated.length) {
    return '<p class="muted small">No persona walkthrough data. Phase B did not produce per-persona screenshots.</p>';
  }

  const contextDir = path.join(path.resolve(__dirname, '..'), '.context', 'usability-testing', 'personas');
  const overlays = ud.persona_overlays || [];
  const thinkAloud = ud.think_aloud || {};
  const traces = thinkAloud.traces || [];

  let html = '';
  html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem;margin-top:1rem">`;

  for (const pid of ud.personas_evaluated) {
    const yamlPath = path.join(contextDir, pid + '.yaml');
    const raw = readFileOr(yamlPath, '');
    const nameMatch = raw.match(/^name:\s*"?(.+?)"?\s*$/m);
    const levelMatch = raw.match(/^experience_level:\s*(.+)$/m);
    const patienceMatch = raw.match(/^\s+patience:\s*(\w+)/m);
    const explorationMatch = raw.match(/^\s+exploration_tendency:\s*(\w+)/m);

    const name = nameMatch ? nameMatch[1] : pid;
    const level = levelMatch ? levelMatch[1].trim() : '';
    const patience = patienceMatch ? patienceMatch[1].trim() : '';
    const exploration = explorationMatch ? explorationMatch[1].trim() : '';
    const avatar = getPersonaAvatar(pid);

    const overlay = overlays.find(o => o.persona === pid) || {};
    const trace = traces.find(t => t.persona === pid) || {};
    const confusionCount = (overlay.confusion_events || []).length;
    const patienceEnd = overlay.patience_end || trace.patience_end || 100;
    const outcome = trace.outcome || (overlay.abandoned ? 'abandoned' : overlay.would_complete === false ? 'abandoned' : 'completed');
    const outcomeBadge = outcome === 'completed' ? 'badge-pass' : outcome === 'abandoned' ? 'badge-fail' : 'badge-flagged';

    const personaScreenshots = fs.existsSync(screenshotsDir)
      ? fs.readdirSync(screenshotsDir).filter(f => f.startsWith(`persona-${pid}-`) && f.endsWith('.png')).sort()
      : [];
    const stepCount = personaScreenshots.length;
    const taskCount = extractState ? (extractState.tasks_to_be_done || []).length : 1;

    const assistedCount = (overlay.confusion_events || []).filter(e => e.trigger && e.trigger.includes('assisted')).length;

    html += `<div class="card" style="cursor:pointer;transition:box-shadow 0.15s,border-color 0.15s" onclick="openPersonaModal('${escapeHtml(pid)}')" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor=''">`;
    html += `<div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem">`;
    html += `<div style="width:2.5rem;height:2.5rem;border-radius:50%;background:${avatar.color};display:flex;align-items:center;justify-content:center;flex-shrink:0">${avatar.svg}</div>`;
    html += `<div><h4 style="margin:0;font-size:0.9375rem">${escapeHtml(name)}</h4>`;
    html += `<span class="small muted">${escapeHtml(level)} · Patience: ${escapeHtml(patience)} · Exploration: ${escapeHtml(exploration)}</span></div>`;
    html += `</div>`;

    // Domain knowledge tags (compact)
    const knowledgeSection = raw.match(/domain_knowledge:\n((?:\s+\w+:.+\n?)+)/);
    if (knowledgeSection) {
      const entries = knowledgeSection[1].match(/^\s+(\w+):\s*(\w+)/gm);
      if (entries && entries.length) {
        html += `<div style="display:flex;flex-wrap:wrap;gap:0.25rem;margin-bottom:0.5rem">`;
        for (const entry of entries.slice(0, 6)) {
          const [, domain, lvl] = entry.trim().match(/(\w+):\s*(\w+)/) || [];
          if (!domain) continue;
          let tagStyle = 'background:var(--bg2);color:var(--text2)';
          if (['strong', 'competent', 'expert'].includes(lvl)) tagStyle = 'background:rgba(22,163,74,0.08);color:var(--status-success)';
          else if (lvl === 'none' || lvl === 'minimal') tagStyle = 'background:rgba(220,38,38,0.06);color:var(--status-danger)';
          html += `<span style="font-size:0.65rem;padding:0.1rem 0.4rem;border-radius:3px;${tagStyle}">${escapeHtml(domain)}: ${escapeHtml(lvl)}</span>`;
        }
        html += `</div>`;
      }
    }

    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.75rem">`;
    html += `<div class="small"><strong>${taskCount}</strong> task${taskCount > 1 ? 's' : ''}, <strong>${stepCount}</strong> steps</div>`;

    // Patience with explanation
    const patienceColor = patienceEnd > 60 ? 'var(--status-success)' : patienceEnd > 30 ? 'var(--status-warning)' : 'var(--status-danger)';
    html += `<div class="small"><strong style="color:${patienceColor}">${patienceEnd}%</strong> patience</div>`;
    html += `<div class="small"><strong>${confusionCount}</strong> confusion events</div>`;
    html += `<div class="small"><strong>${assistedCount}</strong> assisted nav</div>`;
    html += `</div>`;

    // Explain low patience
    if (patienceEnd < 50) {
      const confEvents = overlay.confusion_events || [];
      let reason = '';
      if (confEvents.length > 0) {
        reason = confEvents[0].trigger || 'navigation difficulty';
      } else if (trace.narration_summary) {
        reason = trace.narration_summary.slice(0, 80);
      }
      if (reason) {
        html += `<p class="small" style="margin:0 0 0.5rem;color:${patienceColor};font-style:italic">Struggled with: ${escapeHtml(reason)}</p>`;
      }
    }

    html += `<div style="display:flex;justify-content:space-between;align-items:center">`;
    html += `<span class="badge ${outcomeBadge}">${escapeHtml(outcome)}</span>`;
    html += `<span class="small" style="color:var(--accent);font-weight:500">View Walkthrough →</span>`;
    html += `</div>`;
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

function buildPersonaWalkthroughData() {
  const screenshotsDir = path.join(absArtifacts, 'screenshots');
  const journeyLog = readJsonOr(path.join(absArtifacts, 'journey-log.json'), null);
  const extractState = readJsonOr(path.join(absArtifacts, 'extract-state.json'), null);
  const ud = journeyLog ? journeyLog.usability_dimensions : null;
  const consistencyReport = readJsonOr(path.join(absArtifacts, 'consistency-report.json'), null);

  if (!ud || !ud.personas_evaluated) return '{}';

  const overlays = ud.persona_overlays || [];
  const traces = (ud.think_aloud || {}).traces || [];
  const tasksDefined = extractState ? (extractState.tasks_to_be_done || []) : [];
  const data = {};

  for (const pid of ud.personas_evaluated) {
    const overlay = overlays.find(o => o.persona === pid) || {};
    const trace = traces.find(t => t.persona === pid) || {};
    const confusionEvents = overlay.confusion_events || [];

    // Detect multi-task screenshots: persona-<id>-task-<N>-step-<M>.png
    const allPersonaScreenshots = fs.existsSync(screenshotsDir)
      ? fs.readdirSync(screenshotsDir).filter(f => f.startsWith(`persona-${pid}-`) && f.endsWith('.png')).sort()
      : [];

    const hasMultiTask = allPersonaScreenshots.some(f => f.match(/task-\d+-step/));

    // Build tasks array
    const tasks = [];

    if (hasMultiTask) {
      // Group screenshots by task number
      const taskScreenshots = {};
      for (const f of allPersonaScreenshots) {
        const m = f.match(/task-(\d+)-step-(\d+)/);
        if (m) {
          const taskIdx = parseInt(m[1], 10);
          if (!taskScreenshots[taskIdx]) taskScreenshots[taskIdx] = [];
          taskScreenshots[taskIdx].push({ file: f, step: parseInt(m[2], 10) });
        }
      }

      // Load general think-aloud as fallback when task-specific files don't exist
      const generalTaPath = path.join(absArtifacts, `usability-thinkaloud-${pid}.md`);
      const generalTaRaw = readFileOr(generalTaPath, '');

      for (const [taskIdx, screenshots] of Object.entries(taskScreenshots)) {
        const thinkaloudPath = path.join(absArtifacts, `usability-thinkaloud-${pid}-task-${taskIdx}.md`);
        let thinkaloudRaw = readFileOr(thinkaloudPath, '');

        // Fall back to general think-aloud for task 1 if no task-specific file exists
        if (!thinkaloudRaw && generalTaRaw && parseInt(taskIdx) === 1) {
          thinkaloudRaw = generalTaRaw;
        }

        const taskDef = tasksDefined[parseInt(taskIdx) - 1] || {};

        let steps = parseThinkAloudSteps(thinkaloudRaw, screenshots, screenshotsDir, confusionEvents, consistencyReport);

        // If parsing produced no steps but we have screenshots, create minimal screenshot-only steps
        if (steps.length === 0 && screenshots.length > 0) {
          for (const ss of screenshots.sort((a, b) => a.step - b.step)) {
            const ssB64 = fs.existsSync(path.join(screenshotsDir, ss.file))
              ? fs.readFileSync(path.join(screenshotsDir, ss.file)).toString('base64')
              : '';
            steps.push({
              step: ss.step,
              see: '',
              think: '',
              tryAction: '',
              confidence: '',
              patience: '100',
              screenshot: ssB64 ? `data:image/png;base64,${ssB64}` : '',
              confusion: []
            });
          }
        }

        tasks.push({
          task: taskDef.task || `Task ${taskIdx}`,
          covers_acs: taskDef.covers_acs || [],
          steps,
          outcome: thinkaloudRaw.includes('Abandoned') ? 'abandoned' : 'completed',
          patienceEnd: steps.length ? (parseInt(steps[steps.length - 1].patience) || 100) : 100
        });
      }
    } else {
      // Backward compatible: single task (old format persona-<id>-step-N.png)
      const thinkaloudPath = path.join(absArtifacts, `usability-thinkaloud-${pid}.md`);
      const thinkaloudRaw = readFileOr(thinkaloudPath, '');
      const screenshots = allPersonaScreenshots.map(f => {
        const m = f.match(/step-(\d+)/);
        return { file: f, step: m ? parseInt(m[1], 10) : 0 };
      });

      const steps = parseThinkAloudSteps(thinkaloudRaw, screenshots, screenshotsDir, confusionEvents, consistencyReport);
      const taskDef = tasksDefined[0] || {};

      tasks.push({
        task: taskDef.task || (journeyLog.journeys && journeyLog.journeys[0] ? journeyLog.journeys[0].title : 'Primary task'),
        covers_acs: taskDef.covers_acs || [],
        steps,
        outcome: trace.outcome || (overlay.abandoned ? 'abandoned' : 'completed'),
        patienceEnd: overlay.patience_end || trace.patience_end || 100
      });
    }

    const dimensions = {};
    if (ud.dimensions) {
      for (const dim of ud.dimensions) {
        if (dim.scores && dim.scores[pid]) {
          dimensions[dim.id] = { score: dim.scores[pid].score, name: dim.name, finding: dim.scores[pid].finding || '' };
        }
      }
    }

    const goals = [];
    if (journeyLog.journeys) {
      for (const j of journeyLog.journeys) {
        goals.push({ title: j.title, ac_ids: j.ac_ids || [] });
      }
    }

    data[pid] = { tasks, dimensions, goals };
  }

  return JSON.stringify(data);
}

function parseThinkAloudSteps(thinkaloudRaw, screenshots, screenshotsDir, confusionEvents, consistencyReport) {
  const steps = [];
  const stepPattern = /STEP\s+(\d+):\s*\n([\s\S]*?)(?=STEP\s+\d+:|NAVIGATION COMPLETE|---|\n###|$)/gi;
  let match;
  while ((match = stepPattern.exec(thinkaloudRaw)) !== null) {
    const stepNum = parseInt(match[1], 10);
    const stepText = match[2].trim();

    const seeMatch = stepText.match(/What I see:\s*(.+?)(?=\n-|\n\n|$)/s);
    const thinkMatch = stepText.match(/What I'm thinking:\s*(.+?)(?=\n-|\n\n|$)/s);
    const tryMatch = stepText.match(/What I'll try:\s*(.+?)(?=\n-|\n\n|$)/s);
    const confMatch = stepText.match(/Confidence:\s*(.+?)(?=\n|$)/);
    const patMatch = stepText.match(/Patience:\s*(.+?)(?=\n|$)/);

    const ssEntry = screenshots.find(s => s.step === stepNum);
    const ssB64 = ssEntry ? fs.readFileSync(path.join(screenshotsDir, ssEntry.file)).toString('base64') : '';

    const stepConfusion = confusionEvents.filter(e => e.step === stepNum);

    steps.push({
      step: stepNum,
      screenshot: ssB64 ? `data:image/png;base64,${ssB64}` : '',
      see: seeMatch ? seeMatch[1].trim().slice(0, 300) : '',
      thinking: thinkMatch ? thinkMatch[1].trim().slice(0, 300) : '',
      trying: tryMatch ? tryMatch[1].trim().slice(0, 200) : '',
      confidence: confMatch ? confMatch[1].trim() : '',
      patience: patMatch ? patMatch[1].trim() : '',
      confusionEvents: stepConfusion,
      consistency: []
    });
  }
  return steps;
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

function buildStatDeltas(passCount, failCount, flaggedCount, usabilityScore, journeyLog) {
  const iterLog = readJsonOr(path.join(absArtifacts, 'iteration-log.json'), null);
  if (!iterLog || !iterLog.iterations || iterLog.iterations.length < 2) return '';
  const iter1 = iterLog.iterations[0];
  const passDelta = passCount - iter1.pass_count;
  const failDelta = failCount - iter1.fail_count;
  if (passDelta === 0 && failDelta === 0) return '';
  let html = '<div style="font-size:0.65rem;color:var(--text2);margin-top:0.75rem;text-align:center">';
  html += 'vs Iteration 1: ';
  if (passDelta > 0) html += `<span style="color:var(--status-success)">+${passDelta} passed</span> `;
  if (failDelta < 0) html += `<span style="color:var(--status-success)">${failDelta} failed</span>`;
  if (failDelta > 0) html += `<span style="color:var(--status-danger)">+${failDelta} failed</span>`;
  html += '</div>';
  return html;
}

function buildFlaggedDataArray(csvRows, journeyLog, screenshots) {
  const flagged = csvRows.filter(r => (r.verdict || '').toUpperCase() === 'FLAGGED');
  if (!flagged.length) return '[]';

  const journeys = journeyLog ? journeyLog.journeys || [] : [];
  const items = [];

  for (const item of flagged) {
    const acId = item.criterion_id || '';
    let screenshotSrc = '';
    for (const j of journeys) {
      if (j.ac_ids && j.ac_ids.includes(acId)) {
        const steps = j.steps || [];
        const lastStep = steps[steps.length - 1];
        if (lastStep && lastStep.screenshot) {
          const ssPath = path.join(absArtifacts, lastStep.screenshot);
          if (fs.existsSync(ssPath)) {
            screenshotSrc = `data:image/png;base64,${fs.readFileSync(ssPath).toString('base64')}`;
          }
          break;
        }
      }
    }

    items.push({
      id: acId,
      tier: item.tier || '',
      text: item.criterion_text || '',
      rationale: item.rationale || item.evidence || '',
      humanAction: item.human_action || '',
      screenshot: screenshotSrc
    });
  }

  return JSON.stringify(items);
}

function buildIterationTimelineHtml() {
  const iterLog = readJsonOr(path.join(absArtifacts, 'iteration-log.json'), null);
  if (!iterLog || !iterLog.iterations || !iterLog.iterations.length) return '';

  let html = '';

  for (let idx = 0; idx < iterLog.iterations.length; idx++) {
    const iter = iterLog.iterations[idx];
    const isFirst = idx === 0;
    const isLast = idx === iterLog.iterations.length - 1;
    const hasFails = iter.fail_count > 0;
    const cardClass = isLast ? 'iteration-card iteration-card-current' : 'iteration-card';

    html += `<div class="${cardClass}">`;
    html += `<div class="iter-card-header">`;
    html += `<div>`;
    if (isFirst && !isLast) {
      html += `<strong style="font-size:0.875rem">Original</strong>`;
      html += ` <span style="font-size:0.7rem;color:var(--text2)">(MR baseline)</span>`;
      html += ` <a href="evaluation-report-original.html" target="_blank" style="font-size:0.7rem;margin-left:0.3rem">(full report ↗)</a>`;
    } else if (isLast && !isFirst) {
      html += `<strong style="font-size:0.875rem">Iteration ${iter.iteration - 1}</strong>`;
      html += ` <span style="font-size:0.7rem;color:var(--accent)">(current)</span>`;
    } else if (isFirst && isLast) {
      html += `<strong style="font-size:0.875rem">Current</strong>`;
      html += ` <span style="font-size:0.7rem;color:var(--accent)">(single run, no loop)</span>`;
    } else {
      html += `<strong style="font-size:0.875rem">Iteration ${iter.iteration - 1}</strong>`;
      html += ` <a href="evaluation-report-iter-${iter.iteration}.html" style="font-size:0.7rem;margin-left:0.3rem">(view report)</a>`;
    }
    html += `<span class="iter-counts" style="margin-left:0.75rem">${iter.pass_count}P / ${iter.fail_count}F / ${iter.flagged_count}FL</span>`;
    if (iter.usability_score) {
      html += `<span style="font-size:0.7rem;color:var(--text2);margin-left:0.5rem">Usability: ${iter.usability_score}/21</span>`;
    }
    if (iter.iteration > 1) {
      const prev = iterLog.iterations[iter.iteration - 2];
      if (prev) {
        const delta = iter.pass_count - prev.pass_count;
        if (delta > 0) html += `<span class="iter-delta iter-delta-up">+${delta} fixed</span>`;
        else if (delta < 0) html += `<span class="iter-delta iter-delta-down">${delta} regressed</span>`;
      }
    }
    html += `</div>`;
    html += `</div>`;

    // Fail summary for non-final iterations
    if (hasFails && iter.details) {
      let failIds = [];
      if (Array.isArray(iter.details.fail_criteria)) {
        failIds = iter.details.fail_criteria;
      } else if (typeof iter.details === 'object') {
        failIds = Object.entries(iter.details)
          .filter(([, v]) => String(v).toUpperCase().startsWith('FAIL'))
          .map(([k]) => k);
      }
      if (failIds.length) {
        html += `<div class="iter-fail-summary">`;
        html += `<strong style="font-size:0.7rem;color:var(--status-danger)">FAILED:</strong> `;
        html += escapeHtml(failIds.join(', '));
        html += `</div>`;
      }
    }

    // Changes applied (for iterations after the first)
    const fixes = iter.changes_applied || iter.fixes_applied;
    if (fixes && fixes.length) {
      html += `<div class="iter-fixes-list">`;
      html += `<span style="font-size:0.7rem;font-weight:600;color:var(--status-success)">FIXED:</span>`;
      html += `<table style="margin:0.3rem 0 0;width:100%;font-size:0.8rem;border-collapse:collapse">`;
      for (const change of fixes) {
        const criterion = change.criterion || '';
        const file = change.file ? change.file.split('/').pop() : '';
        const desc = change.change || change.description || '';
        html += `<tr style="border-bottom:1px solid var(--border)">`;
        html += `<td style="padding:0.25rem 0.5rem 0.25rem 0;width:5rem;vertical-align:top">`;
        if (criterion) html += `<code style="font-size:0.7rem;color:var(--accent);font-weight:600">${escapeHtml(criterion)}</code>`;
        html += `</td>`;
        html += `<td style="padding:0.25rem 0;font-size:0.8rem;color:var(--text)">${escapeHtml(desc.slice(0, 100))}${desc.length > 100 ? '...' : ''}</td>`;
        html += `<td style="padding:0.25rem 0 0.25rem 0.5rem;text-align:right;vertical-align:top"><code style="font-size:0.65rem;color:var(--text2)">${escapeHtml(file)}</code></td>`;
        html += `</tr>`;
      }
      html += `</table></div>`;
    }

    // Root cause (before state — why things failed)
    if (iter.root_cause) {
      html += `<div style="margin-top:0.5rem;font-size:0.75rem;padding:0.5rem 0.75rem;background:rgba(239,68,68,0.04);border-radius:0.375rem;border-left:2px solid var(--status-danger)">`;
      html += `<strong style="font-size:0.65rem;color:var(--status-danger)">ROOT CAUSE:</strong> `;
      html += `<span style="color:var(--text)">${escapeHtml(iter.root_cause)}</span>`;
      html += `</div>`;
    }

    // Flagged resolution (items determined unfixable in prototype scope)
    if (iter.flagged_resolution && Object.keys(iter.flagged_resolution).length) {
      html += `<div style="margin-top:0.5rem;font-size:0.75rem;padding:0.5rem 0.75rem;background:rgba(234,179,8,0.04);border-radius:0.375rem;border-left:2px solid var(--status-warning)">`;
      html += `<strong style="font-size:0.65rem;color:var(--status-warning)">UNFIXABLE (out of scope):</strong>`;
      html += `<ul style="margin:0.25rem 0 0 1rem;padding:0;font-size:0.75rem;color:var(--text2)">`;
      for (const [id, info] of Object.entries(iter.flagged_resolution)) {
        const reason = typeof info === 'string' ? info : (info.reason || '');
        html += `<li><code>${escapeHtml(id)}</code> — ${escapeHtml(reason)}</li>`;
      }
      html += `</ul></div>`;
    }

    // Verification (before/after)
    if (iter.verification) {
      html += `<div style="margin-top:0.5rem;font-size:0.75rem;padding:0.5rem 0.75rem;background:rgba(22,163,74,0.04);border-radius:0.375rem;border-left:2px solid var(--status-success)">`;
      for (const [key, val] of Object.entries(iter.verification)) {
        const label = key.replace(/_/g, ' ');
        html += `<div style="margin:0.15rem 0"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(val)}</div>`;
      }
      html += `</div>`;
    }

    html += `</div>`;
  }

  // Loop summary
  const exitSuccess = iterLog.exit_reason === 'all_pass' || iterLog.exit_reason === 'all_fixable_pass' || iterLog.exit_reason === 'unfixable_flagged' || iterLog.exit_reason === 'all_fixable_resolved';
  const exitBg = exitSuccess ? 'rgba(22,163,74,0.04)' : 'var(--bg2)';
  const exitBorder = exitSuccess ? 'var(--status-success)' : 'var(--border)';

  html += `<div style="margin-top:0.75rem;padding:0.75rem 1rem;background:${exitBg};border-radius:0.375rem;border:1px solid var(--border);border-left:3px solid ${exitBorder}">`;
  html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem">`;
  html += `<span style="color:${exitSuccess ? 'var(--status-success)' : 'var(--text2)'};font-size:1rem">${exitSuccess ? '&#x2713;' : '&#x25CF;'}</span>`;
  html += `<strong style="font-size:0.85rem">Loop complete</strong>`;
  html += `</div>`;

  // Summary of what was accomplished
  const totalFixes = iterLog.total_criteria_fixed || 0;
  const lastIter = iterLog.iterations[iterLog.iterations.length - 1];
  const firstIter = iterLog.iterations[0];
  html += `<p style="font-size:0.8rem;color:var(--text);margin:0 0 0.35rem">`;
  html += `<strong>${firstIter.pass_count}P → ${lastIter.pass_count}P</strong> over ${iterLog.iterations.length} iterations. `;
  if (totalFixes > 0) html += `${totalFixes} criteria fixed. `;
  html += `${lastIter.flagged_count || 0} items remain for human review.`;
  const firstUsab = firstIter.usability_score;
  const lastUsab = lastIter.usability_score;
  if (firstUsab && lastUsab && firstUsab !== lastUsab) {
    html += ` Usability: ${firstUsab} → ${lastUsab}/21.`;
  }
  html += `</p>`;

  // Exit reason detail
  html += `<p style="font-size:0.75rem;color:var(--text2);margin:0 0 0.35rem">${escapeHtml(iterLog.exit_details || iterLog.exit_detail || iterLog.exit_reason)}</p>`;

  // Files changed
  if (iterLog.files_modified && iterLog.files_modified.length) {
    html += `<details style="margin:0.35rem 0 0"><summary style="font-size:0.7rem;color:var(--text2);cursor:pointer">Files changed (${iterLog.files_modified.length})</summary>`;
    html += `<ul style="margin:0.25rem 0 0 1rem;font-size:0.7rem;color:var(--text2)">`;
    for (const f of iterLog.files_modified) {
      html += `<li><code>${escapeHtml(f)}</code></li>`;
    }
    html += `</ul></details>`;
  }

  html += `</div>`;

  return html;
}

function buildReviewItemsHtml(csvRows, journeyLog, screenshots) {
  const flagged = csvRows.filter(r => (r.verdict || '').toUpperCase() === 'FLAGGED');
  if (!flagged.length) return '<p class="muted">No items flagged for review.</p>';

  const journeys = journeyLog ? journeyLog.journeys || [] : [];

  let html = '';
  for (const item of flagged) {
    const acId = item.criterion_id || '';
    const tier = item.tier || '';
    const criterion = item.criterion_text || '';
    const rationale = item.rationale || item.evidence || '';
    const humanAction = item.human_action || '';

    // Find a relevant screenshot from journeys that test this AC
    let screenshotSrc = '';
    for (const j of journeys) {
      if (j.ac_ids && j.ac_ids.includes(acId)) {
        const steps = j.steps || [];
        const lastStep = steps[steps.length - 1];
        if (lastStep && lastStep.screenshot) {
          const ssPath = path.join(absArtifacts, lastStep.screenshot);
          if (fs.existsSync(ssPath)) {
            const b64 = fs.readFileSync(ssPath).toString('base64');
            screenshotSrc = `data:image/png;base64,${b64}`;
          }
          break;
        }
      }
    }

    html += `<div class="review-item">`;
    html += `<div class="review-item-header">`;
    html += `<span class="review-item-id">${escapeHtml(acId)}</span>`;
    html += `<span class="badge badge-flagged">FLAGGED</span>`;
    html += `<span class="review-item-tier">Tier ${escapeHtml(tier)}</span>`;
    html += `</div>`;
    html += `<div class="review-item-body">`;
    html += `<div class="review-item-criterion">${escapeHtml(criterion)}</div>`;

    if (rationale) {
      html += `<div class="review-item-evidence"><strong>Why flagged:</strong> ${escapeHtml(rationale)}</div>`;
    }
    if (humanAction) {
      html += `<p style="font-size:0.75rem;color:var(--accent);margin:0.5rem 0"><strong>Action needed:</strong> ${escapeHtml(humanAction)}</p>`;
    }

    if (screenshotSrc) {
      html += `<div class="review-item-screenshot"><img loading="lazy" src="${screenshotSrc}" alt="Screenshot for ${escapeHtml(acId)}"></div>`;
    }

    html += `<div class="review-override" data-override-ac="${escapeHtml(acId)}">`;
    html += `<span style="font-size:0.75rem;color:var(--text2);align-self:center">Override:</span>`;
    html += `<button data-verdict="PASS" onclick="overrideVerdict('${escapeHtml(acId)}','PASS')">PASS</button>`;
    html += `<button data-verdict="FAIL" onclick="overrideVerdict('${escapeHtml(acId)}','FAIL')">FAIL</button>`;
    html += `<input type="hidden" id="override-${escapeHtml(acId)}" value="">`;
    html += `</div>`;

    html += `<textarea class="review-textarea" data-ac="${escapeHtml(acId)}" placeholder="Your assessment — what did you observe when testing this in the prototype?"></textarea>`;
    html += `<div style="margin-top:0.5rem;display:flex;gap:0.5rem">`;
    html += `<a href="#ac-results" onclick="scrollToSection('ac-results');return false" style="font-size:0.7rem;color:var(--accent)">View in AC table</a>`;
    html += `<a href="#" onclick="openReviewModal('${escapeHtml(acId)}');return false" style="font-size:0.7rem;color:var(--accent)">Open review modal</a>`;
    html += `</div>`;
    html += `</div></div>`;
  }
  return html;
}

function buildFixesHtml() {
  const suggestions = readJsonOr(path.join(absArtifacts, 'refinement-suggestions.json'), null);
  const fixLog = readJsonOr(path.join(absArtifacts, 'fix-log.json'), null);
  const iterLog = readJsonOr(path.join(absArtifacts, 'iteration-log.json'), null);
  const journeyLog = readJsonOr(path.join(absArtifacts, 'journey-log.json'), null);
  const consistencyReport = readJsonOr(path.join(absArtifacts, 'consistency-report.json'), null);

  let html = '';
  const iterations = iterLog ? iterLog.iterations || [] : [];
  const totalIterations = iterations.length;
  const appliedFixes = fixLog ? (Array.isArray(fixLog) ? fixLog : fixLog.applied || []) : [];

  // Summary of what the eval found
  const totalFindings = appliedFixes.length + (suggestions ? (Array.isArray(suggestions) ? suggestions.length : 0) : 0);
  if (totalFindings === 0 && !consistencyReport) {
    return '<p class="muted small">No findings or changes from this evaluation. All acceptance criteria passed without modification.</p>';
  }

  // Applied fixes section
  if (appliedFixes.length) {
    html += `<h3 style="margin-top:0">Changes Made</h3>`;
    html += `<p class="small" style="margin:-0.25rem 0 0.75rem">The evaluation found issues and applied these fixes to make the prototype pass acceptance criteria.</p>`;
    html += `<div style="display:flex;flex-direction:column;gap:1rem">`;

    for (const fix of appliedFixes) {
      const iteration = fix.iteration || 1;
      html += `<div class="card">`;

      // What was wrong and why it was fixed
      if (fix.criterion_id || fix.ac_id) {
        const acId = fix.criterion_id || fix.ac_id;
        const jIdx = findJourneyForAC(journeyLog, acId);
        const journeyTitle = (jIdx && journeyLog.journeys[jIdx - 1]) ? journeyLog.journeys[jIdx - 1].title : '';
        html += `<div style="margin-bottom:0.75rem">`;
        html += `<p style="margin:0 0 0.25rem;font-weight:600;font-size:0.9375rem"><span style="color:var(--accent);font-family:var(--font-mono)">${escapeHtml(acId)}</span> ${journeyTitle ? '— ' + escapeHtml(journeyTitle) : ''}</p>`;
        html += `<span class="badge badge-pass" style="font-size:0.6rem">Fixed in iteration ${iteration}</span>`;
        html += `</div>`;
      }

      // Why — the rationale
      if (fix.description || fix.rationale || fix.change) {
        html += `<div style="margin-bottom:0.75rem">`;
        html += `<p class="small" style="margin:0 0 0.15rem;font-weight:600;color:var(--text2)">Why this was changed</p>`;
        html += `<p style="margin:0;font-size:0.875rem;line-height:1.5">${escapeHtml(fix.description || fix.rationale || fix.change)}</p>`;
        html += `</div>`;
      }

      // Code change
      if (fix.file) {
        html += `<code class="small" style="display:block;margin:0.5rem 0 0.25rem;color:var(--accent)">${escapeHtml(fix.file)}${fix.line ? ':' + fix.line : ''}</code>`;
      }
      if (fix.before || fix.current) {
        html += `<div style="margin:0.25rem 0;padding:0.5rem;background:var(--bg2);border-radius:4px;font-family:var(--font-mono);font-size:0.75rem;line-height:1.5;overflow-x:auto">`;
        html += `<div style="color:var(--status-danger)">- ${escapeHtml(fix.before || fix.current)}</div>`;
        if (fix.after || fix.fix) html += `<div style="color:var(--status-success)">+ ${escapeHtml(fix.after || fix.fix)}</div>`;
        html += `</div>`;
      }

      // Screenshot reference
      if (fix.criterion_id || fix.ac_id) {
        const acId = fix.criterion_id || fix.ac_id;
        const journeyIdx = findJourneyForAC(journeyLog, acId);
        if (journeyIdx !== null) {
          const afterDir = path.join(absArtifacts, 'screenshots');
          const afterFile = findScreenshotForJourney(afterDir, journeyIdx);
          if (afterFile) {
            const b64 = fs.readFileSync(afterFile).toString('base64');
            html += `<div style="margin-top:0.75rem"><p class="small muted" style="margin:0 0 0.25rem">Result after fix (from Phase A verification)</p>`;
            html += `<img src="data:image/png;base64,${b64}" style="width:100%;border:1px solid var(--border);border-radius:4px" /></div>`;
          }
        }
      }

      html += `</div>`;
    }
    html += `</div>`;
  }

  // Consistency and usability findings (always shown)
  const allSuggestions = suggestions ? (Array.isArray(suggestions) ? suggestions : []) : [];
  const consistencyViols = consistencyReport ? (consistencyReport.source_mode?.violations || []) : [];

  if (allSuggestions.length || consistencyViols.length) {
    html += `<h3 style="margin-top:${appliedFixes.length ? '2rem' : '0'}">Design Findings</h3>`;
    html += `<p class="small" style="margin:-0.25rem 0 0.75rem">Issues identified by the consistency checker against PatternFly design guidelines. These weren't blocking acceptance criteria but should be reviewed for design quality.</p>`;
    html += `<div style="display:flex;flex-direction:column;gap:0.75rem">`;

    // Use consistency report violations (richer data) if available, fall back to suggestions
    const findings = consistencyViols.length ? consistencyViols : allSuggestions;

    for (const f of findings) {
      const guideline = f.guideline_id || '';
      const severity = f.severity || 'warning';
      const sevColor = severity === 'error' ? 'var(--status-danger)' : 'var(--status-warning)';
      const file = f.file || '';
      const line = f.line || '';
      const description = f.description || f.current || '';
      const suggestion = f.suggestion || f.fix || '';

      html += `<div class="card card-compact">`;

      // Header with guideline and severity
      html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">`;
      html += `<span style="font-weight:600;font-size:0.875rem">${escapeHtml(guideline)}</span>`;
      html += `<span class="small" style="color:${sevColor};font-weight:500;text-transform:uppercase">${escapeHtml(severity)}</span>`;
      html += `</div>`;

      // What's wrong and where
      if (description) {
        html += `<p style="margin:0 0 0.5rem;font-size:0.875rem;line-height:1.5">${escapeHtml(description)}</p>`;
      }

      if (file) {
        html += `<code class="small" style="display:block;margin:0.25rem 0;color:var(--accent)">${escapeHtml(file)}${line ? ':' + line : ''}</code>`;
      }

      // Current vs suggested
      if (f.current) html += `<div style="margin:0.25rem 0;padding:0.25rem 0.5rem;background:var(--bg2);border-radius:3px;font-family:var(--font-mono);font-size:0.75rem;color:var(--status-danger)">- ${escapeHtml(f.current)}</div>`;
      if (suggestion) html += `<div style="margin:0.25rem 0;padding:0.25rem 0.5rem;background:var(--bg2);border-radius:3px;font-family:var(--font-mono);font-size:0.75rem;color:var(--status-success)">+ ${escapeHtml(suggestion)}</div>`;

      // Why this matters
      if (f.pf_doc_url || f.guideline_title) {
        const why = f.guideline_title || `PatternFly guideline: ${guideline}`;
        html += `<p class="small muted" style="margin:0.5rem 0 0;font-style:italic">Why: ${escapeHtml(why)} — ensures visual consistency with the Red Hat design system.</p>`;
      }

      // Page reference
      const pageHint = file.match(/\/(\w+)\/(\w+)\.(tsx|jsx)/);
      if (pageHint) {
        html += `<p class="small muted" style="margin:0.25rem 0 0">Visible on: ${escapeHtml(pageHint[2])} page</p>`;
      }

      html += `</div>`;
    }
    html += `</div>`;
  }

  return html || '<p class="muted small">No findings from this evaluation.</p>';
}

function findJourneyForAC(journeyLog, acId) {
  if (!journeyLog || !journeyLog.journeys) return null;
  for (let i = 0; i < journeyLog.journeys.length; i++) {
    const j = journeyLog.journeys[i];
    if (j.ac_ids && j.ac_ids.includes(acId)) return i + 1;
  }
  return null;
}

function findScreenshotForJourney(dir, journeyIdx) {
  if (!fs.existsSync(dir)) return null;
  const target = `journey-${journeyIdx}-step-1.png`;
  const filePath = path.join(dir, target);
  return fs.existsSync(filePath) ? filePath : null;
}

function findScreenshotForFile(screenshotsDir, file, journeyLog) {
  if (!fs.existsSync(screenshotsDir) || !journeyLog || !journeyLog.journeys) return null;
  const shortFile = file.replace('src/app/', '').replace('src/', '').toLowerCase();
  for (const j of journeyLog.journeys) {
    const target = (j.title || '').toLowerCase();
    if (shortFile.includes('deployment') && target.includes('deployment')) {
      const ssPath = path.join(screenshotsDir, `journey-${journeyLog.journeys.indexOf(j) + 1}-step-1.png`);
      if (fs.existsSync(ssPath)) return ssPath;
    }
    if (j.steps) {
      for (const s of j.steps) {
        if (s.screenshot) {
          const ssPath = path.join(path.dirname(screenshotsDir), s.screenshot);
          if (fs.existsSync(ssPath)) return ssPath;
        }
      }
    }
  }
  const files = fs.readdirSync(screenshotsDir).filter(f => f.startsWith('journey-') && f.endsWith('.png')).sort();
  if (files.length) return path.join(screenshotsDir, files[0]);
  return null;
}

function buildConsistencyHtml() {
  const report = readJsonOr(path.join(absArtifacts, 'consistency-report.json'), null);
  if (!report) return '<p class="muted small">No consistency data. Run with `.context/consistency-checker/` bootstrapped to enable.</p>';

  const summary = report.summary || {};
  const srcMode = report.source_mode;
  const violations = (srcMode && srcMode.violations) || [];
  let html = '';

  // Summary stats
  html += `<div class="consistency-summary">`;
  html += `<div class="consistency-stat"><span class="consistency-stat-n">${summary.total_guidelines_checked || 0}</span><span class="consistency-stat-l">Checked</span></div>`;
  if (summary.violations) html += `<div class="consistency-stat"><span class="consistency-stat-n" style="color:var(--status-danger)">${summary.violations}</span><span class="consistency-stat-l">Errors</span></div>`;
  if (summary.warnings) html += `<div class="consistency-stat"><span class="consistency-stat-n" style="color:var(--status-warning)">${summary.warnings}</span><span class="consistency-stat-l">Warnings</span></div>`;
  html += `<div class="consistency-stat"><span class="consistency-stat-n" style="color:var(--status-success)">${summary.passes || 0}</span><span class="consistency-stat-l">Passes</span></div>`;
  html += `</div>`;

  if (!violations.length) {
    html += `<p class="muted small">No violations found in MR-scoped files.</p>`;
    return html;
  }

  // ---- Quick Fixes (ranked by impact) ----
  const byGuideline = {};
  for (const v of violations) {
    const k = v.guideline_id;
    if (!byGuideline[k]) byGuideline[k] = { ...v, count: 0, files: new Set() };
    byGuideline[k].count++;
    byGuideline[k].files.add(v.file);
  }

  const quickFixes = Object.values(byGuideline)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  html += `<h3>Quick Fixes</h3>`;
  html += `<p class="small muted" style="margin:-0.25rem 0 0.5rem">Ranked by number of violations eliminated</p>`;

  for (const qf of quickFixes) {
    const sevTag = qf.severity === 'error'
      ? '<span class="delta-tag delta-tag-critical">error</span>'
      : '<span class="delta-tag delta-tag-high">warning</span>';

    html += `<div class="consistency-finding consistency-finding-${qf.severity === 'error' ? 'error' : 'warning'}">`;
    html += `<div class="consistency-finding-head">`;
    html += `<strong style="font-size:0.8125rem">${escapeHtml(qf.guideline_title)}</strong>`;
    html += `<span class="delta-tags">${sevTag}<span class="delta-tag delta-tag-mod">${qf.count} hits</span></span>`;
    html += `</div>`;
    if (qf.suggestion) {
      html += `<p class="consistency-suggestion">${escapeHtml(qf.suggestion)}`;
      if (qf.pf_doc_url) html += ` <a href="${escapeHtml(qf.pf_doc_url)}" target="_blank" style="font-size:0.7rem;margin-left:0.3rem">PatternFly docs &rarr;</a>`;
      html += `</p>`;
    }
    html += `<p class="consistency-guideline">${qf.files.size} file${qf.files.size > 1 ? 's' : ''}: ${[...qf.files].slice(0, 3).map(f => '<code>' + escapeHtml(f.replace('src/app/', '').replace('src/', '')) + '</code>').join(', ')}${qf.files.size > 3 ? ' +' + (qf.files.size - 3) + ' more' : ''}</p>`;
    html += `</div>`;
  }

  // ---- By Page/Component ----
  const byPage = {};
  for (const v of violations) {
    const dir = (v.file || '').replace(/\/[^/]+$/, '').replace('src/app/', '').replace('src/', '');
    const page = dir || 'root';
    if (!byPage[page]) byPage[page] = [];
    byPage[page].push(v);
  }

  const pages = Object.entries(byPage).sort((a, b) => b[1].length - a[1].length);

  html += `<h3 style="margin-top:1.5rem">By Page</h3>`;
  html += `<p class="small muted" style="margin:-0.25rem 0 0.5rem">Violations grouped by component area</p>`;

  for (const [page, pvs] of pages) {
    const errorCount = pvs.filter(v => v.severity === 'error').length;
    const warnCount = pvs.filter(v => v.severity === 'warning').length;
    const label = page.replace(/\//g, ' / ');
    const badge = errorCount
      ? `<span class="delta-tag delta-tag-critical">${errorCount} error${errorCount > 1 ? 's' : ''}</span>`
      : '';
    const warnBadge = warnCount
      ? `<span class="delta-tag delta-tag-high">${warnCount} warn</span>`
      : '';

    html += `<details><summary style="font-size:0.8125rem;font-weight:500;padding:0.4rem 0"><code>${escapeHtml(label)}</code> ${badge}${warnBadge}</summary>`;

    // Deduplicate by guideline within this page
    const seen = new Set();
    for (const v of pvs) {
      const k = v.guideline_id;
      if (seen.has(k)) continue;
      seen.add(k);

      const sameGuideline = pvs.filter(x => x.guideline_id === k);
      const sevCls = v.severity === 'error' ? 'consistency-finding-error' : 'consistency-finding-warning';

      html += `<div class="consistency-finding ${sevCls}" style="margin-left:0.5rem">`;
      html += `<div class="consistency-finding-head">`;
      html += `<span style="font-size:0.75rem;font-weight:500">${escapeHtml(v.guideline_title)}</span>`;
      html += `<span class="delta-tags"><span class="delta-tag delta-tag-mod">${sameGuideline.length} hit${sameGuideline.length > 1 ? 's' : ''}</span></span>`;
      html += `</div>`;
      if (v.suggestion) {
        html += `<p class="consistency-suggestion">${escapeHtml(v.suggestion)}`;
        if (v.pf_doc_url) html += ` <a href="${escapeHtml(v.pf_doc_url)}" target="_blank" style="font-size:0.7rem;margin-left:0.3rem">docs &rarr;</a>`;
        html += `</p>`;
      }
      // Show specific lines
      html += `<div class="consistency-files">`;
      for (const sv of sameGuideline.slice(0, 5)) {
        const short = (sv.file || '').replace('src/app/', '').replace('src/', '');
        html += `<div class="consistency-file-row"><code>${escapeHtml(short)}:${sv.line || '?'}</code></div>`;
      }
      if (sameGuideline.length > 5) html += `<div class="consistency-file-row muted">+${sameGuideline.length - 5} more</div>`;
      html += `</div>`;
      html += `</div>`;
    }

    html += `</details>`;
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
            html += `<div class="screenshot"><img loading="lazy" src="${src}" alt="Step ${step.step}"></div>`;
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
  const extDir = path.join(absArtifacts, 'usability-eval-output');
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
  html += `<p class="small" style="margin:0 0 0.25rem"><strong>Source:</strong> <a href="https://gitlab.cee.redhat.com/zbodnar/automated-usability-testing" target="_blank">automated-usability-testing</a></p>`;
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

  // Annotated screenshots from usability evaluation output
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
        html += `<div style="text-align:center"><img loading="lazy" src="${src}" alt="${escapeHtml(label)}" style="width:100%;border-radius:0.375rem;border:1px solid var(--border)"><p class="small muted" style="margin:0.25rem 0">${escapeHtml(label)}</p></div>`;
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

// ---------------------------------------------------------------------------
// Narrative Summary (designer-facing "what" section)
// ---------------------------------------------------------------------------

function buildNarrativeSummary() {
  const extractState = readJsonOr(path.join(absArtifacts, 'extract-state.json'), null);
  const csvRaw = readFileOr(path.join(absArtifacts, 'evaluation-report.csv'), '');
  const journeyLog = readJsonOr(path.join(absArtifacts, 'journey-log.json'), null);
  const refinements = readJsonOr(path.join(absArtifacts, 'refinement-suggestions.json'), null);
  const iterationLog = readJsonOr(path.join(absArtifacts, 'iteration-log.json'), null);
  const protoId = extractPrototypeId();

  const csvRows = parseCsv(csvRaw);
  let passCount = 0, failCount = 0, flaggedCount = 0;
  for (const r of csvRows) {
    const v = (r.verdict || '').toUpperCase();
    if (v === 'PASS') passCount++;
    else if (v === 'FAIL') failCount++;
    else if (v === 'FLAGGED') flaggedCount++;
  }
  const totalAc = passCount + failCount + flaggedCount;

  const ud = journeyLog ? journeyLog.usability_dimensions : null;
  const usabilityScore = ud ? ud.overall_score || null : null;
  const storyTitle = (extractState && extractState.ticket_summary) || protoId;
  const suggestions = Array.isArray(refinements) ? refinements : (refinements && refinements.suggestions ? refinements.suggestions : []);
  const fixedSuggestions = suggestions.filter(s => (s.verdict || '').toUpperCase() === 'FIXED');
  const openSuggestions = suggestions.filter(s => (s.verdict || '').toUpperCase() !== 'FIXED');

  // --- Verdict ---
  let verdictClass, verdictLabel, verdictIcon;
  if (failCount === 0 && flaggedCount === 0) {
    verdictClass = 'verdict-pass';
    verdictLabel = 'PASS';
    verdictIcon = '&#10003;';
  } else if (failCount > 0) {
    verdictClass = 'verdict-fail';
    verdictLabel = 'NEEDS FIXES';
    verdictIcon = '&#10007;';
  } else {
    verdictClass = 'verdict-review';
    verdictLabel = 'NEEDS REVIEW';
    verdictIcon = '&#9888;';
  }

  // --- Gap items ---
  const failedRows = csvRows.filter(r => (r.verdict || '').toUpperCase() === 'FAIL');
  const flaggedRows = csvRows.filter(r => (r.verdict || '').toUpperCase() === 'FLAGGED');

  let gapHtml = '';
  if (failedRows.length === 0 && flaggedRows.length === 0) {
    gapHtml = `<p class="gap-clear">None &mdash; ready to approve</p>`;
  } else {
    gapHtml = '<div class="gap-items">';
    for (const row of failedRows) {
      const id = row.criterion_id || '?';
      const text = row.criterion_text || '';
      const short = text.length > 70 ? text.slice(0, 67) + '...' : text;
      gapHtml += `<div class="gap-item gap-fail">`;
      gapHtml += `<span class="badge badge-fail">FAIL</span>`;
      gapHtml += `<span class="gap-text"><strong>${escapeHtml(id)}</strong>: ${escapeHtml(short)}</span>`;
      gapHtml += `<button class="action-btn action-fix" onclick="scrollToSection('ac-results')">Fix this</button>`;
      gapHtml += `</div>`;
    }
    for (const row of flaggedRows) {
      const id = row.criterion_id || '?';
      const text = row.criterion_text || '';
      const short = text.length > 70 ? text.slice(0, 67) + '...' : text;
      gapHtml += `<div class="gap-item gap-flagged">`;
      gapHtml += `<span class="badge badge-flagged">REVIEW</span>`;
      gapHtml += `<span class="gap-text"><strong>${escapeHtml(id)}</strong>: ${escapeHtml(short)}</span>`;
      gapHtml += `<button class="action-btn action-review" onclick="scrollToSection('flagged')">Review</button>`;
      gapHtml += `</div>`;
    }
    gapHtml += '</div>';
  }

  // --- Auto-fixed section ---
  let autoFixedHtml = '';
  if (fixedSuggestions.length > 0 || (iterationLog && iterationLog.total_criteria_fixed > 0)) {
    const fixCount = fixedSuggestions.length || (iterationLog ? iterationLog.total_criteria_fixed : 0);
    autoFixedHtml = `<div class="autofixed-section">`;
    autoFixedHtml += `<h4>Auto-fixed by the eval (no action needed)</h4>`;
    autoFixedHtml += `<p>${fixCount} issue${fixCount > 1 ? 's' : ''} resolved automatically:</p>`;
    autoFixedHtml += `<ul>`;
    for (const s of fixedSuggestions.slice(0, 5)) {
      autoFixedHtml += `<li>${escapeHtml(s.criterion_text || s.description || s.fix_action || '').slice(0, 80)}</li>`;
    }
    autoFixedHtml += `</ul>`;
    autoFixedHtml += `</div>`;
  }

  // --- Action buttons ---
  let actionsHtml = '';
  if (failCount === 0 && flaggedCount === 0) {
    actionsHtml = '';
  } else if (failCount > 0) {
    actionsHtml = `<div class="action-bar"><button class="action-btn action-fix" onclick="scrollToSection('ac-results')">View Failures</button></div>`;
  } else {
    actionsHtml = `<div class="action-bar"><button class="action-btn action-review" onclick="scrollToSection('flagged')">Review Flagged Items</button></div>`;
  }

  // --- RFE / Outcome summary ---
  const outcomeContext = readJsonOr(path.join(absArtifacts, 'outcome-context.json'), null);
  const rfeKey = extractState ? extractState.rfe_key : null;
  let rfeSummaryHtml = '';
  if (outcomeContext && outcomeContext.problem_statement) {
    rfeSummaryHtml = `<div class="overview-rfe"><p class="overview-rfe-text">${escapeHtml(outcomeContext.problem_statement)}</p></div>`;
  }

  // --- Iteration summary ---
  let iterSummaryHtml = '';
  if (iterationLog) {
    const iters = iterationLog.iterations || [];
    const iterCount = iters.length;
    const exitReason = iterationLog.exit_reason || '';
    const totalFixed = iterationLog.total_criteria_fixed || 0;
    const consistencyFixes = iters.reduce((sum, i) => sum + (i.consistency_fixes || 0), 0);
    const phaseB = iterationLog.phase_b || {};
    const personasEvaluated = phaseB.personas_evaluated || [];

    let iterParts = [];
    if (iterCount > 0) iterParts.push(`${iterCount} iteration${iterCount > 1 ? 's' : ''}`);
    if (totalFixed > 0) iterParts.push(`${totalFixed} criteria fixed`);
    if (consistencyFixes > 0) iterParts.push(`${consistencyFixes} consistency fixes applied`);
    if (personasEvaluated.length > 0) iterParts.push(`${personasEvaluated.length} persona${personasEvaluated.length > 1 ? 's' : ''} tested`);

    if (iterParts.length) {
      iterSummaryHtml = `<div class="overview-iter"><p class="small" style="color:var(--text2);margin:0">${iterParts.join(' · ')}</p></div>`;
    }
  }

  // --- Assemble ---
  let html = `<section class="report-overview" data-onboarding="true">`;

  html += `<div class="overview-verdict ${verdictClass}" data-tour="verdict">`;
  html += `<span class="verdict-icon">${verdictIcon}</span>`;
  html += `<span class="verdict-label">${verdictLabel}</span>`;
  html += `</div>`;

  html += `<div class="overview-context">`;
  html += `<p class="overview-title">${escapeHtml(storyTitle)}</p>`;
  html += `<p class="overview-meta">${escapeHtml(protoId)}${rfeKey ? ' · RFE: ' + escapeHtml(rfeKey) : ''}${usabilityScore ? ' · Usability: ' + escapeHtml(String(usabilityScore)) : ''}</p>`;
  html += `</div>`;

  html += rfeSummaryHtml;
  html += iterSummaryHtml;

  html += `<div class="overview-gap" data-tour="gap">`;
  html += `<div class="gap-header">`;
  html += `<span class="gap-expected"><strong>Expected:</strong> ${totalAc} acceptance criteria</span>`;
  html += `<span class="gap-actual"><strong>Actual:</strong> ${passCount}/${totalAc} met${flaggedCount > 0 ? ', ' + flaggedCount + ' need review' : ''}${failCount > 0 ? ', ' + failCount + ' failed' : ''}</span>`;
  html += `</div>`;
  html += gapHtml;
  html += `</div>`;

  html += autoFixedHtml;

  html += `<div data-tour="actions">${actionsHtml}</div>`;

  html += `</section>`;

  return html;
}

function buildTokens(opts = {}) {
  const protoId = extractPrototypeId();
  const csvRaw = readFileOr(opts.csvPath || path.join(absArtifacts, 'evaluation-report.csv'), '');
  const journeyLog = readJsonOr(opts.journeyLogPath || path.join(absArtifacts, 'journey-log.json'), null);
  const extractState = readJsonOr(path.join(absArtifacts, 'extract-state.json'), null);
  const screenshotsDir = opts.screenshotsDir || path.join(absArtifacts, 'screenshots');
  const screenshots = loadScreenshots(screenshotsDir);

  const csvRows = parseCsv(csvRaw);

  // Outcome context (needed by screenshot modal)
  const outcomeContext = readJsonOr(path.join(absArtifacts, 'outcome-context.json'), null);

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
  const rawUsability = ud ? ud.overall_score || '—' : '—';
  const usabilityScore = String(rawUsability).replace(/\/21$/, '').trim();

  // Metadata from JSON artifacts (no MD dependency)
  const storyTitle = (extractState && extractState.ticket_summary) || protoId;
  const depth = (extractState && extractState.depth) || (journeyLog && journeyLog.depth) || 'quick';
  const evalDateRaw = (journeyLog && journeyLog.evaluated_at) || '';
  const evalDate = evalDateRaw ? new Date(evalDateRaw).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  // Generate description from results
  let description = '';
  if (passCount + failCount + flaggedCount > 0) {
    description = `${storyTitle} — ${passCount} passed, ${failCount} failed, ${flaggedCount} flagged for review`;
  } else {
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

  // Build consistency violations per-AC lookup for CSV column + table badges
  const cReport = readJsonOr(path.join(absArtifacts, 'consistency-report.json'), null);
  const consistencyViolationIds = new Set();
  if (cReport && cReport.source_mode && cReport.source_mode.violations) {
    for (const v of cReport.source_mode.violations) {
      consistencyViolationIds.add(v.guideline_id);
    }
  }
  const consistencyBadge = consistencyViolationIds.size
    ? ` <span class="sa-tag sa-error" style="font-size:0.55rem;vertical-align:middle" title="${consistencyViolationIds.size} design guideline violations found on prototype pages">${consistencyViolationIds.size} design issues</span>`
    : '';

  // Build AC-to-screenshot map from journeys for clickable evidence
  const acScreenshotMap = {};
  for (const journey of journeys) {
    const acIds = journey.ac_ids || [];
    const steps = journey.steps || [];
    for (const acId of acIds) {
      if (acScreenshotMap[acId]) continue;
      const lastStep = steps[steps.length - 1];
      if (lastStep && lastStep.screenshot) {
        const ssFile = path.basename(lastStep.screenshot);
        if (screenshots[ssFile]) {
          acScreenshotMap[acId] = { file: ssFile, journey: journey.title || '', persona: journey.persona || '' };
        }
      }
    }
  }

  // Count persona coverage per AC from task definitions
  const tasksDefined = extractState ? (extractState.tasks_to_be_done || []) : [];
  const acPersonaCoverage = {};
  const ud2 = journeyLog ? journeyLog.usability_dimensions : null;
  const personasEval = (ud2 && ud2.personas_evaluated) ? ud2.personas_evaluated : [];
  for (const td of tasksDefined) {
    for (const acId of (td.covers_acs || [])) {
      if (!acPersonaCoverage[acId]) acPersonaCoverage[acId] = 0;
      acPersonaCoverage[acId] += personasEval.length;
    }
  }

  function buildAcRow(r) {
    const id = escapeHtml(r.criterion_id);
    const rawText = r.criterion_text || '';
    const truncLen = 120;
    const needsTrunc = rawText.length > truncLen;
    const shortText = needsTrunc ? escapeHtml(rawText.slice(0, truncLen).replace(/\s+\S*$/, '')) + '...' : escapeHtml(rawText);
    const criterionHtml = needsTrunc
      ? `<span class="ac-text-short">${shortText} <button class="ac-expand" onclick="this.parentElement.style.display='none';this.parentElement.nextElementSibling.style.display=''">[more]</button></span><span class="ac-text-full" style="display:none">${escapeHtml(rawText)} <button class="ac-expand" onclick="this.parentElement.style.display='none';this.parentElement.previousElementSibling.style.display=''">[less]</button></span>`
      : escapeHtml(rawText);
    const verdict = badgeHtml(r.verdict, r.criterion_id);
    const evidence = escapeHtml(r.rationale || r.evidence || '');
    const hasPersonaEvidence = acPersonaCoverage[r.criterion_id] > 0;
    const ssInfo = acScreenshotMap[r.criterion_id];
    let viewLink = '';
    if (hasPersonaEvidence || ssInfo) {
      const label = hasPersonaEvidence ? 'View walkthrough' : 'View';
      viewLink = `<a href="#" class="ac-view-link" onclick="openAcEvidence('${escapeHtml(r.criterion_id)}');return false">${label}</a>`;
    }
    return `<tr><td><strong>${id}</strong></td><td>${criterionHtml}</td><td>${verdict}</td><td class="small">${evidence}${evidence && viewLink ? '<br>' : ''}${viewLink}</td></tr>`;
  }

  const acTableRowsJira = jiraRows.map(buildAcRow).join('\n');
  const acTableRowsInferred = inferredRows.map(buildAcRow).join('\n');

  const acJiraCount = jiraRows.length;

  // ---- Breadcrumb ----
  // Resolve Jira instance URL based on project key prefix
  function jiraUrlForKey(key) {
    if (!key) return '';
    if (key.startsWith('RHOAIUX-')) return `https://redhat.atlassian.net/browse/${key}`;
    return `https://issues.redhat.com/browse/${key}`;
  }

  // Render a breadcrumb link — validated links become anchors, unvalidated become plain text with tooltip
  function breadcrumbLink(key, url, label, validated) {
    const displayText = escapeHtml(label || key || '');
    if (validated === false || !url) {
      return `<span title="Link could not be verified" style="color:var(--text2)">${displayText}</span>`;
    }
    return `<a href="${escapeHtml(url)}">${displayText}</a>`;
  }

  let breadcrumbHtml = '';
  if (journeyLog && journeyLog.breadcrumb) {
    const bc = journeyLog.breadcrumb;
    const parts = [];
    if (bc.rfe && bc.rfe.key) {
      const rfeUrl = bc.rfe.url || jiraUrlForKey(bc.rfe.key);
      parts.push(breadcrumbLink(bc.rfe.key, rfeUrl, bc.rfe.key + ' (RFE)', bc.rfe.validated !== false));
    }
    // Outcome link (between RFE and STRAT)
    if (outcomeContext && outcomeContext.key) {
      parts.push(`<a href="${escapeHtml(jiraUrlForKey(outcomeContext.key))}">${escapeHtml(outcomeContext.key)} (Outcome)</a>`);
    }
    if (bc.strat && bc.strat.key) {
      const stratUrl = bc.strat.url || jiraUrlForKey(bc.strat.key);
      parts.push(breadcrumbLink(bc.strat.key, stratUrl, bc.strat.key + ' (STRAT)', bc.strat.validated !== false));
    }
    if (bc.mr) parts.push(`<a href="${escapeHtml(bc.mr.url)}">${escapeHtml(bc.mr.id)}</a>`);
    else if (bc.prototype) parts.push(`<a href="${escapeHtml(bc.prototype.url)}">${escapeHtml(bc.prototype.label)}</a>`);
    parts.push('Eval Report');
    breadcrumbHtml = parts.join('<span class="sep">→</span>');
  } else {
    const fallbackRfeKey = (extractState && extractState.rfe_key) || null;
    const parts = [];
    if (fallbackRfeKey) {
      parts.push(`<a href="${jiraUrlForKey(fallbackRfeKey)}">${fallbackRfeKey} (RFE)</a>`);
    }
    // Outcome in fallback breadcrumb
    if (outcomeContext && outcomeContext.key) {
      parts.push(`<a href="${escapeHtml(jiraUrlForKey(outcomeContext.key))}">${escapeHtml(outcomeContext.key)} (Outcome)</a>`);
    }
    parts.push(`<a href="${escapeHtml(jiraUrlForKey(protoId) || jiraUrl)}">${escapeHtml(protoId)} (STRAT)</a>`);
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

  function registerScreenshot(filename, narration, stepContext) {
    const src = screenshots[filename];
    if (!src) return -1;
    const idx = screenshotIdx++;
    screenshotIndexMap[filename] = idx;
    screenshotArray.push({
      src, narration: narration || '', filename,
      step: stepContext || null
    });
    return idx;
  }

  // ---- Consistency lookup for screenshot annotations ----
  const consistencyReport = readJsonOr(path.join(absArtifacts, 'consistency-report.json'), null);
  const consistencyByRoute = {};
  const consistencyByScreenshot = {};

  // Map visual findings by screenshot filename for modal display
  if (consistencyReport && consistencyReport.visual_mode && consistencyReport.visual_mode.findings) {
    for (const f of consistencyReport.visual_mode.findings) {
      if (f.verdict !== 'VIOLATION') continue;
      const ssKey = f.screenshot ? path.basename(f.screenshot) : null;
      if (!ssKey) continue;
      if (!consistencyByScreenshot[ssKey]) consistencyByScreenshot[ssKey] = [];
      consistencyByScreenshot[ssKey].push(f);
    }
  }

  if (consistencyReport && consistencyReport.source_mode && consistencyReport.source_mode.violations) {
    const routeMap = {
      'AppLayout': '/',
      'AgentCatalog/AgentCatalog': '/ai-hub/agents/catalog',
      'AgentCatalog/AgentCatalogDetails': '/ai-hub/agents/catalog/:id',
      'AgentCatalog/AgentDeployments': '/ai-hub/agents/deployments',
      'Deployments/Deployments': '/ai-hub/models',
      'Deployments/RegisterExternalModel': '/ai-hub/models',
      'FeatureFlags': '/',
      'routes': '/',
      'ContextPanel': '/'
    };

    for (const v of consistencyReport.source_mode.violations) {
      const file = v.file || '';
      for (const [pattern, route] of Object.entries(routeMap)) {
        if (file.includes(pattern)) {
          if (!consistencyByRoute[route]) consistencyByRoute[route] = [];
          const key = v.guideline_id + ':' + route;
          if (!consistencyByRoute[route].find(x => x._key === key)) {
            consistencyByRoute[route].push({ ...v, _key: key });
          }
          break;
        }
      }
    }
  }

  const globalShellFiles = new Set(['AppLayout', 'FeatureFlags', 'routes', 'ContextPanel']);
  const importLinePattern = /^(import |} from |export (interface|type|const) )/;

  function isGlobalShellViolation(v) {
    const f = v.file || '';
    return [...globalShellFiles].some(g => f.includes(g));
  }

  function isImportFalsePositive(v) {
    const desc = (v.description || '').trim();
    return importLinePattern.test(desc) || desc.endsWith(',') && desc.split(/\s+/).length <= 2;
  }

  function getConsistencyForStep(step, ssFilename) {
    const target = (step.target || '').toLowerCase();
    const pageViolations = [];
    const shellViolations = [];

    // Source-mode violations matched by route
    for (const [route, violations] of Object.entries(consistencyByRoute)) {
      if (target.includes(route) || (route === '/' && step.action === 'navigate' && target.includes('localhost'))) {
        for (const v of violations) {
          if (isImportFalsePositive(v)) continue;
          const bucket = isGlobalShellViolation(v) ? shellViolations : pageViolations;
          if (!bucket.find(m => m.guideline_id === v.guideline_id)) bucket.push(v);
        }
      }
    }

    // Visual-mode findings matched by screenshot filename
    if (ssFilename && consistencyByScreenshot[ssFilename]) {
      for (const f of consistencyByScreenshot[ssFilename]) {
        if (!pageViolations.find(m => m.guideline_id === f.guideline_id)) {
          pageViolations.push({
            guideline_id: f.guideline_id,
            guideline_title: f.guideline_title || f.guideline_id,
            category: f.category || '',
            severity: f.severity || 'warning',
            file: '',
            line: null,
            description: f.description || '',
            suggestion: f.suggestion || '',
            pf_doc_url: f.pf_doc_url || ''
          });
        }
      }
    }

    return { page: pageViolations, shell: shellViolations, all: [...pageViolations, ...shellViolations] };
  }

  // ---- Exploration persona reactions lookup ----
  const explorationReactions = {};
  const explorationData = journeyLog ? journeyLog.exploration || [] : [];
  for (const expl of explorationData) {
    for (const step of (expl.steps || [])) {
      if (step.screenshot && step.persona_reaction) {
        explorationReactions[path.basename(step.screenshot)] = {
          persona: expl.persona_name || expl.persona,
          reaction: step.persona_reaction
        };
      }
    }
  }

  // ---- Journey Blocks ----
  const journeyColors = ['#0066cc', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#dc2626'];
  let journeyBlocksHtml = '';
  const pathRows = [];

  for (const journey of journeys) {
    const jIdx = journeys.indexOf(journey);
    const jColor = journeyColors[jIdx % journeyColors.length];
    const divider = journeyBlocksHtml ? '<div class="journey-divider"></div>' : '';
    let block = `${divider}<h3 style="border-left:4px solid ${jColor};padding-left:0.6rem">${escapeHtml(journey.title)}</h3>`;
    // Extract AC reference for prominent badge display — prefer ac_ids array, fall back to parsing source
    let acLabels = [];
    if (Array.isArray(journey.ac_ids) && journey.ac_ids.length > 0) {
      acLabels = journey.ac_ids;
    } else {
      const acMatch = (journey.source || '').match(/(?:Inferred from |Story \d+ \+ )?(AC-\d+|NAV-\d+|HLR-\d+)/gi);
      if (acMatch) acLabels = acMatch.map(m => m.replace(/^(?:Inferred from |Story \d+ \+ )/i, ''));
    }
    const acBadge = acLabels.length > 0 ? acLabels.map(ac => `<span class="badge" style="background:rgba(0,102,204,0.1);color:#0066cc;margin-right:0.4rem">Testing ${escapeHtml(ac)}</span>`).join('') : '';
    block += `<p class="small muted" style="padding-left:calc(0.6rem + 4px)">${acBadge}<strong>Persona:</strong> ${escapeHtml(journey.persona)} · <strong>Source:</strong> ${escapeHtml(journey.source)} · <strong>Verdict:</strong> ${badgeHtml(journey.verdict)}</p>`;

    const steps = journey.steps || [];
    const renderedScreenshots = new Set();

    for (let si = 0; si < steps.length; si++) {
      const step = steps[si];

      // Find screenshot
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

      // Check if the NEXT step uses the same screenshot — if so, merge narrations
      let mergedSteps = [step];
      if (ssFilename) {
        while (si + 1 < steps.length) {
          const nextStep = steps[si + 1];
          const nextSs = nextStep.screenshot ? path.basename(nextStep.screenshot) : null;
          if (nextSs === ssFilename) {
            mergedSteps.push(nextStep);
            si++;
          } else break;
        }
      }

      // Render step headers (all merged steps) with patience meter
      block += `<div style="margin:1rem 0">`;
      for (const ms of mergedSteps) {
        block += `<p class="small"><strong>Step ${ms.step}</strong> — ${escapeHtml(ms.action)} → <code>${escapeHtml(ms.target)}</code> · ${badgeHtml(ms.result === 'success' ? 'PASS' : 'FAIL')}`;
        if (ms.timestamp_ms !== undefined) block += ` · <span class="mono muted">${ms.timestamp_ms}ms</span>`;
        // Inline patience meter — show if persona overlay has a confusion event at this step
        if (ud && ud.persona_overlays) {
          for (const ov of ud.persona_overlays) {
            const confEvent = (ov.confusion_events || []).find(e => e.step === ms.step || e.step === parseFloat(ms.step));
            if (confEvent) {
              const patienceAfter = Math.max(0, (ov.patience_start || 100) + (ov.confusion_events || []).filter(e => (e.step || 0) <= ms.step).reduce((sum, e) => sum + (e.patience_cost || 0), 0));
              const pColor = patienceAfter > 60 ? '#16a34a' : patienceAfter > 30 ? '#d97706' : '#dc2626';
              block += ` · <span style="display:inline-flex;align-items:center;gap:0.3rem;font-size:0.75rem;font-family:var(--font-mono)"><span style="width:80px;height:6px;background:#eaeaea;border-radius:3px;overflow:hidden;display:inline-block"><span style="height:100%;width:${patienceAfter}%;background:${pColor};display:block;border-radius:3px"></span></span> <span style="color:${pColor}">${confEvent.patience_cost}%</span></span>`;
              break;
            }
          }
        }
        block += `</p>`;
      }
      if (ssFilename && screenshots[ssFilename] && !renderedScreenshots.has(ssFilename)) {
        renderedScreenshots.add(ssFilename);
        const cResult = getConsistencyForStep(step, ssFilename);
        const reaction = explorationReactions[ssFilename];

        const overlays = ud ? (ud.persona_overlays || []) : [];
        const scoreImpacts = [];
        const seenDims = new Set();
        for (const ms of mergedSteps) {
          if (ms.action === 'navigate-assisted' || ms.url_fallback) {
            if (ud && ud.dimensions) {
              for (const d of ud.dimensions) {
                if (seenDims.has(d.name)) continue;
                for (const [pid, s] of Object.entries(d.scores)) {
                  if (s.assisted_nav_impact) {
                    seenDims.add(d.name);
                    scoreImpacts.push({ dim: d.name, score: d.composite_score || s.score, note: 'Capped by navigate-assisted at this step', persona: pid });
                    break;
                  }
                }
              }
            }
          }
          const stepOvs = overlays.filter(o => (o.confusion_events || []).some(e => e.step === ms.step || e.step === parseFloat(ms.step)));
          for (const ov of stepOvs) {
            const confEvent = (ov.confusion_events || []).find(e => e.step === ms.step || e.step === parseFloat(ms.step));
            if (confEvent && !seenDims.has('Patience:' + ov.persona)) {
              seenDims.add('Patience:' + ov.persona);
              // Compute cumulative patience at this step
              const priorCosts = (ov.confusion_events || []).filter(e => (e.step || 0) <= ms.step).reduce((sum, e) => sum + (e.patience_cost || 0), 0);
              const patienceAfter = Math.max(0, (ov.patience_start || 100) + priorCosts);
              scoreImpacts.push({ dim: 'Patience', score: null, note: `${ov.persona_name}: ${confEvent.trigger} (${confEvent.patience_cost}%)`, persona: ov.persona, patienceAfter });
            }
          }
        }

        const mergedNarrations = mergedSteps.map(ms => ms.narration).filter(Boolean).join(' ');

        const stepCtx = {
          stepNum: mergedSteps.map(ms => ms.step).join(', '),
          action: step.action || '',
          target: step.target || '',
          result: step.result || '',
          error: mergedSteps.map(ms => ms.error).filter(Boolean).join('; '),
          rootCause: mergedSteps.map(ms => ms.root_cause).filter(Boolean).join('; '),
          journeyTitle: journey.title,
          journeyIdx: jIdx,
          journeyColor: jColor,
          journeySource: journey.source || '',
          acIds: journey.ac_ids || [],
          persona: journey.persona,
          verdict: mergedSteps.some(ms => ms.result !== 'success') ? 'FAIL' : 'PASS',
          violations: cResult.page.map(cf => ({
            id: cf.guideline_id, title: cf.guideline_title || cf.guideline_id,
            severity: cf.severity, file: (cf.file || '').replace('src/app/', '').replace('src/', ''),
            line: cf.line, description: cf.description || '', suggestion: cf.suggestion || '', pfDocUrl: cf.pf_doc_url || '', category: cf.category || '', isShell: false
          })),
          shellViolations: cResult.shell.map(cf => ({
            id: cf.guideline_id, title: cf.guideline_title || cf.guideline_id,
            severity: cf.severity, file: (cf.file || '').replace('src/app/', '').replace('src/', ''),
            line: cf.line, description: cf.description || '', suggestion: cf.suggestion || '', pfDocUrl: cf.pf_doc_url || '', category: cf.category || '', isShell: true
          })),
          personaReaction: reaction ? { name: reaction.persona, text: reaction.reaction }
            : step.persona_reaction ? { name: journey.persona || 'Persona', text: step.persona_reaction }
            : null,
          scoreImpacts: scoreImpacts.slice(0, 5),
          outcomeContext: outcomeContext ? { key: outcomeContext.key || '', problem: (outcomeContext.problem_statement || '').slice(0, 200), criteria: (outcomeContext.acceptance_criteria || []).slice(0, 5) } : null,
          // Persona patience states at this step — filtered to overlays matching this journey
          personaPatience: (ud && ud.persona_overlays || [])
            .filter(ov => !ov.journey_id || ov.journey_id === journey.id)
            .map(ov => {
            const priorCosts = (ov.confusion_events || []).filter(e => (e.step || 0) <= (mergedSteps[mergedSteps.length - 1].step || 0)).reduce((sum, e) => sum + (e.patience_cost || 0), 0);
            const patienceNow = Math.max(0, (ov.patience_start || 100) + priorCosts);
            const confAtStep = (ov.confusion_events || []).find(e => mergedSteps.some(ms => e.step === ms.step || e.step === parseFloat(ms.step)));
            return { persona: ov.persona_name || ov.persona, patience: patienceNow, trigger: confAtStep ? confAtStep.trigger : null, cost: confAtStep ? confAtStep.patience_cost : null };
          }),
          // AC criterion texts for clickable badges
          acTexts: (journey.ac_ids || []).reduce((map, id) => {
            const row = [...jiraRows, ...inferredRows].find(r => r.criterion_id === id);
            if (row) map[id] = row.criterion_text || '';
            return map;
          }, {})
        };

        const idx = registerScreenshot(ssFilename, mergedNarrations, stepCtx);
        if (idx >= 0) {
          block += `<div class="screenshot-card">`;
          block += `<div class="screenshot" data-idx="${idx}"><img loading="lazy" src="${screenshots[ssFilename]}" alt="Step ${step.step}"></div>`;

          if (mergedNarrations) {
            block += `<div class="narration">${escapeHtml(mergedNarrations)}</div>`;
          }

          const allFindings = [...cResult.page, ...cResult.shell];
          if (allFindings.length) {
            block += `<div class="screenshot-annotations">`;
            for (const cf of cResult.page) {
              const sevCls = cf.severity === 'error' ? 'sa-error' : 'sa-warning';
              const detailId = `sa-detail-${journeys.indexOf(journey)}-${step.step}-${cf.guideline_id}`.replace(/[^a-zA-Z0-9-]/g, '-');
              block += `<div class="sa-item">`;
              block += `<button class="sa-tag ${sevCls}" onclick="document.getElementById('${detailId}').toggleAttribute('open')">${escapeHtml(cf.guideline_title || cf.guideline_id)}</button>`;
              block += `<details id="${detailId}" class="sa-detail"><summary style="display:none"></summary><div class="sa-detail-body">`;
              if (cf.file) block += `<div class="sa-location"><code>${escapeHtml((cf.file || '').replace('src/app/', '').replace('src/', '') + (cf.line ? ':' + cf.line : ''))}</code></div>`;
              if (cf.suggestion) block += `<p class="sa-fix"><strong>Fix:</strong> ${escapeHtml(cf.suggestion)}</p>`;
              if (cf.pf_doc_url) block += `<a href="${escapeHtml(cf.pf_doc_url)}" target="_blank" class="sa-doc-link">PatternFly documentation &rarr;</a>`;
              block += `</div></details></div>`;
            }
            if (cResult.shell.length) {
              block += `<details class="sa-shell-toggle"><summary class="small muted">${cResult.shell.length} global shell issue${cResult.shell.length > 1 ? 's' : ''} (AppLayout, nav, flags)</summary><div class="screenshot-annotations" style="border-top:none;padding-top:0">`;
              for (const cf of cResult.shell) {
                const sevCls = cf.severity === 'error' ? 'sa-error' : 'sa-warning';
                block += `<span class="sa-tag ${sevCls}" title="${escapeHtml(cf.suggestion || '')}">${escapeHtml(cf.guideline_title || cf.guideline_id)}</span>`;
              }
              block += `</div></details>`;
            }
            block += `</div>`;
          }

          if (reaction) {
            block += `<div class="screenshot-persona"><strong>${escapeHtml(reaction.persona)}:</strong> <em>${escapeHtml(reaction.reaction)}</em></div>`;
          }

          block += `</div>`;
        }
      } else if (!ssFilename || !screenshots[ssFilename]) {
        for (const ms of mergedSteps) {
          if (ms.narration) block += `<div class="narration">${escapeHtml(ms.narration)}</div>`;
        }
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

    const unassistedPass = steps.filter(s => s.result === 'success' && s.action !== 'navigate-assisted').length;
    const matchPct = journey.steps_expected > 0
      ? Math.round((unassistedPass / journey.steps_expected) * 100) + '%'
      : '—';
    const matchClass = unassistedPass === journey.steps_expected ? 'color:var(--status-success)' : unassistedPass === 0 ? 'color:var(--status-danger)' : 'color:var(--status-warning)';
    let drift = '—';
    if (journey.verdict !== 'PASS') {
      const failStep = steps.find(s => s.result !== 'success' && s.action !== 'navigate-assisted');
      if (failStep) {
        const reason = failStep.error ? failStep.error.substring(0, 60) : 'step failed';
        drift = `Step ${failStep.step}: ${reason}`;
      }
    }
    pathRows.push(`<tr><td>${escapeHtml(journey.title)}</td><td>${escapeHtml(journey.persona)}</td><td>${journey.steps_expected}</td><td>${unassistedPass}</td><td style="${matchClass};font-weight:500">${matchPct}</td><td class="small">${escapeHtml(drift)}</td></tr>`);
  }

  // ---- Append exploration as additional journey blocks ----
  if (explorationData.length) {
    journeyBlocksHtml += `<div class="journey-divider"></div>`;
    journeyBlocksHtml += `<h3 style="color:var(--text2)">Exploration — beyond prescribed journeys</h3>`;
    journeyBlocksHtml += `<p class="small muted" style="margin:-0.25rem 0 1rem">Pages the persona visited after the prescribed AC journeys. Same browser session, same state.</p>`;

    for (const expl of explorationData) {
      const pName = escapeHtml(expl.persona_name || expl.persona);
      let block = `<p class="small"><strong>${pName}</strong> · ${escapeHtml(expl.goal || '')}</p>`;
      if (expl.prescribed_gap) {
        block += `<p class="small muted" style="margin:0 0 0.75rem">${escapeHtml(expl.prescribed_gap)}</p>`;
      }

      for (const step of (expl.steps || [])) {
        block += `<div style="margin:1rem 0">`;
        block += `<p class="small"><strong>Step ${step.step}</strong> — ${escapeHtml(step.action || '')} → <code>${escapeHtml(step.target || '')}</code> · ${badgeHtml(step.result === 'success' ? 'PASS' : 'FAIL')}</p>`;

        const ssFile = step.screenshot ? path.basename(step.screenshot) : null;
        if (ssFile && screenshots[ssFile]) {
          const exploCtx = {
            stepNum: step.step, action: step.action || '', target: step.target || '',
            result: step.result || '', error: '', rootCause: '',
            journeyTitle: 'Exploration', persona: pName, verdict: step.result === 'success' ? 'PASS' : 'FAIL',
            violations: getConsistencyForStep(step, ssFile).page.map(cf => ({
              id: cf.guideline_id, title: cf.guideline_title || cf.guideline_id,
              severity: cf.severity, file: (cf.file || '').replace('src/app/', '').replace('src/', ''),
              line: cf.line, description: cf.description || '', suggestion: cf.suggestion || '', pfDocUrl: cf.pf_doc_url || '', category: cf.category || ''
            })),
            shellViolations: getConsistencyForStep(step, ssFile).shell.map(cf => ({
              id: cf.guideline_id, title: cf.guideline_title || cf.guideline_id,
              severity: cf.severity, file: (cf.file || '').replace('src/app/', '').replace('src/', ''),
              line: cf.line, description: cf.description || '', suggestion: cf.suggestion || '', pfDocUrl: cf.pf_doc_url || '', category: cf.category || ''
            })),
            personaReaction: step.persona_reaction ? { name: pName, text: step.persona_reaction } : null,
            scoreImpacts: []
          };
          const idx = registerScreenshot(ssFile, step.narration || '', exploCtx);
          if (idx >= 0) {
            block += `<div class="screenshot-card">`;
            block += `<div class="screenshot" data-idx="${idx}"><img loading="lazy" src="${screenshots[ssFile]}" alt="Explore step ${step.step}"></div>`;
            if (step.narration) block += `<div class="narration">${escapeHtml(step.narration)}</div>`;
            if (step.persona_reaction) {
              block += `<div class="screenshot-persona"><strong>${pName}:</strong> <em>${escapeHtml(step.persona_reaction)}</em></div>`;
            }
            block += `</div>`;
          }
        } else {
          if (step.narration) block += `<div class="narration">${escapeHtml(step.narration)}</div>`;
          if (step.persona_reaction) {
            block += `<div class="screenshot-persona"><strong>${pName}:</strong> <em>${escapeHtml(step.persona_reaction)}</em></div>`;
          }
        }
        block += `</div>`;
      }
      journeyBlocksHtml += block;
    }
  }

  const pathLegend = `<details open class="path-legend"><summary class="small muted">What do these columns mean?</summary><div class="card card-compact" style="margin-top:0.5rem"><dl class="path-legend-dl">` +
    `<dt>Journey</dt><dd>A user goal derived from the Jira acceptance criteria (e.g., "Browse Agent Catalog" comes from AC-1).</dd>` +
    `<dt>Persona</dt><dd>The simulated user profile walking through this journey — their expertise level affects what friction they encounter.</dd>` +
    `<dt>Expected</dt><dd>How many UI steps the journey should take if the feature works correctly (click sidebar, click card, verify content, etc.).</dd>` +
    `<dt>Actual</dt><dd>How many steps completed successfully <strong>without URL workarounds</strong>. Steps that required direct URL navigation (navigate-assisted) are not counted — they mean the page exists but a real user can't find it.</dd>` +
    `<dt>Match</dt><dd>Actual / Expected as a percentage. <strong style="color:var(--status-success)">100%</strong> = the journey works end-to-end. <strong style="color:var(--status-warning)">50-99%</strong> = partially blocked. <strong style="color:var(--status-danger)">&lt;50%</strong> = mostly broken.</dd>` +
    `<dt>Drift Notes</dt><dd>Where the journey broke — the specific step and what went wrong (e.g., "sidebar nav missing" or "detail page content too sparse").</dd>` +
    `</dl></div></details>`;

  const pathComparisonTable = pathRows.length
    ? `<table class="tbl mb1"><thead><tr><th>Journey</th><th>Target Role</th><th>Expected</th><th>Actual</th><th>Match</th><th>Drift Notes</th></tr></thead><tbody>${pathRows.join('\n')}</tbody></table>${pathLegend}`
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

    thinkAloudComparison = `<h2>INF vs Think-Aloud Comparison <a class="help-anchor" href="#scoring-methodology" onclick="document.getElementById('scoring-methodology').open=true;return true" title="How scores are calculated">?</a></h2><p class="small muted" style="margin:-0.5rem 0 1rem"><strong>INF (Inference)</strong> scores are derived from structural analysis of the Playwright journey evidence — what the evaluator observes about the UI flow without role-playing a persona. <strong>TA (Think-Aloud)</strong> scores come from persona walkthroughs where each persona navigates the prototype at their own competence level, experiencing confusion, patience drain, and knowledge gaps in real-time. A positive delta means the UI works better in practice than the structure suggests; negative means real users struggle more than expected.</p><table class="tbl"><thead><tr><th>Dimension</th><th>INF Score</th><th>TA Score</th><th>Delta</th></tr></thead><tbody>${compRows}</tbody></table>`;
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
    let hasEmptyContext = false;
    for (const r of flaggedRows) {
      const rationale = r.rationale || '';
      const humanAction = r.human_action || '';
      if (!rationale && !humanAction) hasEmptyContext = true;
      const rationaleDisplay = rationale || '<span class="muted" style="font-style:italic">Review this criterion against the prototype directly</span>';
      const actionDisplay = humanAction || '<span class="muted" style="font-style:italic">Verify manually</span>';
      rows += `<tr><td><strong>${escapeHtml(r.criterion_id)}</strong></td><td class="small">${escapeHtml(r.criterion_text)}</td><td>${escapeHtml(r.tier)}</td><td class="small">${rationaleDisplay}</td><td class="small">${actionDisplay}</td></tr>`;
    }
    let contextNote = '';
    if (hasEmptyContext) {
      contextNote = '<p style="font-size:0.75rem;color:var(--text2);margin:0.75rem 0 0;font-style:italic">Flagged items could not be fully evaluated by the automated pipeline — they require human expertise to verify (e.g., comparing against an external reference, validating business logic, or confirming visual consistency with another system).</p>';
    }
    flaggedHtml = `<table class="tbl"><thead><tr><th>ID</th><th>Criterion</th><th>Tier</th><th>Why Flagged</th><th>Action Needed</th></tr></thead><tbody>${rows}</tbody></table>${contextNote}`;
  } else {
    flaggedHtml = '<p style="color:var(--status-success);font-size:0.875rem">&#10003; No items flagged for human review. All criteria were evaluable by the automated pipeline.</p>';
  }

  // ---- Methodology ----
  const methodologyFallback = `
    <p><strong>This evaluation runs a 3-phase automated pipeline:</strong></p>
    <ol style="font-size:0.8125rem;line-height:1.7;color:var(--text)">
      <li><strong>Extract</strong> — Fetches the Jira STRAT ticket, extracts acceptance criteria verbatim, identifies personas and user journeys from the linked RFE, and maps the SDLC breadcrumb (Outcome → RFE → STRAT → Prototype).</li>
      <li><strong>Journey Walkthroughs</strong> — Generates Playwright scripts that navigate the prototype as different personas. Each acceptance criterion is classified into evaluation tiers. Screenshots are captured at every step. Design consistency is checked against PatternFly guidelines.</li>
      <li><strong>Usability Scoring</strong> — Scores 7 dimensions (workflow continuity, cross-persona handoffs, scalability, system status, technical abstraction, mental model fidelity, accessibility) per persona. Optionally runs a think-aloud protocol where the evaluator role-plays a persona's internal monologue.</li>
    </ol>
    <p style="font-size:0.8125rem;color:var(--text2);margin-top:0.75rem">Verdicts: <strong>PASS</strong> = criterion met, <strong>FAIL</strong> = not implemented or broken, <strong>FLAGGED</strong> = requires human judgment (e.g., comparing against an external system the pipeline cannot access).</p>
  `;
  const methodologyHtml = methodologyFallback;

  // ---- Conclusion (generated from results) ----
  let conclusionHtml = '';
  if (passCount + failCount + flaggedCount > 0) {
    const total = passCount + failCount + flaggedCount;
    const passRate = Math.round((passCount / total) * 100);
    const iterLog = readJsonOr(path.join(absArtifacts, 'iteration-log.json'), null);
    const iterations = iterLog ? (iterLog.iterations || []).length : 1;
    const fixCount = iterLog ? iterLog.total_criteria_fixed || 0 : 0;
    const usabilityScore = ud ? ud.overall_score : null;
    const personasEvaluated = ud ? (ud.personas_evaluated || []) : [];
    const extractState = readJsonOr(path.join(absArtifacts, 'extract-state.json'), null);

    conclusionHtml += `<p>This evaluation identified <strong>${total} acceptance criteria</strong> from the Jira ticket`;
    if (extractState && extractState.rfe_key) conclusionHtml += ` (linked from RFE ${extractState.rfe_key})`;
    conclusionHtml += ` and verified each against the live prototype.`;
    if (iterations > 1) conclusionHtml += ` The pipeline ran <strong>${iterations} iterations</strong>, fixing ${fixCount} criteria that initially failed.`;
    conclusionHtml += `</p>`;

    conclusionHtml += `<p style="font-size:1.1rem;font-weight:600;margin:1rem 0">${passCount}/${total} passing (${passRate}%)`;
    if (usabilityScore) conclusionHtml += ` · Usability: ${usabilityScore}`;
    conclusionHtml += `</p>`;

    if (failCount > 0) {
      conclusionHtml += `<p style="color:var(--status-danger)">${failCount} criteria still failing — requires implementation attention before this prototype is reviewable.</p>`;
    }

    if (flaggedCount > 0) {
      conclusionHtml += `<p style="color:var(--status-warning)">&#9888; ${flaggedCount} flagged for human review — requires verification against external references or backend systems.</p>`;
    }

    if (usabilityScore && ud.dimensions) {
      const lowDims = ud.dimensions.filter(d => d.composite_score <= 1.5);
      const highDims = ud.dimensions.filter(d => d.composite_score >= 2.5);
      if (lowDims.length || highDims.length) {
        conclusionHtml += `<div style="margin-top:1rem;display:grid;grid-template-columns:1fr 1fr;gap:1rem">`;
        if (highDims.length) {
          conclusionHtml += `<div><p class="small" style="font-weight:600;color:var(--status-success);margin:0 0 0.25rem">Strengths</p>`;
          conclusionHtml += `<ul class="small" style="margin:0;padding-left:1rem">`;
          for (const d of highDims) {
            const finding = d.scores ? Object.values(d.scores).map(s => s.finding).filter(Boolean)[0] : '';
            conclusionHtml += `<li><strong>${escapeHtml(d.name)}</strong> (${d.composite_score}/3)`;
            if (finding) conclusionHtml += `<br><span class="muted" style="font-size:0.75rem">${escapeHtml(finding.slice(0, 120))}</span>`;
            conclusionHtml += `</li>`;
          }
          conclusionHtml += `</ul></div>`;
        }
        if (lowDims.length) {
          conclusionHtml += `<div><p class="small" style="font-weight:600;color:var(--status-danger);margin:0 0 0.25rem">Needs Improvement</p>`;
          conclusionHtml += `<ul class="small" style="margin:0;padding-left:1rem">`;
          for (const d of lowDims) {
            const finding = d.scores ? Object.values(d.scores).map(s => s.finding).filter(Boolean)[0] : '';
            conclusionHtml += `<li><strong>${escapeHtml(d.name)}</strong> (${d.composite_score}/3)`;
            if (finding) conclusionHtml += `<br><span class="muted" style="font-size:0.75rem">${escapeHtml(finding.slice(0, 120))}</span>`;
            conclusionHtml += `</li>`;
          }
          conclusionHtml += `</ul></div>`;
        }
        conclusionHtml += `</div>`;
      }

      if (personasEvaluated.length) {
        conclusionHtml += `<p class="small muted" style="margin-top:1rem">Usability tested with: ${personasEvaluated.join(', ')}</p>`;
      }
    }
  } else {
    conclusionHtml = '<p>No evaluation data available.</p>';
  }

  // ---- AI Insights (empty without MD) ----
  const aiInsights = '';
  const aiInsightsDisplay = 'display:none';

  // ---- Outcome context for modal display (loaded earlier in function) ----

  // ---- Screenshot array for JS ----
  const screenshotArrayStr = screenshotArray.map(s =>
    `{src:${JSON.stringify(s.src)},narration:${JSON.stringify(s.narration)},filename:${JSON.stringify(s.filename)},step:${JSON.stringify(s.step || null)}}`
  ).join(',\n');

  // Build AC evidence data for client-side openAcEvidence()
  const acEvidenceData = {};
  for (const [acId, info] of Object.entries(acScreenshotMap)) {
    const idx = screenshotIndexMap[info.file];
    if (idx !== undefined) {
      acEvidenceData[acId] = { idx, journey: info.journey, persona: info.persona };
    } else if (screenshots[info.file]) {
      const newIdx = registerScreenshot(info.file, `Evidence for ${acId}`, { ac: acId });
      if (newIdx >= 0) acEvidenceData[acId] = { idx: newIdx, journey: info.journey, persona: info.persona };
    }
  }
  const acEvidenceStr = JSON.stringify(acEvidenceData);

  // ---- CSV data for download (full 3-section format) ----
  const fullCsv = buildFullCsv(csvRaw, journeyLog, passCount, failCount, flaggedCount);
  const csvDataEscaped = fullCsv.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

  // Build link URLs
  const rfeKey = (extractState && extractState.rfe_key) || '';
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
    '{{ARTIFACTS_PATH}}': absArtifacts,
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
    '{{STAT_DELTAS}}': buildStatDeltas(passCount, failCount, flaggedCount, usabilityScore, journeyLog),
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
    '{{REPORT_INTRO_HTML}}': buildReportIntroHtml(),
    '{{DELTA_DISPLAY}}': fs.existsSync(path.join(absArtifacts, 'mr-delta.json')) ? '' : 'display:none',
    '{{ITERATION_DISPLAY}}': fs.existsSync(path.join(absArtifacts, 'iteration-log.json')) ? '' : 'display:none',
    '{{ITERATION_TIMELINE_HTML}}': buildIterationTimelineHtml(),
    '{{CSV_DATA}}': csvDataEscaped,
    '{{SCREENSHOT_ARRAY}}': screenshotArrayStr,
    '{{AC_EVIDENCE_DATA}}': acEvidenceStr,
    '{{FLAGGED_DATA}}': buildFlaggedDataArray(csvRows, journeyLog, screenshots),
    '{{PERSONAS_TAB_DISPLAY}}': (ud && ud.personas_evaluated && ud.personas_evaluated.length) ? '' : 'display:none',
    '{{DELTAS_TAB_DISPLAY}}': fs.existsSync(path.join(absArtifacts, 'mr-delta.json')) ? '' : 'display:none',
    '{{PERSONA_SELECTION_HTML}}': buildPersonaSelectionHtml(),
    '{{PERSONA_PROFILES_HTML}}': buildPersonaProfilesHtml(),
    '{{PERSONA_WALKTHROUGHS_HTML}}': buildPersonaWalkthroughsHtml(),
    '{{PERSONA_WALKTHROUGH_DATA}}': buildPersonaWalkthroughData(),
    '{{CODE_DELTAS_HTML}}': buildCodeDeltasHtml(),
    '{{FIXES_HTML}}': buildFixesHtml(),
    '{{FIXES_TAB_DISPLAY}}': fs.existsSync(path.join(absArtifacts, 'refinement-suggestions.json')) || fs.existsSync(path.join(absArtifacts, 'fix-log.json')) || fs.existsSync(path.join(absArtifacts, 'consistency-report.json')) ? '' : 'display:none',
    '{{CONSISTENCY_HTML}}': buildConsistencyHtml(),
    '{{CONSISTENCY_TAB_DISPLAY}}': fs.existsSync(path.join(absArtifacts, 'consistency-report.json')) ? '' : 'display:none',
    '{{REVIEW_TAB_DISPLAY}}': flaggedCount > 0 ? '' : 'display:none',
    '{{REVIEW_ITEMS_HTML}}': buildReviewItemsHtml(csvRows, journeyLog, screenshots),
    '{{EXTERNAL_USABILITY_HTML}}': buildExternalUsabilityHtml(),
    '{{EXTERNAL_USABILITY_DISPLAY}}': fs.existsSync(path.join(absArtifacts, 'usability-eval-output')) ? '' : 'display:none',
    '{{OUTCOME_DISPLAY}}': outcomeContext ? '' : 'display:none',
    '{{OUTCOME_LINK_URL}}': outcomeContext ? jiraUrlForKey(outcomeContext.key) : '',
    '{{OUTCOME_LINK}}': outcomeContext ? `<a href="${escapeHtml(jiraUrlForKey(outcomeContext.key))}" target="_blank">${escapeHtml(outcomeContext.key)}</a> — ${escapeHtml((outcomeContext.title || '').slice(0, 60))}` : '',
    '{{STORY_SOURCE}}': rfeKey
      ? `<a href="${escapeHtml(rfeUrl)}" target="_blank">${escapeHtml(rfeKey)}</a> (RFE)${outcomeContext ? ` → <a href="${escapeHtml(jiraUrlForKey(outcomeContext.key))}" target="_blank">${escapeHtml(outcomeContext.key)}</a> (Outcome)` : ''}`
      : `<a href="${escapeHtml(jiraUrl)}" target="_blank">${escapeHtml(protoId)}</a> (STRAT only)`,
    '{{NARRATIVE_SUMMARY}}': buildNarrativeSummary()
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

function renderTemplate(tokens) {
  let template = fs.readFileSync(templatePath, 'utf8');
  for (const [token, value] of Object.entries(tokens)) {
    template = template.split(token).join(value);
  }
  template = template.replace(/\{\{[A-Z_]+\}\}/g, '');
  return template;
}

function generateIterationReports() {
  // Find archived iteration CSVs
  const iterFiles = [];
  try {
    const files = fs.readdirSync(absArtifacts);
    for (const f of files) {
      const match = f.match(/^evaluation-report-iter-(\d+)\.csv$/);
      if (match) iterFiles.push({ iteration: parseInt(match[1]), csvFile: f });
    }
  } catch {}

  if (!iterFiles.length) return;
  iterFiles.sort((a, b) => a.iteration - b.iteration);

  console.log(`  Generating ${iterFiles.length} iteration snapshot(s)...`);

  for (const { iteration, csvFile } of iterFiles) {
    const iterCsv = readFileOr(path.join(absArtifacts, csvFile), '');
    const iterScreenshotsDir = path.join(absArtifacts, `screenshots-iter-${iteration}`);
    const iterScreenshots = fs.existsSync(iterScreenshotsDir) ? loadScreenshots(iterScreenshotsDir) : {};

    // Build a minimal token set for the iteration snapshot
    const iterRows = parseCsv(iterCsv);
    let passCount = 0, failCount = 0, flaggedCount = 0;
    for (const r of iterRows) {
      const v = (r.verdict || '').toUpperCase();
      if (v === 'PASS') passCount++;
      else if (v === 'FAIL') failCount++;
      else if (v === 'FLAGGED') flaggedCount++;
    }

    const iterLog = readJsonOr(path.join(absArtifacts, 'iteration-log.json'), null);
    const extractState = readJsonOr(path.join(absArtifacts, 'extract-state.json'), null);
    const protoId = extractPrototypeId();
    const storyTitle = (extractState && extractState.ticket_summary) || protoId;

    // Iteration snapshot HTML — shows journey flows with screenshots
    let html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`;
    html += `<title>Iteration ${iteration}: ${escapeHtml(protoId)}</title>`;
    html += `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Red+Hat+Display:wght@400;500;700&family=Red+Hat+Text:wght@400;500&family=Red+Hat+Mono&display=swap">`;
    html += `<style>:root{--bg:#fff;--bg2:#f9f9f9;--text:#1a1a1a;--text2:#6b7280;--border:#eaeaea;--accent:#0066cc;--status-success:#16a34a;--status-danger:#dc2626;--status-warning:#d97706;--font-heading:'Red Hat Display',sans-serif;--font-body:'Red Hat Text',sans-serif;--font-mono:'Red Hat Mono',monospace}`;
    html += `*{box-sizing:border-box}body{margin:0;font-family:var(--font-body);font-size:0.9375rem;line-height:1.6;color:var(--text)}`;
    html += `.header{position:sticky;top:0;z-index:10;background:var(--bg);border-bottom:1px solid var(--border);padding:0.6rem 2rem;display:flex;align-items:center;gap:1.5rem}`;
    html += `.header a{font-size:0.8125rem;color:var(--accent)}`;
    html += `.header h1{font-family:var(--font-heading);font-size:1.1rem;margin:0;flex:1}`;
    html += `.content{padding:1.5rem 2.5rem;max-width:100%}`;
    html += `h2{font-family:var(--font-heading);font-size:1rem;margin:1.5rem 0 0.5rem}`;
    html += `.badge{display:inline-block;padding:0.12rem 0.55rem;border-radius:999px;font-size:0.7rem;font-weight:600;text-transform:uppercase}`;
    html += `.badge-pass{background:rgba(22,163,74,0.12);color:#16a34a}.badge-fail{background:rgba(220,38,38,0.12);color:#dc2626}.badge-flagged{background:rgba(217,119,6,0.12);color:#d97706}`;
    html += `.stats{display:flex;gap:1.25rem;margin:0.75rem 0}.stat-n{font-family:var(--font-heading);font-size:1.25rem;font-weight:700}.stat-l{font-size:0.65rem;color:var(--text2);text-transform:uppercase}`;
    html += `table{width:100%;border-collapse:collapse;font-size:0.8125rem;margin:0.75rem 0}th,td{padding:0.4rem 0.6rem;text-align:left;border-bottom:1px solid var(--border)}th{font-size:0.65rem;color:var(--text2);text-transform:uppercase}`;
    html += `.journey-flow{margin:1.5rem 0;border:1px solid var(--border);border-radius:0.5rem;overflow:hidden}`;
    html += `.journey-header{padding:0.6rem 1rem;background:var(--bg2);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}`;
    html += `.journey-header strong{font-size:0.875rem}`;
    html += `.journey-steps{display:flex;overflow-x:auto;gap:0;scroll-snap-type:x mandatory}`;
    html += `.journey-step{min-width:500px;max-width:600px;scroll-snap-align:start;border-right:1px solid var(--border);flex-shrink:0}`;
    html += `.journey-step:last-child{border-right:none}`;
    html += `.journey-step img{width:100%;display:block}`;
    html += `.journey-step-label{padding:0.3rem 0.6rem;font-size:0.7rem;color:var(--text2);background:var(--bg2);border-top:1px solid var(--border)}`;
    html += `</style></head><body>`;

    // Sticky header — back link on LEFT
    html += `<div class="header">`;
    html += `<a href="evaluation-report.html">← Final report</a>`;
    html += `<h1>Iteration ${iteration} — ${escapeHtml(storyTitle)}</h1>`;
    html += `</div>`;

    html += `<div class="content">`;

    html += `<div class="stats">`;
    html += `<div><div class="stat-n" style="color:var(--status-success)">${passCount}</div><div class="stat-l">Pass</div></div>`;
    html += `<div><div class="stat-n" style="color:var(--status-danger)">${failCount}</div><div class="stat-l">Fail</div></div>`;
    html += `<div><div class="stat-n" style="color:var(--status-warning)">${flaggedCount}</div><div class="stat-l">Flagged</div></div>`;
    html += `</div>`;

    // AC table (compact)
    html += `<h2>Criteria</h2>`;
    html += `<table><thead><tr><th>ID</th><th>Verdict</th><th>Evidence</th></tr></thead><tbody>`;
    for (const r of iterRows) {
      const v = (r.verdict || '').toUpperCase();
      const cls = v === 'PASS' ? 'badge-pass' : v === 'FAIL' ? 'badge-fail' : 'badge-flagged';
      html += `<tr><td><strong>${escapeHtml(r.criterion_id)}</strong></td><td><span class="badge ${cls}">${v}</span></td><td style="font-size:0.75rem;color:var(--text2)">${escapeHtml((r.rationale || r.evidence || '').slice(0, 200))}</td></tr>`;
    }
    html += `</tbody></table>`;

    // Screenshots organized by journey flow (horizontal scroll per journey)
    const ssFiles = Object.keys(iterScreenshots).sort();
    if (ssFiles.length) {
      // Group screenshots by journey
      const journeyGroups = {};
      for (const ssFile of ssFiles) {
        const match = ssFile.match(/^(journey-\d+|explore-[^-]+-[^-]+)/);
        const group = match ? match[1] : 'other';
        if (!journeyGroups[group]) journeyGroups[group] = [];
        journeyGroups[group].push(ssFile);
      }

      html += `<h2>Journey Flows</h2>`;
      for (const [group, files] of Object.entries(journeyGroups)) {
        const label = group.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        html += `<div class="journey-flow">`;
        html += `<div class="journey-header"><strong>${escapeHtml(label)}</strong><span style="font-size:0.7rem;color:var(--text2)">${files.length} steps</span></div>`;
        html += `<div class="journey-steps">`;
        for (const ssFile of files) {
          html += `<div class="journey-step">`;
          html += `<img loading="lazy" src="${iterScreenshots[ssFile]}" alt="${escapeHtml(ssFile)}">`;
          html += `<div class="journey-step-label">${escapeHtml(ssFile.replace('.png', '').replace(/journey-\d+-/, ''))}</div>`;
          html += `</div>`;
        }
        html += `</div></div>`;
      }
    }

    html += `</div>`;
    html += `</body></html>`;

    const iterOutPath = path.join(absArtifacts, `evaluation-report-iter-${iteration}.html`);
    fs.writeFileSync(iterOutPath, html, 'utf8');
    console.log(`  ✓ Iteration ${iteration} snapshot: ${iterOutPath} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
  }
}

function main() {
  if (!fs.existsSync(templatePath)) {
    console.error(`Template not found: ${templatePath}`);
    process.exit(1);
  }

  const tokens = buildTokens();
  const template = renderTemplate(tokens);

  const outPath = path.join(absArtifacts, 'evaluation-report.html');
  fs.writeFileSync(outPath, template, 'utf8');
  console.log(`✓ Report written to ${outPath}`);
  console.log(`  Size: ${(Buffer.byteLength(template) / 1024).toFixed(0)} KB`);

  // Generate per-iteration snapshot reports (shortened versions for intermediates)
  generateIterationReports();

  // Generate FULL original report (same template as final, but using iter-1 data)
  const origCsvPath = path.join(absArtifacts, 'evaluation-report-iter-1.csv');
  const origScreenshotsDir = path.join(absArtifacts, 'screenshots-iter-1');
  if (fs.existsSync(origCsvPath)) {
    const origTokens = buildTokens({
      csvPath: origCsvPath,
      screenshotsDir: origScreenshotsDir,
    });
    let origHtml = renderTemplate(origTokens);
    // Inject distinct title so it's clear this is the baseline/original report
    const origTitle = `${extractPrototypeId()} — ORIGINAL (MR Baseline, Iteration 1)`;
    origHtml = origHtml.replace(/<title>[^<]*<\/title>/, `<title>${origTitle}</title>`);
    origHtml = origHtml.replace(
      /(<header[^>]*>[\s\S]*?<[^>]*id=["']?proto-id["']?[^>]*>)([^<]*)/,
      `$1$2 <span style="background:var(--status-warning);color:#000;padding:0.125rem 0.5rem;border-radius:3px;font-size:0.7rem;margin-left:0.5rem;font-weight:600">ORIGINAL — MR BASELINE</span>`
    );
    const origTarget = path.join(absArtifacts, 'evaluation-report-original.html');
    fs.writeFileSync(origTarget, origHtml, 'utf8');
    console.log(`  ✓ Original (full): ${origTarget} (${(Buffer.byteLength(origHtml) / 1024).toFixed(0)} KB)`);
  }
}

main();
