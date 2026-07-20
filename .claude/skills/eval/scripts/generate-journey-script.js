#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const artifactsDir = process.argv[2];
const prototypeUrl = process.argv[3] || 'http://localhost:8080';

if (!artifactsDir) {
  console.error('Usage: node generate-journey-script.js <artifacts-dir> [prototype-url]');
  console.error('  Reads component-map.json + extract-state.json, emits journey-test.mjs');
  process.exit(1);
}

const abs = path.resolve(artifactsDir);
const cmPath = path.join(abs, 'component-map.json');
const esPath = path.join(abs, 'extract-state.json');

if (!fs.existsSync(cmPath)) { console.error('component-map.json not found'); process.exit(1); }
if (!fs.existsSync(esPath)) { console.error('extract-state.json not found'); process.exit(1); }

const cm = JSON.parse(fs.readFileSync(cmPath, 'utf8'));
const es = JSON.parse(fs.readFileSync(esPath, 'utf8'));

const journeys = es.journey_definitions || [];
const uiType = cm.ui_type || 'table';
const targetPage = cm.target_page || '/';
const contentReady = cm.content_ready_selector || 'body';
const interactiveElements = cm.interactive_elements || [];
const dataEntries = cm.data_entries || [];
const acMapping = cm.ac_element_mapping || {};
const initConfig = cm.initialization || {};

const evalSkillRoot = path.resolve(__dirname, '..');
const playwrightPath = path.join(evalSkillRoot, 'node_modules', 'playwright', 'index.mjs');
const relPlaywright = path.relative(path.dirname(path.join(abs, 'journey-test.mjs')), playwrightPath).replace(/\\/g, '/');

// ── Build interaction pool from component-map ──

function buildInteractionPool() {
  const pool = [];

  pool.push({ type: 'default', target: 'page', code: '', uniqueState: 'default-view' });

  for (const el of interactiveElements) {
    if (el.type === 'tooltip') {
      pool.push({
        type: 'hover',
        target: el.trigger_selector || el.selector,
        code: `await hoverElement('${escStr(el.trigger_selector || el.selector)}');`,
        assertCode: `const tooltipText = await getTooltipText();`,
        uniqueState: `hover-${slugify(el.trigger_selector || el.selector)}`
      });
    } else if (el.type === 'expandable_row') {
      for (const entry of dataEntries) {
        if (entry.properties && entry.properties.has_expandable) {
          pool.push({
            type: 'expand',
            target: `${entry.name} row`,
            code: `await expandRow('${escStr(entry.name)}');`,
            assertCode: `const expandedContent = page.locator('${escStr(el.selector)}');\n    const isExpanded = await expandedContent.isVisible({ timeout: 3000 }).catch(() => false);`,
            uniqueState: `expand-${slugify(entry.name)}`
          });
        }
      }
    } else if (el.type === 'dropdown' || el.type === 'select') {
      pool.push({
        type: 'select',
        target: el.selector,
        code: `await page.locator('${escStr(el.trigger_selector || el.selector)}').click();\n  await page.waitForTimeout(500);`,
        uniqueState: `select-${slugify(el.selector)}`
      });
    } else if (el.type === 'modal') {
      pool.push({
        type: 'modal',
        target: el.selector,
        code: `await page.locator('${escStr(el.trigger_selector)}').click();\n  await page.waitForTimeout(1000);`,
        assertCode: `const modalVisible = await page.locator('${escStr(el.selector)}').isVisible({ timeout: 3000 }).catch(() => false);`,
        uniqueState: `modal-${slugify(el.selector)}`
      });
    } else if (el.type === 'tab') {
      pool.push({
        type: 'tab',
        target: el.selector,
        code: `await page.locator('${escStr(el.trigger_selector || el.selector)}').click();\n  await page.waitForTimeout(500);`,
        uniqueState: `tab-${slugify(el.selector)}`
      });
    } else if (el.type === 'text_input') {
      pool.push({
        type: 'fill',
        target: el.selector,
        code: `await page.locator('${escStr(el.selector)}').fill('Test value');`,
        uniqueState: `fill-${slugify(el.selector)}`
      });
    } else if (el.type === 'checkbox' || el.type === 'toggle' || el.type === 'switch') {
      pool.push({
        type: 'check',
        target: el.selector,
        code: `await page.locator('${escStr(el.selector)}').first().check();`,
        uniqueState: `check-${slugify(el.selector)}`
      });
    } else if (el.type === 'accordion') {
      pool.push({
        type: 'accordion',
        target: el.selector,
        code: `await page.locator('${escStr(el.trigger_selector || el.selector)}').click();\n  await page.waitForTimeout(500);`,
        uniqueState: `accordion-${slugify(el.selector)}`
      });
    } else if (el.type === 'popover') {
      pool.push({
        type: 'hover',
        target: el.trigger_selector || el.selector,
        code: `await hoverElement('${escStr(el.trigger_selector || el.selector)}');`,
        assertCode: `const tooltipText = await getTooltipText();`,
        uniqueState: `popover-${slugify(el.trigger_selector || el.selector)}`
      });
    } else if (el.type === 'link') {
      pool.push({
        type: 'click',
        target: el.selector,
        code: `await page.locator('${escStr(el.selector)}').first().click();\n  await page.waitForTimeout(1000);`,
        uniqueState: `click-${slugify(el.selector)}`
      });
    }
  }

  // From ac_element_mapping — add interactions not already covered
  for (const [acId, mapping] of Object.entries(acMapping)) {
    if (mapping.interaction_type === 'hover' && mapping.selector) {
      const state = `hover-${slugify(mapping.selector)}`;
      if (!pool.find(p => p.uniqueState === state)) {
        pool.push({
          type: 'hover',
          target: mapping.selector,
          code: `await hoverElement('${escStr(mapping.selector)}');`,
          assertCode: `const tooltipText = await getTooltipText();`,
          uniqueState: state
        });
      }
    } else if (mapping.interaction_type === 'click' && mapping.selector) {
      const state = `click-${slugify(mapping.selector)}`;
      if (!pool.find(p => p.uniqueState === state)) {
        pool.push({
          type: 'click',
          target: mapping.selector,
          code: `await page.locator('${escStr(mapping.selector)}').first().click();\n  await page.waitForTimeout(500);`,
          uniqueState: state
        });
      }
    } else if (mapping.interaction_type === 'fill' && mapping.selector) {
      const state = `fill-${slugify(mapping.selector)}`;
      if (!pool.find(p => p.uniqueState === state)) {
        pool.push({
          type: 'fill',
          target: mapping.selector,
          code: `await page.locator('${escStr(mapping.selector)}').fill('${escStr(mapping.test_value || 'Test value')}');`,
          uniqueState: state
        });
      }
    }
  }

  // From data_entries — scroll targets for non-expandable entries
  for (const entry of dataEntries) {
    if (!(entry.properties && entry.properties.has_expandable)) {
      pool.push({
        type: 'scroll',
        target: entry.name,
        code: `await page.locator('${escStr(entry.selector)}').scrollIntoViewIfNeeded();\n  await page.waitForTimeout(500);`,
        uniqueState: `scroll-${slugify(entry.name)}`
      });
    }
  }

  return pool;
}

