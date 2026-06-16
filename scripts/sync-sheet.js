#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SPREADSHEET_ID = '1pVpmc4RKLwM-fLAH8mR2uj2hlWX30TGiot8kpg5ETEo';
const SOURCE_SHEET = 'Sheet1';
const EVAL_SHEET = 'Automated Eval';
const ARTIFACTS_BASE = path.join(path.resolve(__dirname, '..'), '.artifacts');
const API_BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

// ── Color palette (0–1 floats for Sheets API) ─────────────────────────
const C = {
  headerBg:    { red: 0.16, green: 0.16, blue: 0.22 },
  white:       { red: 1,    green: 1,    blue: 1    },
  titleBg:     { red: 0.10, green: 0.10, blue: 0.14 },
  subtitleBg:  { red: 0.94, green: 0.94, blue: 0.96 },
  muted:       { red: 0.40, green: 0.40, blue: 0.45 },
  text:        { red: 0.13, green: 0.13, blue: 0.13 },
  zebraOdd:    { red: 0.96, green: 0.97, blue: 0.98 },
  evalBg:      { red: 0.89, green: 0.91, blue: 0.97 },  // soft blue-lavender (neutral "done")
  evalAccent:  { red: 0.40, green: 0.48, blue: 0.75 },  // steel blue left stripe
  passText:    { red: 0.13, green: 0.55, blue: 0.13 },
  passBg:      { red: 0.85, green: 0.94, blue: 0.85 },
  failText:    { red: 0.77, green: 0.12, blue: 0.12 },
  failBg:      { red: 0.96, green: 0.87, blue: 0.87 },
  mixedText:   { red: 0.70, green: 0.53, blue: 0.05 },
  mixedBg:     { red: 0.99, green: 0.96, blue: 0.85 },
  borderLight: { red: 0.82, green: 0.83, blue: 0.85 },
  borderDark:  { red: 0.55, green: 0.56, blue: 0.58 },
};

// Column layout
const COLUMNS = [
  { header: 'Jira Key',       width: 130 },  // A  0
  { header: 'Title',          width: 220 },  // B  1
  { header: 'Designer',       width: 85  },  // C  2
  { header: 'Automated',      width: 85  },  // D  3
  { header: 'Agree',          width: 60  },  // E  4
  { header: 'Usability',      width: 80  },  // F  5
  { header: 'Verdicts',       width: 105 },  // G  6
  { header: 'Eval Date',      width: 85  },  // H  7
  { header: 'Total ACs',      width: 65  },  // I  8
  { header: 'Fail Details',   width: 280 },  // J  9
  { header: 'Flagged Details', width: 280 }, // K  10
  { header: 'MR',             width: 150 },  // L  11
  { header: 'Prototype',      width: 150 },  // M  12
  { header: 'Notes',          width: 200 },  // N  13
];

const TITLE_ROW = 0, SUBTITLE_ROW = 1, HEADER_ROW = 2, DATA_START_ROW = 3;
const COL_COUNT = COLUMNS.length;

// ── API helpers ────────────────────────────────────────────────────────

function getToken() {
  try { return execSync('gcloud auth print-access-token 2>/dev/null', { encoding: 'utf8' }).trim(); }
  catch { console.error('Run: gcloud auth login --enable-gdrive-access'); process.exit(1); }
}

function sheetsGet(token, range) {
  const res = execSync(
    `curl -s -H "Authorization: Bearer ${token}" "${API_BASE}/values/${encodeURIComponent(range)}"`,
    { encoding: 'utf8', maxBuffer: 1024 * 500 }
  );
  return JSON.parse(res);
}

