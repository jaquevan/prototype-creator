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

// Column layout — primary columns first, reference data at end
const COLUMNS = [
  { header: 'Jira Key',    width: 145 },  // A  0
  { header: 'Title',       width: 280 },  // B  1
  { header: 'Report',      width: 55  },  // C  2
  { header: 'Designer',    width: 80  },  // D  3
  { header: 'Automated',   width: 85  },  // E  4
  { header: 'Agree',       width: 55  },  // F  5
  { header: 'Usability',   width: 75  },  // G  6
  { header: 'Verdicts',    width: 105 },  // H  7
  { header: 'Eval Date',   width: 130 },  // I  8  (date + time)
  { header: 'Fails',       width: 350 },  // J  9
  { header: 'Flagged',     width: 350 },  // K  10
  { header: 'MR',          width: 40  },  // L  11
  { header: 'Proto',       width: 45  },  // M  12
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

function sheetsPut(token, range, values, inputOption = 'USER_ENTERED') {
  const url = `${API_BASE}/values/${encodeURIComponent(range)}?valueInputOption=${inputOption}`;
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
  // FLAGGED = "needs human review", not a failure — same logic as compare-ground-truth.js
  const allJiraPassOrFlagged = jiraRows.every(r => r.verdict === 'PASS' || r.verdict === 'FLAGGED');
  const autoLofi = hasNavFail ? 'Fail (nav)' : hasJiraFail ? 'Fail' : allJiraPassOrFlagged ? 'Pass' : 'Mixed';
  const verdict = `${pass}P / ${fail}F / ${flagged}FL`;
  const totalACs = acRows.length;

  const detailLine = (r) => {
    const id = r.criterion_id || '?';
    const txt = (r.criterion_text || r.evidence || '').substring(0, 80);
    return txt ? `${id}: ${txt}` : id;
  };
  const failDetails = acRows.filter(r => r.verdict === 'FAIL').map(detailLine).join('\n');
  const flaggedDetails = acRows.filter(r => r.verdict === 'FLAGGED').map(detailLine).join('\n');

  const reportUrlPath = path.join(ARTIFACTS_BASE, key, 'report-url.txt');
  const reportUrl = fs.existsSync(reportUrlPath) ? fs.readFileSync(reportUrlPath, 'utf8').trim() : '';

  // Get eval date from the CSV file's mtime (when the eval actually ran)
  const csvStat = fs.statSync(csvPath);
  const evalMtime = csvStat.mtime;
  const evalDate = evalMtime.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    evalMtime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return { autoLofi, usScore, verdict, pass, fail, flagged, totalACs, failDetails, flaggedDetails, evalDate, evalMtime, reportUrl };
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

  // Sheet properties: freeze header rows, show gridlines for cell separation
  req.push({ updateSheetProperties: {
    properties: { sheetId, gridProperties: { frozenRowCount: DATA_START_ROW, hideGridlines: false } },
    fields: 'gridProperties.frozenRowCount,gridProperties.hideGridlines',
  }});

  // Column widths + row heights
  COLUMNS.forEach((col, i) => req.push(dim(sheetId, 'COLUMNS', i, i + 1, col.width)));
  req.push(dim(sheetId, 'ROWS', TITLE_ROW, TITLE_ROW + 1, 38));
  req.push(dim(sheetId, 'ROWS', SUBTITLE_ROW, SUBTITLE_ROW + 1, 26));
  req.push(dim(sheetId, 'ROWS', HEADER_ROW, HEADER_ROW + 1, 32));
  // Data rows: minimum height (rows with wrapped content will auto-expand)
  if (dataRows.length > 0) {
    req.push(dim(sheetId, 'ROWS', DATA_START_ROW, DATA_START_ROW + dataRows.length, 32));
  }

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
    const rowBg = i % 2 ? C.zebraOdd : C.white;

    // Base row format — all cells vertically centered, clipped, bordered
    req.push(fmt(sheetId, r, r + 1, 0, COL_COUNT,
      { backgroundColor: rowBg, textFormat: { fontSize: 10, foregroundColor: C.text },
        horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP',
        borders: {
          top: border(C.borderLight),
          bottom: border(C.borderLight),
          left: border(C.borderLight),
          right: border(C.borderLight),
        } },
      'backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,borders'));

    // Jira key (col 0) — bold, left-aligned
    req.push(fmt(sheetId, r, r + 1, 0, 1, { textFormat: { bold: true, fontSize: 10 }, horizontalAlignment: 'LEFT' }, 'textFormat,horizontalAlignment'));

    // Title (col 1) — left-aligned
    req.push(fmt(sheetId, r, r + 1, 1, 2, { horizontalAlignment: 'LEFT' }, 'horizontalAlignment'));

    if (hasEval) {
      // Report link (col 2) — bold
      if (row[2]) {
        req.push(fmt(sheetId, r, r + 1, 2, 3,
          { textFormat: { fontSize: 10, bold: true } },
          'textFormat'));
      }

      // Designer lo-fi (col 3) + Automated lo-fi (col 4) — colored pills
      for (const col of [3, 4]) {
        const val = row[col];
        if (val && val !== '—') {
          const sc = statusColor(val);
          req.push(fmt(sheetId, r, r + 1, col, col + 1,
            { backgroundColor: sc.bg, textFormat: { bold: true, fontSize: 10, foregroundColor: sc.fg } },
            'backgroundColor,textFormat'));
        }
      }

      // Agreement (col 5) — green/red cell fill, dark text for readability
      const agree = (row[5] || '').toLowerCase();
      if (agree === 'yes' || agree === 'no') {
        const yes = agree === 'yes';
        req.push(fmt(sheetId, r, r + 1, 5, 6,
          { backgroundColor: yes ? { red: 0.78, green: 0.92, blue: 0.78 } : { red: 0.95, green: 0.80, blue: 0.80 }, textFormat: { bold: true, fontSize: 10, foregroundColor: C.text }, horizontalAlignment: 'CENTER' },
          'backgroundColor,textFormat,horizontalAlignment'));
      }

      // Verdicts (col 7) — bold
      if (row[7]) {
        req.push(fmt(sheetId, r, r + 1, 7, 8,
          { textFormat: { bold: true, fontSize: 10 } },
          'textFormat'));
      }

      // Fail Details (col 9) — red text, left-aligned, wrapped for readability
      if (row[9]) {
        req.push(fmt(sheetId, r, r + 1, 9, 10,
          { textFormat: { fontSize: 9, foregroundColor: C.failText }, horizontalAlignment: 'LEFT', verticalAlignment: 'TOP', wrapStrategy: 'WRAP' },
          'textFormat,horizontalAlignment,verticalAlignment,wrapStrategy'));
      }

      // Flagged Details (col 10) — amber text, left-aligned, wrapped
      if (row[10]) {
        req.push(fmt(sheetId, r, r + 1, 10, 11,
          { textFormat: { fontSize: 9, foregroundColor: C.mixedText }, horizontalAlignment: 'LEFT', verticalAlignment: 'TOP', wrapStrategy: 'WRAP' },
          'textFormat,horizontalAlignment,verticalAlignment,wrapStrategy'));
      }
    } else {
      // No eval: mute the result columns
      req.push(fmt(sheetId, r, r + 1, 3, COL_COUNT,
        { textFormat: { foregroundColor: C.muted, fontSize: 10, italic: true } },
        'textFormat'));
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
  const subtitleRow = [`Synced ${timestamp}  ·  ${evalCount} evaluated  ·  Sorted by most recent`];
  const headerRow = COLUMNS.map(c => c.header);

  const dataRows = [];

  for (let i = 1; i < sourceRows.length; i++) {
    const row = sourceRows[i];
    const key = row[0];
    if (!key || !key.startsWith('RHAISTRAT')) continue;

    const title = row[1] || '';
    if (!title || title === 'N/A' || title === 'NA') continue;

    const mr = row[2] || '';
    const protoUrl = row[3] || '';
    const designerText = row[5] || '';
    const lofiMatch = designerText.match(/Lo-fi:\s*([^\n]+)/);
    const designerLofi = lofiMatch ? lofiMatch[1].trim() : '—';
    const designerNotes = designerText.replace(/Lo-fi:[^\n]*\n?/i, '').replace(/Hi-fi:[^\n]*\n?/i, '').trim();

    const evl = evalResults[key];
    let autoLofi = '', usScore = '', agree = '', verdict = '', evalDate = '';
    let failDetails = '', flaggedDetails = '', reportUrl = '';

    if (evl) {
      autoLofi = evl.autoLofi;
      usScore = evl.usScore;
      verdict = evl.verdict;
      evalDate = evl.evalDate;
      failDetails = evl.failDetails;
      flaggedDetails = evl.flaggedDetails;
      reportUrl = evl.reportUrl || '';
      const dPass = designerLofi.toLowerCase().startsWith('pass');
      const aPass = autoLofi.toLowerCase().startsWith('pass');
      agree = (designerLofi === '—' || designerLofi === 'N/A') ? '—' : (dPass === aPass ? 'Yes' : 'No');
    }

    const reportCell = reportUrl ? `=HYPERLINK("${reportUrl}","View")` : '';
    const mrCell = mr ? `=HYPERLINK("${mr}","MR")` : '';
    const protoCell = protoUrl ? `=HYPERLINK("${protoUrl}","Open")` : '';

    const sortKey = evl ? evl.evalMtime.getTime() : 0;
    dataRows.push({ cells: [key, title, reportCell, designerLofi, autoLofi, agree, usScore, verdict, evalDate, failDetails, flaggedDetails, mrCell, protoCell], hasEval: !!evl, sortKey });
  }

  // Sort by most recent eval first
  dataRows.sort((a, b) => b.sortKey - a.sortKey);

  // Extract sorted cell arrays and flags
  const sortedCells = dataRows.map(r => r.cells);
  const evalFlags = dataRows.map(r => r.hasEval);

  // ── Clear entire sheet, then write fresh ──
  const allRows = [titleRow, subtitleRow, headerRow, ...sortedCells];
  sheetsClear(token, `${EVAL_SHEET}!A1:Z200`);
  sheetsPut(token, `${EVAL_SHEET}!A1`, allRows);

  // ── Apply formatting ──
  const formatRequests = buildFormatRequests(sheetId, sortedCells, evalFlags);
  if (formatRequests.length > 0) {
    sheetsPost(token, ':batchUpdate', { requests: formatRequests });
  }

  console.log(`  Wrote ${sortedCells.length} rows to "${EVAL_SHEET}" (${evalCount} with eval data)`);
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

  // ── Verify (read back and validate) ──
  if (process.argv.includes('--verify')) {
    verify(token, sortedCells);
  }
}

function verify(token, expectedRows) {
  console.log('  ── Verifying sheet data ──\n');
  const range = `${EVAL_SHEET}!A${DATA_START_ROW + 1}:M${DATA_START_ROW + expectedRows.length}`;
  const actual = sheetsGet(token, range);
  const actualRows = actual.values || [];

  let errors = 0;

  if (actualRows.length !== expectedRows.length) {
    console.log(`  ERROR: Expected ${expectedRows.length} rows, got ${actualRows.length}`);
    errors++;
  }

  for (let i = 0; i < Math.min(actualRows.length, expectedRows.length); i++) {
    const exp = expectedRows[i];
    const act = actualRows[i];

    // Col 0: Jira Key must match
    if (act[0] !== exp[0]) {
      console.log(`  Row ${i + 1}: Jira Key mismatch — expected "${exp[0]}", got "${act[0]}"`);
      errors++;
    }

    // Col 2: Report link — should show "View" if we wrote a HYPERLINK formula
    if (exp[2] && !act[2]) {
      console.log(`  Row ${i + 1} (${exp[0]}): Report link missing — formula may not have evaluated`);
      errors++;
    }

    // Col 11: MR link
    if (exp[11] && !act[11]) {
      console.log(`  Row ${i + 1} (${exp[0]}): MR link missing`);
      errors++;
    }

    // Col 12: Prototype link
    if (exp[12] && !act[12]) {
      console.log(`  Row ${i + 1} (${exp[0]}): Prototype link missing`);
      errors++;
    }

    // Col 8: Eval date should not be empty for evaluated rows
    if (exp[8] && !act[8]) {
      console.log(`  Row ${i + 1} (${exp[0]}): Eval date missing`);
      errors++;
    }
  }

  // Verify sort order — first row should have the most recent date
  if (actualRows.length >= 2 && actualRows[0][8] && actualRows[1][8]) {
    console.log(`  Sort check: Row 1 date = "${actualRows[0][8]}", Row 2 date = "${actualRows[1][8]}"`);
  }

  if (errors === 0) {
    console.log(`  All ${actualRows.length} rows verified OK\n`);
  } else {
    console.log(`\n  ${errors} verification error(s) found\n`);
  }
}

main();