function slugify(s) {
  return (s || '').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 30);
}

function escStr(s) { return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' '); }

// ── Assign interactions to journeys ──

const pool = buildInteractionPool();
const assignments = new Map();
const usedStates = new Set();

// Phase 1: match by AC type from ac_element_mapping
for (const j of journeys) {
  const acIds = j.ac_ids || [];
  const firstAc = acIds[0];
  const mapping = acMapping[firstAc];

  if (mapping && mapping.interaction_type === 'hover') {
    const available = pool.filter(p => p.type === 'hover' && !usedStates.has(p.uniqueState));
    if (available.length > 0) {
      assignments.set(j.id, available[0]);
      usedStates.add(available[0].uniqueState);
      continue;
    }
  }

  if (mapping && mapping.interaction_type === 'fill') {
    const available = pool.filter(p => p.type === 'fill' && !usedStates.has(p.uniqueState));
    if (available.length > 0) {
      assignments.set(j.id, available[0]);
      usedStates.add(available[0].uniqueState);
      continue;
    }
  }

  if (mapping && mapping.interaction_type === 'click') {
    const available = pool.filter(p => (p.type === 'click' || p.type === 'tab') && !usedStates.has(p.uniqueState));
    if (available.length > 0) {
      assignments.set(j.id, available[0]);
      usedStates.add(available[0].uniqueState);
      continue;
    }
  }

  const titleLower = (j.title || '').toLowerCase();
  const sourceLower = (j.source || '').toLowerCase();

  if (titleLower.includes('expand') || titleLower.includes('detail') || sourceLower.includes('expand')) {
    const available = pool.filter(p => p.type === 'expand' && !usedStates.has(p.uniqueState));
    if (available.length > 0) {
      assignments.set(j.id, available[0]);
      usedStates.add(available[0].uniqueState);
      continue;
    }
  }

  if (titleLower.includes('tooltip') || titleLower.includes('hover') || sourceLower.includes('tooltip') || sourceLower.includes('hover')) {
    const available = pool.filter(p => p.type === 'hover' && !usedStates.has(p.uniqueState));
    if (available.length > 0) {
      assignments.set(j.id, available[0]);
      usedStates.add(available[0].uniqueState);
      continue;
    }
  }

  if (titleLower.includes('modal') || titleLower.includes('dialog') || sourceLower.includes('modal')) {
    const available = pool.filter(p => p.type === 'modal' && !usedStates.has(p.uniqueState));
    if (available.length > 0) {
      assignments.set(j.id, available[0]);
      usedStates.add(available[0].uniqueState);
      continue;
    }
  }

  if (titleLower.includes('tab') || titleLower.includes('step') || titleLower.includes('wizard') || sourceLower.includes('tab') || sourceLower.includes('step')) {
    const available = pool.filter(p => p.type === 'tab' && !usedStates.has(p.uniqueState));
    if (available.length > 0) {
      assignments.set(j.id, available[0]);
      usedStates.add(available[0].uniqueState);
      continue;
    }
  }
}

