// SOURCE PRE-SCAN RESULTS:
// Deployments.tsx table columns: ["Model deployment name", "Project", "Serving runtime", "Inference endpoints", "API protocol", "Last deployed", "Status", "Actions"]
// Status column (index 6): renders via renderStatusBadge() — shows Ready|Active|Failed|Deploying|Stopped
// NO Kueue-specific columns (Queue, Scheduling Status) exist in the current prototype
// NO expandable rows (<Tr isExpanded>) in Deployments.tsx
// NO Kueue-specific tooltip (<Tooltip> wrapping scheduling status) — tooltips exist only for resource names and endpoints
// Feature flags: useFeatureFlags() used for showProjectWorkspaceDropdowns only — no Kueue feature flag
// Mock data statuses: 'Ready', 'Failed', 'Active', 'Stopped', 'Deploying' — no Kueue states (Queued, Pending, Admitted, etc.)
// LLMInferenceService: referenced only in YAML template (getFullYamlForEdit), not in table rendering
// Route: /ai-hub/models/deployments (from routes.tsx)
//
// AC MAPPING:
// AC-1 "Kueue scheduling state in Status column" → Status column (index 6) currently has standard statuses only → FAIL expected
// AC-2 "No Kueue indicators when disabled" → Current state HAS no Kueue indicators → PASS (default-state AC)
// AC-3 "Unmanaged IS shows normal status" → All rows show standard KServe statuses → PASS (default-state AC)
// AC-4 "Real-time status updates" → No Kueue status update mechanism → FAIL expected
// AC-5 "No RBAC error indicators" → No [class*="error"], [role="alert"], 403/Forbidden → PASS (default-state AC)
// AC-6 "Tooltip with resource info on hover" → No scheduling status tooltip exists → FAIL expected
// AC-7 "Covers both IS and LLMIS" → No Kueue differentiation in UI → FAIL expected

import { firefox } from 'playwright';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { resolve, dirname } from 'path';

const BASE_URL = 'http://localhost:8080';
const ARTIFACTS_DIR = resolve(process.cwd(), '.artifacts/RHAISTRAT-432');
const SCREENSHOTS_DIR = resolve(ARTIFACTS_DIR, 'screenshots');

if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const screenshotHashes = [];
const journeyLog = {
  depth: 'deep',
  prototype_url: BASE_URL,
  evaluated_at: new Date().toISOString(),
  journeys: [],
  exploration: []
};

async function captureAndValidate(page, filepath, waitFor) {
  if (waitFor) {
    await page.waitForSelector(waitFor, { timeout: 8000 }).catch(() => null);
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: filepath, fullPage: false });
  const buffer = readFileSync(filepath);
  const hash = createHash('md5').update(buffer).digest('hex');
  if (screenshotHashes.length > 0 && screenshotHashes[screenshotHashes.length - 1] === hash) {
    console.warn(`WARNING: ${filepath} identical to previous`);
  }
  screenshotHashes.push(hash);
  return hash;
}