function sheetsPut(token, range, values) {
  const url = `${API_BASE}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const bodyFile = path.join(ARTIFACTS_BASE, '_sync_body.json');
  fs.writeFileSync(bodyFile, JSON.stringify({ values }), 'utf8');
  const res = execSync(
    `curl -s -X PUT -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d @"${bodyFile}" "${url}"`,
    { encoding: 'utf8', maxBuffer: 1024 * 500 }
  );
  try { fs.unlinkSync(bodyFile); } catch {}
  return JSON.parse(res);
}

function sheetsPost(token, endpoint, body) {
  const bodyFile = path.join(ARTIFACTS_BASE, '_sync_body.json');
  fs.writeFileSync(bodyFile, JSON.stringify(body), 'utf8');
  const res = execSync(
    `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d @"${bodyFile}" "${API_BASE}${endpoint}"`,
    { encoding: 'utf8', maxBuffer: 1024 * 500 }
  );
  try { fs.unlinkSync(bodyFile); } catch {}
  return JSON.parse(res);
}

function sheetsClear(token, range) {
  execSync(
    `curl -s -X POST -H "Authorization: Bearer ${token}" "${API_BASE}/values/${encodeURIComponent(range)}:clear"`,
    { encoding: 'utf8', maxBuffer: 1024 * 500 }
  );
}

function getSheetId(token) {
  const meta = JSON.parse(execSync(
    `curl -s -H "Authorization: Bearer ${token}" "${API_BASE}"`,
    { encoding: 'utf8' }
  ));
  const sheet = (meta.sheets || []).find(s => s.properties.title === EVAL_SHEET);
  return sheet ? sheet.properties.sheetId : null;
}

// ── CSV parsing ────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const result = []; let current = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQ = false;
      else current += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { result.push(current); current = ''; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── Eval data reader ───────────────────────────────────────────────────

function readEvalResults(key) {
  const csvPath = path.join(ARTIFACTS_BASE, key, 'evaluation-report.csv');
  if (!fs.existsSync(csvPath)) return null;
  const raw = fs.readFileSync(csvPath, 'utf8').trim();
  const allLines = raw.split('\n').filter(l => !l.startsWith('#'));
  if (allLines.length < 2) return null;

  const headers = parseCSVLine(allLines[0]);
  const acRows = [];
  for (let i = 1; i < allLines.length; i++) {
    const line = allLines[i].trim();
    if (!line) continue;
    const vals = parseCSVLine(line);
    if (vals[0] && /^[a-z_]+$/.test(vals[0]) && vals[0].includes('_') && !vals[0].startsWith('RHAISTRAT')) break;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
    acRows.push(obj);
  }

  const usLines = raw.split('\n'); let inUs = false, usH = null;
  const dimS = {}, dimC = {};
  for (const ul of usLines) {
    if (ul.startsWith('# USABILITY')) { inUs = true; usH = null; continue; }
    if (inUs && ul.startsWith('#')) { inUs = false; continue; }
    if (inUs && !ul.trim()) continue;
    if (inUs && !usH) { usH = parseCSVLine(ul); continue; }
    if (inUs && usH) {
      const v = parseCSVLine(ul);
      const di = usH.indexOf('dimension_id'), si = usH.indexOf('score');
      if (di >= 0 && si >= 0 && v[di]) {
        if (!dimS[v[di]]) { dimS[v[di]] = 0; dimC[v[di]] = 0; }
        dimS[v[di]] += parseInt(v[si]) || 0;
        dimC[v[di]]++;
      }
    }
  }
  let comp = 0;
  for (const [d, s] of Object.entries(dimS)) comp += s / (dimC[d] || 1);
  const usScore = Object.keys(dimS).length ? comp.toFixed(1) + '/21' : '—';

  const jiraRows = acRows.filter(r => (r.source || '') !== 'inferred');
  const navRows = acRows.filter(r => (r.criterion_id || '').startsWith('NAV'));
  const pass = acRows.filter(r => r.verdict === 'PASS').length;
  const fail = acRows.filter(r => r.verdict === 'FAIL').length;
  const flagged = acRows.filter(r => r.verdict === 'FLAGGED').length;
  const hasNavFail = navRows.some(r => r.verdict === 'FAIL');
  const hasJiraFail = jiraRows.some(r => r.verdict === 'FAIL');
  const allJiraPass = jiraRows.every(r => r.verdict === 'PASS');
  const autoLofi = hasNavFail ? 'Fail (nav)' : hasJiraFail ? 'Fail' : allJiraPass ? 'Pass' : 'Mixed';
  const verdict = `${pass}P / ${fail}F / ${flagged}FL`;
  const totalACs = acRows.length;

  const detailLine = (r) => {
    const id = r.criterion_id || '?';
    const txt = (r.criterion_text || r.evidence || '').substring(0, 60);
    return txt ? `${id}: ${txt}` : id;
  };
  const failDetails = acRows.filter(r => r.verdict === 'FAIL').map(detailLine).join('\n');
  const flaggedDetails = acRows.filter(r => r.verdict === 'FLAGGED').map(detailLine).join('\n');

  return { autoLofi, usScore, verdict, pass, fail, flagged, totalACs, failDetails, flaggedDetails, evalDate: new Date().toISOString().split('T')[0] };
}

// ── Formatting helpers ─────────────────────────────────────────────────

function border(color, style = 'SOLID') {
  return { style, width: 1, colorStyle: { rgbColor: color } };
}

function rng(sheetId, r1, r2, c1, c2) {
  return { sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 };
}

function fmt(sheetId, r1, r2, c1, c2, format, fields) {
  return { repeatCell: { range: rng(sheetId, r1, r2, c1, c2), cell: { userEnteredFormat: format }, fields: `userEnteredFormat(${fields})` } };
}

function dim(sheetId, axis, start, end, px) {
  return { updateDimensionProperties: { range: { sheetId, dimension: axis, startIndex: start, endIndex: end }, properties: { pixelSize: px }, fields: 'pixelSize' } };
}

function statusColor(val) {
  const v = (val || '').toLowerCase();
  if (v.startsWith('pass')) return { bg: C.passBg, fg: C.passText };
  if (v.startsWith('fail')) return { bg: C.failBg, fg: C.failText };
  return { bg: C.mixedBg, fg: C.mixedText };
}

function buildFormatRequests(sheetId, dataRows, evalFlags) {
  const req = [];
  const totalRows = DATA_START_ROW + dataRows.length;

  // Sheet properties: freeze header rows, hide default gridlines
  req.push({ updateSheetProperties: {
    properties: { sheetId, gridProperties: { frozenRowCount: DATA_START_ROW, hideGridlines: true } },
    fields: 'gridProperties.frozenRowCount,gridProperties.hideGridlines',
  }});

  // Column widths + row heights
  COLUMNS.forEach((col, i) => req.push(dim(sheetId, 'COLUMNS', i, i + 1, col.width)));
  req.push(dim(sheetId, 'ROWS', TITLE_ROW, TITLE_ROW + 1, 36));
  req.push(dim(sheetId, 'ROWS', SUBTITLE_ROW, SUBTITLE_ROW + 1, 24));
  req.push(dim(sheetId, 'ROWS', HEADER_ROW, HEADER_ROW + 1, 30));

  // Title row — merged, dark, bold
  req.push({ mergeCells: { range: rng(sheetId, TITLE_ROW, TITLE_ROW + 1, 0, COL_COUNT), mergeType: 'MERGE_ALL' } });
  req.push(fmt(sheetId, TITLE_ROW, TITLE_ROW + 1, 0, COL_COUNT,
    { backgroundColor: C.titleBg, textFormat: { foregroundColor: C.white, fontSize: 12, bold: true }, verticalAlignment: 'MIDDLE' },
    'backgroundColor,textFormat,verticalAlignment'));

  // Subtitle row — merged, light gray, small
  req.push({ mergeCells: { range: rng(sheetId, SUBTITLE_ROW, SUBTITLE_ROW + 1, 0, COL_COUNT), mergeType: 'MERGE_ALL' } });
  req.push(fmt(sheetId, SUBTITLE_ROW, SUBTITLE_ROW + 1, 0, COL_COUNT,
    { backgroundColor: C.subtitleBg, textFormat: { foregroundColor: C.muted, fontSize: 9 }, verticalAlignment: 'MIDDLE' },
    'backgroundColor,textFormat,verticalAlignment'));

  // Header row — dark bg, white bold, centered, bottom border
  req.push(fmt(sheetId, HEADER_ROW, HEADER_ROW + 1, 0, COL_COUNT,
    { backgroundColor: C.headerBg, textFormat: { foregroundColor: C.white, fontSize: 10, bold: true },
      horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
      borders: { bottom: border(C.borderDark, 'SOLID_MEDIUM') } },
    'backgroundColor,textFormat,horizontalAlignment,verticalAlignment,borders'));

  // Data rows
  for (let i = 0; i < dataRows.length; i++) {
    const r = DATA_START_ROW + i;
    const row = dataRows[i];
    const hasEval = evalFlags[i];
    const rowBg = hasEval ? C.evalBg : (i % 2 ? C.zebraOdd : C.white);

    // Base row format
    req.push(fmt(sheetId, r, r + 1, 0, COL_COUNT,
      { backgroundColor: rowBg, textFormat: { fontSize: 10, foregroundColor: C.text },
        verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP',
        borders: { bottom: border(C.borderLight) } },
      'backgroundColor,textFormat,verticalAlignment,wrapStrategy,borders'));

    // Jira key — bold
    req.push(fmt(sheetId, r, r + 1, 0, 1, { textFormat: { bold: true, fontSize: 10 } }, 'textFormat'));

    if (hasEval) {
      // Blue left accent stripe
      req.push({ updateBorders: { range: rng(sheetId, r, r + 1, 0, 1), left: border(C.evalAccent, 'SOLID_THICK') } });

      // Designer lo-fi (col 2) + Automated lo-fi (col 3) — colored pills
      for (const col of [2, 3]) {
        const val = row[col];
        if (val && val !== '—') {
          const sc = statusColor(val);
          req.push(fmt(sheetId, r, r + 1, col, col + 1,
            { backgroundColor: sc.bg, textFormat: { bold: true, fontSize: 10, foregroundColor: sc.fg }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' },
            'backgroundColor,textFormat,horizontalAlignment,verticalAlignment'));
        }
      }

      // Agreement (col 4)
      const agree = (row[4] || '').toLowerCase();
      if (agree === 'yes' || agree === 'no') {
        const yes = agree === 'yes';
        req.push(fmt(sheetId, r, r + 1, 4, 5,
          { backgroundColor: yes ? C.passBg : C.failBg, textFormat: { bold: true, fontSize: 10, foregroundColor: yes ? C.passText : C.failText }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' },
          'backgroundColor,textFormat,horizontalAlignment,verticalAlignment'));
      }

      // Usability (col 5), Verdicts (col 6), Total ACs (col 8) — centered
      for (const col of [5, 6, 8]) {
        if (row[col]) {
          req.push(fmt(sheetId, r, r + 1, col, col + 1,
            { textFormat: { bold: col === 6, fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' },
            'textFormat,horizontalAlignment,verticalAlignment'));
        }
      }

      // Fail Details (col 9) — red text, wrap
      if (row[9]) {
        req.push(fmt(sheetId, r, r + 1, 9, 10,
          { textFormat: { fontSize: 9, foregroundColor: C.failText }, wrapStrategy: 'WRAP', verticalAlignment: 'TOP' },
          'textFormat,wrapStrategy,verticalAlignment'));
      }

      // Flagged Details (col 10) — amber text, wrap
      if (row[10]) {
        req.push(fmt(sheetId, r, r + 1, 10, 11,
          { textFormat: { fontSize: 9, foregroundColor: C.mixedText }, wrapStrategy: 'WRAP', verticalAlignment: 'TOP' },
          'textFormat,wrapStrategy,verticalAlignment'));
      }
    } else {
      // No eval: mute the result columns (D through Total ACs)
      req.push(fmt(sheetId, r, r + 1, 3, 11,
        { textFormat: { foregroundColor: C.muted, fontSize: 10, italic: true }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' },
        'textFormat,horizontalAlignment,verticalAlignment'));
    }
  }

  // Outer border
  req.push({ updateBorders: {
    range: rng(sheetId, TITLE_ROW, totalRows, 0, COL_COUNT),
    top: border(C.borderDark, 'SOLID_MEDIUM'), bottom: border(C.borderDark, 'SOLID_MEDIUM'),
    left: border(C.borderDark, 'SOLID_MEDIUM'), right: border(C.borderDark, 'SOLID_MEDIUM'),
  }});

  // Reset overflow columns past our data: clean bg, unhide
  if (COL_COUNT < 26) {
    req.push(fmt(sheetId, 0, 100, COL_COUNT, 26,
      { backgroundColor: C.white, textFormat: { fontSize: 10, foregroundColor: C.text },
        borders: {}, horizontalAlignment: 'LEFT', verticalAlignment: 'TOP', wrapStrategy: 'CLIP' },
      'backgroundColor,textFormat,borders,horizontalAlignment,verticalAlignment,wrapStrategy'));
    req.push({ updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: COL_COUNT, endIndex: 26 },
      properties: { hiddenByUser: false },
      fields: 'hiddenByUser',
    }});
  }

  return req;
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
  console.log('\n  Prototype Creator — Sync Eval Results → Google Sheet\n');
  if (!fs.existsSync(ARTIFACTS_BASE)) { console.error('  No .artifacts/ directory found.'); process.exit(1); }

  const evalResults = {};
  for (const dir of fs.readdirSync(ARTIFACTS_BASE).filter(d => d.startsWith('RHAISTRAT'))) {
    const r = readEvalResults(dir);
    if (r) evalResults[dir] = r;
  }
  const evalCount = Object.keys(evalResults).length;
  console.log(`  Found ${evalCount} evaluated prototype(s)\n`);

  const token = getToken();

  const sourceData = sheetsGet(token, `${SOURCE_SHEET}!A2:H30`);
  const sourceRows = sourceData.values || [];

  // Ensure the eval tab exists
  let sheetId = getSheetId(token);
  if (sheetId === null) {
    sheetsPost(token, ':batchUpdate', { requests: [{ addSheet: { properties: { title: EVAL_SHEET } } }] });
    sheetId = getSheetId(token);
    console.log(`  Created "${EVAL_SHEET}" tab (sheetId: ${sheetId})`);
  }

  // ── Build data rows ──
  const now = new Date();
  const timestamp = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const titleRow = [`Prototype Creator — Automated Evaluation Results`];
  const subtitleRow = [`Synced ${timestamp}  ·  ${evalCount}/${sourceRows.length - 1} evaluated  ·  Blue rows = eval run  ·  White rows = pending`];
  const headerRow = COLUMNS.map(c => c.header);

  const dataRows = [];
  const evalFlags = [];

  for (let i = 1; i < sourceRows.length; i++) {
    const row = sourceRows[i];
    const key = row[0];
    if (!key || !key.startsWith('RHAISTRAT')) continue;

    const title = row[1] || '';
    const mr = row[2] || '';
    const protoUrl = row[3] || '';
    const designerText = row[5] || '';
    const lofiMatch = designerText.match(/Lo-fi:\s*([^\n]+)/);
    const designerLofi = lofiMatch ? lofiMatch[1].trim() : '—';
    const designerNotes = designerText.replace(/Lo-fi:[^\n]*\n?/i, '').replace(/Hi-fi:[^\n]*\n?/i, '').trim();

    const evl = evalResults[key];
    let autoLofi = '', usScore = '', agree = '', verdict = '', evalDate = '';
    let totalACs = '', failDetails = '', flaggedDetails = '';

    if (evl) {
      autoLofi = evl.autoLofi;
      usScore = evl.usScore;
      verdict = evl.verdict;
      evalDate = evl.evalDate;
      totalACs = String(evl.totalACs);
      failDetails = evl.failDetails;
      flaggedDetails = evl.flaggedDetails;
      const dPass = designerLofi.toLowerCase().startsWith('pass');
      const aPass = autoLofi.toLowerCase().startsWith('pass');
      agree = (designerLofi === '—' || designerLofi === 'N/A') ? '—' : (dPass === aPass ? 'Yes' : 'No');
    }

    dataRows.push([key, title, designerLofi, autoLofi, agree, usScore, verdict, evalDate, totalACs, failDetails, flaggedDetails, mr, protoUrl, designerNotes]);
    evalFlags.push(!!evl);
  }

  // ── Clear entire sheet, then write fresh ──
  const allRows = [titleRow, subtitleRow, headerRow, ...dataRows];
  sheetsClear(token, `${EVAL_SHEET}!A1:Z200`);
  sheetsPut(token, `${EVAL_SHEET}!A1`, allRows);

  // ── Apply formatting ──
  const formatRequests = buildFormatRequests(sheetId, dataRows, evalFlags);
  if (formatRequests.length > 0) {
    sheetsPost(token, ':batchUpdate', { requests: formatRequests });
  }

  console.log(`  Wrote ${dataRows.length} rows to "${EVAL_SHEET}" (${evalCount} with eval data)`);
  console.log(`  Applied ${formatRequests.length} format operations\n`);

  if (evalCount > 0) {
    console.log('  Eval results:');
    for (const [key, evl] of Object.entries(evalResults)) {
      const icon = evl.autoLofi.toLowerCase().startsWith('pass') ? '✓' : evl.autoLofi.toLowerCase().startsWith('fail') ? '✗' : '~';
      console.log(`    ${icon} ${key}: ${evl.autoLofi} | ${evl.usScore} | ${evl.verdict}`);
    }
    console.log();
  }

  console.log(`  Sheet: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}\n`);
}

main();