// Phase 2: assign default view to the first unassigned visibility/column journey
for (const j of journeys) {
  if (assignments.has(j.id)) continue;
  if (!usedStates.has('default-view')) {
    assignments.set(j.id, pool.find(p => p.uniqueState === 'default-view'));
    usedStates.add('default-view');
    break;
  }
}

// Phase 3: assign remaining from unused pool
for (const j of journeys) {
  if (assignments.has(j.id)) continue;
  const remaining = pool.filter(p => !usedStates.has(p.uniqueState));
  if (remaining.length > 0) {
    assignments.set(j.id, remaining[0]);
    usedStates.add(remaining[0].uniqueState);
  } else {
    assignments.set(j.id, { type: 'default', target: 'page (overflow)', code: '', uniqueState: `overflow-${j.id}` });
  }
}

// ── Generate the interaction budget comment ──

let budgetComment = '// INTERACTION BUDGET:\n';
for (const j of journeys) {
  const a = assignments.get(j.id);
  const acList = (j.ac_ids || []).join(', ');
  let interactionDesc;
  if (a.type === 'default') interactionDesc = 'DEFAULT VIEW (the one allowed)';
  else if (a.type === 'hover') interactionDesc = `hover "${a.target}"`;
  else if (a.type === 'expand') interactionDesc = `expand ${a.target}`;
  else if (a.type === 'fill') interactionDesc = `fill "${a.target}"`;
  else if (a.type === 'click') interactionDesc = `click "${a.target}"`;
  else if (a.type === 'tab') interactionDesc = `tab "${a.target}"`;
  else if (a.type === 'modal') interactionDesc = `modal "${a.target}"`;
  else if (a.type === 'select') interactionDesc = `select "${a.target}"`;
  else if (a.type === 'check') interactionDesc = `check "${a.target}"`;
  else if (a.type === 'scroll') interactionDesc = `scroll to "${a.target}"`;
  else if (a.type === 'accordion') interactionDesc = `accordion "${a.target}"`;
  else interactionDesc = a.uniqueState;
  budgetComment += `// ${j.id} (${acList}): ${interactionDesc}\n`;
}

// ── Generate journey functions ──

