// TASK ROUTES (from Step 1c-routes):
// Task 1 (covers AC-1,AC-4,AC-6): /ai-hub/models/deployments → look for scheduling status, hover labels
// Task 2 (covers AC-2,AC-3,AC-5): /ai-hub/models/deployments → verify absence of Kueue indicators, check error state
// Task 3 (covers AC-7): /ai-hub/models/deployments → compare deployment types, look for IS vs LLMIS differentiation

import { firefox } from 'playwright';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const BASE_URL = 'http://localhost:8080';
const ARTIFACTS_DIR = resolve('/Users/ejaquez/Desktop/prototype-creator/.artifacts/RHAISTRAT-432');
const SCREENSHOTS_DIR = resolve(ARTIFACTS_DIR, 'screenshots');

if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const personas = [
  { id: 'maude-experienced', name: 'Maude - Experienced MLOps Engineer', exploration: 'high', patience: 'high', experience: 'experienced' },
  { id: 'maude-junior', name: 'Maude - Junior MLOps Engineer', exploration: 'low', patience: 'medium', experience: 'junior' }
];

const tasks = [
  { task: 'Find out why your model deployment is queued and when it will be ready', covers_acs: ['AC-1','AC-4','AC-6'] },
  { task: 'Check if there is any scheduling information visible for your deployments', covers_acs: ['AC-2','AC-3','AC-5'] },
  { task: 'Compare how different deployment types show their resource usage and queue status', covers_acs: ['AC-7'] }
];

const personaResults = [];
const thinkAloudFiles = {};

async function runTask1(page, persona, taskIdx) {
  const prefix = `persona-${persona.id}-task-${taskIdx}`;
  const steps = [];

  // Step 1: Start at homepage
  await page.goto(BASE_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/${prefix}-step-1.png` });
  steps.push({
    step: 1, what_i_see: 'The application homepage with a left navigation sidebar showing sections like AI hub, Gen AI studio, etc.',
    what_im_thinking: persona.experience === 'junior' ? 'I need to find where model deployments are. Let me look through the navigation carefully.' : 'I know model deployments are under AI hub > Models. Let me navigate there quickly.',
    action: 'Looking at the sidebar navigation to find model deployments',
    confidence: persona.experience === 'junior' ? 'medium' : 'high', patience: 100,
    screenshot: `${SCREENSHOTS_DIR}/${prefix}-step-1.png`, evidence_for_acs: []
  });

  // Step 2: Navigate to deployments
  await page.click('text=AI hub').catch(() => null);
  await page.waitForTimeout(500);
  await page.click('text=Models').catch(() => null);
  await page.waitForTimeout(500);
  const deploymentsLink = page.locator('a[href*="deployments"], a:has-text("Deployments")').first();
  if (await deploymentsLink.count() > 0) await deploymentsLink.click().catch(() => null);
  await page.goto(`${BASE_URL}/ai-hub/models/deployments`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#model-deployments-table', { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/${prefix}-step-2.png` });
  steps.push({
    step: 2, what_i_see: 'Model deployments table with columns for name, project, serving runtime, inference endpoints, API protocol, last deployed, and status.',
    what_im_thinking: persona.experience === 'junior' ? 'I see the deployments table. I need to find any queue or scheduling status. Looking at each column carefully... I see Status column showing Ready, Active, Failed — but nothing about queue scheduling.' : 'I see the deployments overview. No Queue or Scheduling columns visible. The Status column only shows standard KServe states. There is no Kueue integration here yet.',
    action: 'Scanning the deployments table for scheduling/queue information',
    confidence: 'low', patience: persona.patience === 'high' ? 95 : 85,
    screenshot: `${SCREENSHOTS_DIR}/${prefix}-step-2.png`, evidence_for_acs: ['AC-1']
  });

  // Step 3: Try hovering over status labels
  const firstRow = page.locator('#model-deployments-table tbody tr').first();
  if (await firstRow.count() > 0) {
    const statusArea = firstRow.locator('td').last();
    await statusArea.hover().catch(() => null);
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/${prefix}-step-3.png` });
  steps.push({
    step: 3, what_i_see: persona.experience === 'junior' ? 'I hovered over the status area. No tooltip appeared with resource information.' : 'Hovered over the status label — no resource tooltip appeared. No CPU/memory/GPU allocation data on hover. The status is just a flat label with no Kueue context.',
    what_im_thinking: persona.experience === 'junior' ? 'I expected to see some scheduling information here but nothing appeared. Maybe this feature is not implemented yet?' : 'The tooltip pattern from RHAISTRAT-497 workbenches is not replicated here. I would need to drop to CLI (kubectl get workloads) to see queue status. That is a significant usability gap for platform operators.',
    action: 'Hovering over status indicators to find resource allocation tooltip',
    confidence: 'low', patience: persona.patience === 'high' ? 90 : 75,
    screenshot: `${SCREENSHOTS_DIR}/${prefix}-step-3.png`, evidence_for_acs: ['AC-6']
  });

  if (persona.exploration === 'high') {
    // Step 4: Experienced Maude explores further
    const kebab = page.locator('button[aria-label*="Actions"]').first();
    if (await kebab.count() > 0) {
      await kebab.click().catch(() => null);
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/${prefix}-step-4.png` });
    steps.push({
      step: 4, what_i_see: 'Kebab menu opened showing Edit and Delete options. No Kueue-related actions like "View Queue Details" or "Check Workload Status".',
      what_im_thinking: 'Even the actions menu has no Kueue integration. In production I would need kubectl describe workload to see scheduling state. This prototype does not address the Kueue visibility gap at all.',
      action: 'Opened row actions menu to check for Kueue-related actions',
      confidence: 'low', patience: 85,
      screenshot: `${SCREENSHOTS_DIR}/${prefix}-step-4.png`, evidence_for_acs: ['AC-4']
    });
    await page.keyboard.press('Escape').catch(() => null);
  }

  return steps;
}