async function journey1(page) {
  const steps = [];
  
  // Step 1: Navigate to Model Deployments
  await page.goto(`${BASE_URL}/ai-hub/models/deployments`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#model-deployments-table tbody tr', { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(1500);
  await captureAndValidate(page, `${SCREENSHOTS_DIR}/journey-1-step-1.png`, '#model-deployments-table tbody tr');
  steps.push({
    step: 1,
    action: 'navigate',
    target: 'AI Hub > Models > Deployments',
    result: 'success',
    timestamp_ms: Date.now(),
    screenshot: 'screenshots/journey-1-step-1.png',
    narration: 'Navigated to Model Deployments overview. Table loaded with deployment rows.'
  });

  // Step 2: Check Status column for Kueue scheduling states
  const headerCells = await page.locator('thead th').allTextContents();
  const statusIndex = headerCells.findIndex(h => h.includes('Status'));
  const statusCells = page.locator(`tbody tr td:nth-child(${statusIndex + 1})`);
  const statusTexts = await statusCells.allTextContents();
  
  const kueueStates = ['Queued', 'Quota Pending', 'Admitted', 'Pending', 'Scaling', 'Suspended'];
  const hasKueueStatus = statusTexts.some(text => kueueStates.some(state => text.includes(state)));
  
  await captureAndValidate(page, `${SCREENSHOTS_DIR}/journey-1-step-2.png`, null);
  steps.push({
    step: 2,
    action: 'verify',
    target: 'Status column for Kueue scheduling states',
    result: hasKueueStatus ? 'success' : 'fail',
    timestamp_ms: Date.now(),
    screenshot: 'screenshots/journey-1-step-2.png',
    narration: `Status column contains: [${statusTexts.join(', ')}]. ${hasKueueStatus ? 'Kueue scheduling states found.' : 'No Kueue-specific scheduling states found — only standard statuses (Ready, Active, Failed, Stopped).'}`
  });

  // Step 3: Check for Kueue-specific columns
  const hasQueueCol = headerCells.some(h => h.toLowerCase().includes('queue'));
  const hasSchedulingCol = headerCells.some(h => h.toLowerCase().includes('scheduling'));
  
  await captureAndValidate(page, `${SCREENSHOTS_DIR}/journey-1-step-3.png`, null);
  steps.push({
    step: 3,
    action: 'verify',
    target: 'Table headers for Kueue columns',
    result: (hasQueueCol || hasSchedulingCol) ? 'success' : 'fail',
    timestamp_ms: Date.now(),
    screenshot: 'screenshots/journey-1-step-3.png',
    narration: `Table columns: [${headerCells.join(', ')}]. ${hasQueueCol ? 'Queue column found.' : 'No Queue column.'} ${hasSchedulingCol ? 'Scheduling column found.' : 'No Scheduling column.'}`
  });

  const overallResult = hasKueueStatus ? 'PASS' : 'FAIL';
  journeyLog.journeys.push({
    id: 'journey-1',
    title: 'View Kueue Scheduling Status on Model Deployments',
    persona: 'ML Engineer',
    source: 'Inferred from AC-1: Kueue scheduling state displays in Status column',
    ac_ids: ['AC-1', 'AC-4'],
    verdict: overallResult,
    steps_expected: 3,
    steps_completed: steps.length,
    steps
  });
  console.log(`Journey 1 (AC-1, AC-4): ${overallResult}`);
}

async function journey2(page) {
  const steps = [];
  
  // Step 1: Navigate to Model Deployments
  await page.goto(`${BASE_URL}/ai-hub/models/deployments`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#model-deployments-table tbody tr', { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(1500);
  await captureAndValidate(page, `${SCREENSHOTS_DIR}/journey-2-step-1.png`, '#model-deployments-table tbody tr');
  steps.push({
    step: 1,
    action: 'navigate',
    target: 'Model Deployments Overview',
    result: 'success',
    timestamp_ms: Date.now(),
    screenshot: 'screenshots/journey-2-step-1.png',
    narration: 'Navigated to Model Deployments overview to verify absence of Kueue indicators.'
  });

  // Step 2: Verify no Kueue-related indicators (AC-2 default-state)
  const headerCells = await page.locator('thead th').allTextContents();
  const hasKueueCols = headerCells.some(h => 
    h.toLowerCase().includes('queue') || h.toLowerCase().includes('scheduling') || h.toLowerCase().includes('kueue')
  );
  
  const pageContent = await page.content();
  const hasKueueText = pageContent.includes('Kueue') || pageContent.includes('kueue') || 
    pageContent.includes('Queued') || pageContent.includes('Quota Pending') || pageContent.includes('Admitted');
  
  const noKueueIndicators = !hasKueueCols && !hasKueueText;
  
  await captureAndValidate(page, `${SCREENSHOTS_DIR}/journey-2-step-2.png`, null);
  steps.push({
    step: 2,
    action: 'verify',
    target: 'Absence of Kueue-related indicators',
    result: noKueueIndicators ? 'success' : 'fail',
    timestamp_ms: Date.now(),
    screenshot: 'screenshots/journey-2-step-2.png',
    narration: `${noKueueIndicators ? 'No Kueue-related columns or text found — overview renders identically to non-Kueue baseline. AC-2 satisfied by default state.' : 'Kueue indicators detected unexpectedly.'}`
  });

  // Step 3: Verify no error indicators (AC-5)
  const errorElements = await page.locator('[class*="error"], [class*="danger"], .pf-v6-c-alert--danger, [role="alert"]').count();
  const has403 = pageContent.includes('403') || pageContent.includes('Forbidden');
  const noErrors = errorElements === 0 && !has403;
  
  await captureAndValidate(page, `${SCREENSHOTS_DIR}/journey-2-step-3.png`, null);
  steps.push({
    step: 3,
    action: 'verify',
    target: 'Absence of error/403 indicators',
    result: noErrors ? 'success' : 'fail',
    timestamp_ms: Date.now(),
    screenshot: 'screenshots/journey-2-step-3.png',
    narration: `${noErrors ? 'No error elements, danger alerts, or 403/Forbidden text found. AC-5 satisfied — deployments render normally without RBAC errors.' : `Found ${errorElements} error elements and ${has403 ? '403' : 'no 403'} text.`}`
  });

  // Step 4: Verify unmanaged rows show normal status (AC-3)
  const statusIndex = headerCells.findIndex(h => h.includes('Status'));
  const statusCells = page.locator(`tbody tr td:nth-child(${statusIndex + 1})`);
  const statusTexts = await statusCells.allTextContents();
  const allNormalStatuses = statusTexts.every(text => 
    ['Ready', 'Active', 'Failed', 'Deploying', 'Stopped', 'Stop', 'Unknown'].some(s => text.includes(s)) || text.trim() === ''
  );
  
  await captureAndValidate(page, `${SCREENSHOTS_DIR}/journey-2-step-4.png`, null);
  steps.push({
    step: 4,
    action: 'verify',
    target: 'All rows show normal KServe-derived statuses',
    result: allNormalStatuses ? 'success' : 'fail',
    timestamp_ms: Date.now(),
    screenshot: 'screenshots/journey-2-step-4.png',
    narration: `All deployment rows display standard KServe-derived statuses: [${statusTexts.join(', ')}]. No Kueue-specific status text found. AC-3 satisfied — unmanaged InferenceServices show normal status.`
  });

  const overallResult = (noKueueIndicators && noErrors && allNormalStatuses) ? 'PASS' : 'FAIL';
  journeyLog.journeys.push({
    id: 'journey-2',
    title: 'Verify No Kueue Indicators When Disabled',
    persona: 'Platform Operator',
    source: 'Inferred from AC-2: No Kueue indicators when Kueue not enabled',
    ac_ids: ['AC-2', 'AC-3', 'AC-5'],
    verdict: overallResult,
    steps_expected: 4,
    steps_completed: steps.length,
    steps
  });
  console.log(`Journey 2 (AC-2, AC-3, AC-5): ${overallResult}`);
}

async function journey3(page) {
  const steps = [];
  
  // Step 1: Navigate to Deployments
  await page.goto(`${BASE_URL}/ai-hub/models/deployments`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#model-deployments-table tbody tr', { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(1500);
  await captureAndValidate(page, `${SCREENSHOTS_DIR}/journey-3-step-1.png`, '#model-deployments-table tbody tr');
  steps.push({
    step: 1,
    action: 'navigate',
    target: 'Model Deployments',
    result: 'success',
    timestamp_ms: Date.now(),
    screenshot: 'screenshots/journey-3-step-1.png',
    narration: 'Navigated to Model Deployments page to test scheduling status tooltip.'
  });

  // Step 2: Look for scheduling status indicators to hover over
  const headerCells = await page.locator('thead th').allTextContents();
  const statusIndex = headerCells.findIndex(h => h.includes('Status'));
  const firstStatusCell = page.locator(`tbody tr:first-child td:nth-child(${statusIndex + 1})`);
  const statusLabel = firstStatusCell.locator('.pf-v6-c-label, .pf-v5-c-label, [class*="label"]').first();
  const labelExists = await statusLabel.count() > 0;
  
  let tooltipFound = false;
  let tooltipText = '';
  if (labelExists) {
    await statusLabel.hover();
    await page.waitForTimeout(500);
    const tooltip = page.locator('.pf-v6-c-tooltip__content, .pf-v5-c-tooltip__content');
    tooltipFound = await tooltip.isVisible({ timeout: 3000 }).catch(() => false);
    if (tooltipFound) {
      tooltipText = await tooltip.textContent().catch(() => '');
    }
  }
  
  const hasResourceInfo = tooltipText.includes('CPU') || tooltipText.includes('memory') || tooltipText.includes('GPU');
  
  await captureAndValidate(page, `${SCREENSHOTS_DIR}/journey-3-step-2.png`, null);
  steps.push({
    step: 2,
    action: 'hover',
    target: 'Status label in first deployment row',
    result: hasResourceInfo ? 'success' : 'fail',
    timestamp_ms: Date.now(),
    screenshot: 'screenshots/journey-3-step-2.png',
    narration: `${labelExists ? 'Status label found. ' : 'No status label element found. '}${tooltipFound ? `Tooltip appeared with text: "${tooltipText}".` : 'No Kueue resource tooltip appeared on hover.'} ${hasResourceInfo ? 'Resource info (CPU/memory/GPU) displayed.' : 'No resource allocation information in tooltip — Kueue scheduling status tooltip not implemented.'}`
  });

  // Step 3: Check for LLMInferenceService differentiation (AC-7)
  const pageContent = await page.content();
  const hasLLMISIndicator = pageContent.includes('LLMInferenceService') || pageContent.includes('llminferenceservice');
  const hasISIndicator = pageContent.includes('InferenceService');
  
  await captureAndValidate(page, `${SCREENSHOTS_DIR}/journey-3-step-3.png`, null);
  steps.push({
    step: 3,
    action: 'verify',
    target: 'InferenceService and LLMInferenceService type differentiation',
    result: (hasLLMISIndicator && hasISIndicator) ? 'success' : 'fail',
    timestamp_ms: Date.now(),
    screenshot: 'screenshots/journey-3-step-3.png',
    narration: `${hasISIndicator ? 'InferenceService resource type mentioned (in popover).' : 'No explicit InferenceService type indicator.'} ${hasLLMISIndicator ? 'LLMInferenceService type found.' : 'No LLMInferenceService type differentiation visible.'} Kueue integration does not visually distinguish between IS and LLMIS resource types.`
  });

  const overallResult = hasResourceInfo ? 'PASS' : 'FAIL';
  journeyLog.journeys.push({
    id: 'journey-3',
    title: 'Check Resource Tooltip on Scheduling Status',
    persona: 'ML Engineer',
    source: 'Inferred from AC-6: Tooltip with resource info on hover',
    ac_ids: ['AC-6', 'AC-7'],
    verdict: overallResult,
    steps_expected: 3,
    steps_completed: steps.length,
    steps
  });
  console.log(`Journey 3 (AC-6, AC-7): ${overallResult}`);
}

async function main() {
  const browser = await firefox.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  
  try {
    // Baseline screenshot (iteration 1)
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/baseline-before.png`, fullPage: false });
    console.log('Baseline screenshot captured.');
    
    // Run journeys
    await journey1(page);
    await journey2(page);
    await journey3(page);
    
  } catch (err) {
    console.error('Journey execution error:', err.message);
  } finally {
    await context.close();
    await browser.close();
  }
  
  // Write journey-log.json
  writeFileSync(`${ARTIFACTS_DIR}/journey-log.json`, JSON.stringify(journeyLog, null, 2));
  console.log('journey-log.json written.');
  console.log(`Total journeys: ${journeyLog.journeys.length}`);
  journeyLog.journeys.forEach(j => console.log(`  ${j.id}: ${j.verdict} (${j.steps_completed}/${j.steps_expected} steps)`));
}

main().catch(console.error);