let journeyFunctions = '';
for (let i = 0; i < journeys.length; i++) {
  const j = journeys[i];
  const a = assignments.get(j.id);
  const num = i + 1;
  const acIds = JSON.stringify(j.ac_ids || []);

  journeyFunctions += `
async function journey${num}() {
  const steps = [];
  await navigateTo(componentMap.target_page);
  await screenshot('journey-${num}-step-1.png');
  steps.push({ step: 1, action: 'navigate', target: '${escStr(j.expected_path ? j.expected_path[0] : targetPage)}', result: 'success', screenshot: 'screenshots/journey-${num}-step-1.png', narration: 'Navigated to target page.' });
`;

  if (a.type === 'hover') {
    journeyFunctions += `
  ${a.code}
  await screenshot('journey-${num}-step-2.png');
  steps.push({ step: 2, action: 'hover', target: '${escStr(a.target)}', result: 'success', screenshot: 'screenshots/journey-${num}-step-2.png', narration: 'Hovered over element to trigger tooltip.' });
  ${a.assertCode || ''}
  const hasTooltip = tooltipText && tooltipText.length > 5;
  await screenshot('journey-${num}-step-3.png');
  steps.push({ step: 3, action: 'verify_tooltip', target: 'Tooltip content', result: hasTooltip ? 'success' : 'fail', screenshot: 'screenshots/journey-${num}-step-3.png', narration: 'Tooltip content: ' + (tooltipText || 'none') });
`;
  } else if (a.type === 'expand') {
    journeyFunctions += `
  ${a.code}
  await screenshot('journey-${num}-step-2.png');
  steps.push({ step: 2, action: 'expand_row', target: '${escStr(a.target)}', result: 'success', screenshot: 'screenshots/journey-${num}-step-2.png', narration: 'Expanded ${escStr(a.target)}.' });
  ${a.assertCode || ''}
  let hasDetails = false;
  if (isExpanded) {
    const text = await expandedContent.textContent().catch(() => '');
    hasDetails = text.length > 10;
  }
  await screenshot('journey-${num}-step-3.png');
  steps.push({ step: 3, action: 'verify_expanded', target: 'Expanded content', result: (isExpanded && hasDetails) ? 'success' : 'fail', screenshot: 'screenshots/journey-${num}-step-3.png', narration: 'Expanded content visible: ' + isExpanded });
`;
  } else if (a.type === 'fill') {
    journeyFunctions += `
  ${a.code}
  await screenshot('journey-${num}-step-2.png');
  steps.push({ step: 2, action: 'fill', target: '${escStr(a.target)}', result: 'success', screenshot: 'screenshots/journey-${num}-step-2.png', narration: 'Filled input field with test value.' });
  const inputValue = await page.locator('${escStr(a.target)}').inputValue().catch(() => '');
  await screenshot('journey-${num}-step-3.png');
  steps.push({ step: 3, action: 'verify_fill', target: 'Input value', result: inputValue.length > 0 ? 'success' : 'fail', screenshot: 'screenshots/journey-${num}-step-3.png', narration: 'Input value: ' + inputValue });
`;
  } else if (a.type === 'click' || a.type === 'tab') {
    journeyFunctions += `
  ${a.code}
  await screenshot('journey-${num}-step-2.png');
  steps.push({ step: 2, action: '${a.type}', target: '${escStr(a.target)}', result: 'success', screenshot: 'screenshots/journey-${num}-step-2.png', narration: 'Clicked ${escStr(a.target)}.' });
  const noErrors = await checkNoErrors();
  await screenshot('journey-${num}-step-3.png');
  steps.push({ step: 3, action: 'verify', target: 'Page state', result: noErrors ? 'success' : 'fail', screenshot: 'screenshots/journey-${num}-step-3.png', narration: 'Page state verified after interaction.' });
`;
  } else if (a.type === 'modal') {
    journeyFunctions += `
  ${a.code}
  await screenshot('journey-${num}-step-2.png');
  steps.push({ step: 2, action: 'modal_open', target: '${escStr(a.target)}', result: 'success', screenshot: 'screenshots/journey-${num}-step-2.png', narration: 'Triggered modal dialog.' });
  ${a.assertCode || ''}
  await screenshot('journey-${num}-step-3.png');
  steps.push({ step: 3, action: 'verify_modal', target: 'Modal visible', result: modalVisible ? 'success' : 'fail', screenshot: 'screenshots/journey-${num}-step-3.png', narration: 'Modal visibility: ' + modalVisible });
`;
  } else if (a.type === 'select') {
    journeyFunctions += `
  ${a.code}
  await screenshot('journey-${num}-step-2.png');
  steps.push({ step: 2, action: 'select', target: '${escStr(a.target)}', result: 'success', screenshot: 'screenshots/journey-${num}-step-2.png', narration: 'Opened select/dropdown.' });
  const noErrors = await checkNoErrors();
  await screenshot('journey-${num}-step-3.png');
  steps.push({ step: 3, action: 'verify', target: 'Dropdown state', result: noErrors ? 'success' : 'fail', screenshot: 'screenshots/journey-${num}-step-3.png', narration: 'Dropdown opened successfully.' });
`;
  } else if (a.type === 'check') {
    journeyFunctions += `
  ${a.code}
  await screenshot('journey-${num}-step-2.png');
  steps.push({ step: 2, action: 'check', target: '${escStr(a.target)}', result: 'success', screenshot: 'screenshots/journey-${num}-step-2.png', narration: 'Checked checkbox/toggle.' });
  const isChecked = await page.locator('${escStr(a.target)}').first().isChecked().catch(() => false);
  await screenshot('journey-${num}-step-3.png');
  steps.push({ step: 3, action: 'verify_check', target: 'Checked state', result: isChecked ? 'success' : 'fail', screenshot: 'screenshots/journey-${num}-step-3.png', narration: 'Checked state: ' + isChecked });
`;
  } else if (a.type === 'scroll') {
    journeyFunctions += `
  ${a.code}
  await screenshot('journey-${num}-step-2.png');
  steps.push({ step: 2, action: 'scroll', target: '${escStr(a.target)}', result: 'success', screenshot: 'screenshots/journey-${num}-step-2.png', narration: 'Scrolled to ${escStr(a.target)}.' });
  const noErrors = await checkNoErrors();
  await screenshot('journey-${num}-step-3.png');
  steps.push({ step: 3, action: 'verify', target: 'Visible state', result: noErrors ? 'success' : 'fail', screenshot: 'screenshots/journey-${num}-step-3.png', narration: 'Element visible after scroll.' });
`;
  } else if (a.type === 'accordion') {
    journeyFunctions += `
  ${a.code}
  await screenshot('journey-${num}-step-2.png');
  steps.push({ step: 2, action: 'accordion_toggle', target: '${escStr(a.target)}', result: 'success', screenshot: 'screenshots/journey-${num}-step-2.png', narration: 'Toggled accordion section.' });
  const noErrors = await checkNoErrors();
  await screenshot('journey-${num}-step-3.png');
  steps.push({ step: 3, action: 'verify', target: 'Accordion state', result: noErrors ? 'success' : 'fail', screenshot: 'screenshots/journey-${num}-step-3.png', narration: 'Accordion section toggled.' });
`;
  } else {
    // Default view
    journeyFunctions += `
  const headers = await getColumnHeaders();
  const noErrors = await checkNoErrors();
  await screenshot('journey-${num}-step-2.png');
  steps.push({ step: 2, action: 'verify', target: 'Page state', result: noErrors ? 'success' : 'fail', screenshot: 'screenshots/journey-${num}-step-2.png', narration: 'Verified default page state.' });
`;
  }

  journeyFunctions += `
  await screenshot('journey-${num}-final.png');
  steps.push({ step: steps.length + 1, action: 'screenshot', target: 'Final state', result: 'success', screenshot: 'screenshots/journey-${num}-final.png', narration: 'Captured final state after ${a.type} interaction.' });

  const allSuccess = steps.every(s => s.result === 'success');
  return { id: '${j.id}', title: ${JSON.stringify(j.title)}, persona: ${JSON.stringify(j.persona || '')}, source: ${JSON.stringify(j.source || '')}, ac_ids: ${acIds}, verdict: allSuccess ? 'PASS' : 'FAIL', steps_expected: steps.length, steps_completed: steps.length, steps };
}
`;
}