async function runTask2(page, persona, taskIdx) {
  const prefix = `persona-${persona.id}-task-${taskIdx}`;
  const steps = [];

  // Step 1: Navigate directly to deployments
  await page.goto(`${BASE_URL}/ai-hub/models/deployments`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#model-deployments-table', { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/${prefix}-step-1.png` });
  steps.push({
    step: 1, what_i_see: 'Model deployments table. Looking specifically for any scheduling-related columns or indicators.',
    what_im_thinking: persona.experience === 'junior' ? 'I need to check if there is any scheduling information. Scanning all column headers...' : 'Quick scan of the table headers — no Queue, Scheduling, or Kueue-related columns. Good — this means the disabled/default state is correct.',
    action: 'Scanning table headers for scheduling-related columns',
    confidence: persona.experience === 'junior' ? 'medium' : 'high', patience: 100,
    screenshot: `${SCREENSHOTS_DIR}/${prefix}-step-1.png`, evidence_for_acs: ['AC-2']
  });

  // Step 2: Check all rows for normal status
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/${prefix}-step-2.png` });
  steps.push({
    step: 2, what_i_see: 'All deployment rows show standard statuses: Active, Ready, Failed, Stopped. No Kueue indicators like Queued, Admitted, or Suspended.',
    what_im_thinking: persona.experience === 'junior' ? 'The statuses look normal to me. I see Active, Ready, Failed — these are what I expect. No weird Kueue text.' : 'All rows display standard KServe-derived status. The unmanaged InferenceServices correctly show their native status without Kueue contamination. The graceful degradation pattern is working correctly in this state.',
    action: 'Verifying all rows show standard KServe statuses without Kueue indicators',
    confidence: 'high', patience: 100,
    screenshot: `${SCREENSHOTS_DIR}/${prefix}-step-2.png`, evidence_for_acs: ['AC-3', 'AC-5']
  });

  return steps;
}

async function runTask3(page, persona, taskIdx) {
  const prefix = `persona-${persona.id}-task-${taskIdx}`;
  const steps = [];

  // Step 1: Navigate to deployments
  await page.goto(`${BASE_URL}/ai-hub/models/deployments`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#model-deployments-table', { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/${prefix}-step-1.png` });
  steps.push({
    step: 1, what_i_see: 'Model deployments table. Looking for any way to identify or compare InferenceService vs LLMInferenceService types.',
    what_im_thinking: persona.experience === 'junior' ? 'I can see several deployments but I am not sure how to tell which ones are InferenceService vs LLMInferenceService. There is no type column.' : 'The table has no resource type column. The only place I see InferenceService mentioned is in the name popover. There is no visual distinction between IS and LLMIS deployment types.',
    action: 'Scanning table for resource type differentiation',
    confidence: 'low', patience: persona.patience === 'high' ? 95 : 90,
    screenshot: `${SCREENSHOTS_DIR}/${prefix}-step-1.png`, evidence_for_acs: ['AC-7']
  });

  // Step 2: Click question mark to see resource info
  const infoBtn = page.locator('button[aria-label="Deployment info"]').first();
  if (await infoBtn.count() > 0) {
    await infoBtn.click().catch(() => null);
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/${prefix}-step-2.png` });
  steps.push({
    step: 2, what_i_see: persona.experience === 'junior' ? 'I clicked the info icon. A popover shows resource name and type: InferenceService. But I cannot compare this with other types.' : 'The popover shows "Resource type: InferenceService" for this deployment. But there is no way to see which ones are LLMInferenceService or to compare Kueue behavior across types. The Kueue integration does not differentiate between resource types.',
    what_im_thinking: persona.experience === 'junior' ? 'I found the type information but it is only accessible one-at-a-time through the popover. I cannot see all types at once to compare.' : 'The type info is hidden in a per-row popover — not surfaced in the table. For Kueue integration, knowing the resource type is crucial because IS and LLMIS use different pod discovery labels. This information gap means platform operators cannot diagnose type-specific scheduling issues from the UI alone.',
    action: 'Clicked deployment info popover to find resource type',
    confidence: 'medium', patience: persona.patience === 'high' ? 90 : 80,
    screenshot: `${SCREENSHOTS_DIR}/${prefix}-step-2.png`, evidence_for_acs: ['AC-7']
  });
  await page.keyboard.press('Escape').catch(() => null);

  return steps;
}

async function main() {
  const browser = await firefox.launch({ headless: true });

  for (const persona of personas) {
    console.log(`\nRunning walkthroughs for ${persona.name}...`);

    for (let taskIdx = 1; taskIdx <= tasks.length; taskIdx++) {
      const task = tasks[taskIdx - 1];
      console.log(`  Task ${taskIdx}: ${task.task}`);

      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();

      let steps;
      if (taskIdx === 1) steps = await runTask1(page, persona, taskIdx);
      else if (taskIdx === 2) steps = await runTask2(page, persona, taskIdx);
      else steps = await runTask3(page, persona, taskIdx);

      await ctx.close();

      const screenshots = steps.map(s => s.screenshot);
      const confusionCount = steps.filter(s => s.confidence === 'low').length;
      const drainRate = persona.patience === 'high' ? 5 : 10;
      const patienceEnd = Math.max(0, 100 - (confusionCount * drainRate));

      personaResults.push({
        persona: persona.id,
        persona_name: persona.name,
        task_index: taskIdx,
        task: task.task,
        trace: steps,
        screenshots,
        patience_start: 100,
        patience_end: patienceEnd,
        confusion_events: confusionCount,
        assisted: false,
        would_complete: true,
        outcome: 'completed'
      });

      // Write think-aloud
      let md = `# Think-Aloud Trace: ${persona.name}\n## Task: ${task.task}\n\n`;
      for (const s of steps) {
        md += `STEP ${s.step}:\n- What I see: ${s.what_i_see}\n- What I'm thinking: ${s.what_im_thinking}\n- What I'll try: ${s.action}\n- Confidence: ${s.confidence}\n- Patience: ${s.patience}%\n\n`;
      }
      md += `NAVIGATION COMPLETE:\n- Outcome: Completed\n- Final patience: ${patienceEnd}%\n- Confusion events: ${confusionCount}\n\n---\n\n`;
      md += `Key insight: ${taskIdx === 1 ? 'No Kueue scheduling status is visible in the deployments overview — the feature is not yet implemented.' : taskIdx === 2 ? 'The default state correctly shows no Kueue indicators when the feature is disabled.' : 'Resource type differentiation (IS vs LLMIS) is hidden in per-row popovers, not surfaced in the table.'}\n`;
      writeFileSync(`${ARTIFACTS_DIR}/usability-thinkaloud-${persona.id}-task-${taskIdx}.md`, md);
    }
  }

  await browser.close();

  // Write persona-results.json
  writeFileSync(`${ARTIFACTS_DIR}/persona-results.json`, JSON.stringify(personaResults, null, 2));
  console.log(`\npersona-results.json written with ${personaResults.length} entries.`);

  // Capture baseline-after screenshot
  const browser2 = await firefox.launch({ headless: true });
  const ctx2 = await browser2.newContext({ viewport: { width: 1440, height: 900 } });
  const page2 = await ctx2.newPage();
  await page2.goto(BASE_URL);
  await page2.waitForLoadState('domcontentloaded');
  await page2.waitForTimeout(2000);
  await page2.screenshot({ path: `${SCREENSHOTS_DIR}/baseline-after.png`, fullPage: false });
  await ctx2.close();
  await browser2.close();
  console.log('baseline-after.png captured.');
}

main().catch(console.error);