// ── Determine which utility functions to include ──

function getUtilities() {
  const common = `
async function navigateTo(route) {
  await page.goto(\`\${BASE_URL}\${route}\`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  const readySelector = componentMap.content_ready_selector || 'body';
  await page.waitForSelector(readySelector, { timeout: 8000 }).catch(() => null);
}

async function hoverElement(selector) {
  const el = page.locator(selector).first();
  if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
    await el.hover();
    await page.waitForTimeout(600);
  }
}

async function getTooltipText() {
  const tooltip = page.locator('.pf-v6-c-tooltip__content').first();
  if (await tooltip.isVisible({ timeout: 2000 }).catch(() => false)) {
    return await tooltip.textContent();
  }
  return null;
}

async function checkNoErrors() {
  const errors = await page.locator('.pf-v6-c-alert--danger, [role="alert"]').count();
  const bodyText = await page.locator('body').textContent().catch(() => '');
  return errors === 0 && !bodyText.includes('403') && !bodyText.includes('Forbidden');
}

async function screenshot(name) {
  await page.screenshot({ path: \`\${SCREENSHOTS}/\${name}\`, fullPage: false });
}

async function getColumnHeaders() {
  return await page.locator('thead th').allTextContents();
}`;

  let typeSpecific = '';

  if (uiType === 'table' || uiType === 'mixed') {
    typeSpecific += `

async function expandRow(rowText) {
  const row = page.locator('tbody tr').filter({ hasText: rowText }).first();
  const toggle = row.locator('td:first-child button').first();
  if (await toggle.isVisible({ timeout: 2000 }).catch(() => false)) {
    await toggle.click();
    await page.waitForTimeout(800);
  }
}`;
  }

  if (uiType === 'form' || uiType === 'mixed') {
    typeSpecific += `

async function fillInput(selector, value) {
  await page.locator(selector).fill(value);
  await page.waitForTimeout(300);
}

async function checkCheckbox(selector) {
  await page.locator(selector).first().check();
  await page.waitForTimeout(300);
}

async function selectOption(triggerSelector, optionText) {
  await page.locator(triggerSelector).click();
  await page.waitForTimeout(300);
  await page.locator(\`text=\${optionText}\`).first().click();
  await page.waitForTimeout(500);
}`;
  }

  if (uiType === 'wizard' || uiType === 'mixed') {
    typeSpecific += `

async function goToStep(stepIndex) {
  const navLinks = page.locator('.pf-v6-c-wizard__nav-link');
  const link = navLinks.nth(stepIndex);
  if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
    await link.click();
    await page.waitForTimeout(800);
  }
}

async function nextStep() {
  const nextBtn = page.locator('button:has-text("Next"), .pf-v6-c-wizard__footer button.pf-m-primary').first();
  if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await nextBtn.click();
    await page.waitForTimeout(800);
  }
}`;
  }

  if (uiType === 'dashboard' || uiType === 'mixed') {
    typeSpecific += `

async function clickCard(selector) {
  const card = page.locator(selector).first();
  if (await card.isVisible({ timeout: 2000 }).catch(() => false)) {
    await card.click();
    await page.waitForTimeout(800);
  }
}

async function expandSection(selector) {
  const section = page.locator(selector).first();
  if (await section.isVisible({ timeout: 2000 }).catch(() => false)) {
    await section.click();
    await page.waitForTimeout(800);
  }
}`;
  }

  return common + typeSpecific;
}

// ── Assemble the full script ──

const script = `${budgetComment}
import { firefox } from '${relPlaywright}';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const BASE_URL = '${prototypeUrl}';
const ARTIFACTS = '${abs.replace(/'/g, "\\'")}';
const SCREENSHOTS = \`\${ARTIFACTS}/screenshots\`;
const componentMap = JSON.parse(readFileSync(\`\${ARTIFACTS}/component-map.json\`, 'utf8'));

mkdirSync(SCREENSHOTS, { recursive: true });

const browser = await firefox.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 900 } });
const page = await context.newPage();

// --- PF6 UTILITIES ---

// Pre-seed initialization from component map
const initLS = componentMap.initialization?.local_storage || {};
await page.addInitScript((ls) => {
  for (const [key, value] of Object.entries(ls)) {
    try { localStorage.setItem(key, value); } catch {}
  }
}, initLS);
${getUtilities()}

// --- JOURNEYS ---
${journeyFunctions}

// --- MAIN ---
async function main() {
  const results = [];

  await navigateTo(componentMap.target_page);
  await screenshot('baseline-before.png');

${journeys.map((j, i) => `  await navigateTo(componentMap.target_page);
  const j${i + 1} = await journey${i + 1}();
  results.push(j${i + 1});
  console.log(\`Journey ${i + 1} (\${j${i + 1}.ac_ids.join(', ')}): \${j${i + 1}.verdict}\`);
`).join('\n')}

  await browser.close();

  // Write journey-log.json (deterministic — eliminates LLM Steps 5+7)
  const journeyLog = {
    depth: 'deep',
    prototype_url: BASE_URL,
    evaluated_at: new Date().toISOString(),
    journeys: results
  };
  writeFileSync(\`\${ARTIFACTS}/journey-log.json\`, JSON.stringify(journeyLog, null, 2));
  console.log('Journey log written to journey-log.json');

  console.log('\\nAll journeys complete.');
}

main().catch(err => {
  console.error('Pipeline error:', err);
  process.exit(1);
});
`;

const outPath = path.join(abs, 'journey-test.mjs');
fs.writeFileSync(outPath, script, 'utf8');

console.log(`\u2713 Generated ${outPath}`);
console.log(`  ${journeys.length} journeys, ${pool.length} interaction pool items`);
console.log(`  UI type: ${uiType}`);
console.log(`  Content ready selector: ${contentReady}`);
console.log(`  Unique interactions assigned: ${usedStates.size}`);
console.log(`  Budget:`);
for (const j of journeys) {
  const a = assignments.get(j.id);
  console.log(`    ${j.id}: ${a.type} \u2192 ${a.target}`);
}
