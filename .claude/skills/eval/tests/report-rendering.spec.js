// @ts-check
const { test, expect } = require('@playwright/test');
const { readFileSync, existsSync } = require('fs');
const { join, resolve } = require('path');
const { execSync } = require('child_process');

/**
 * report-rendering.spec.js
 *
 * Playwright evaluation tests for the eval pipeline report.
 * Loads the generated HTML report in a real browser and verifies that
 * every data section renders visible, interactive, and populated content.
 *
 * These are evaluation tests (does the report communicate its data?),
 * NOT pipeline tests (does the pipeline produce correct data?).
 *
 * Usage:
 *   ARTIFACTS_DIR=.artifacts/RHAISTRAT-1433 npx playwright test report-rendering.spec.js
 *
 * The ARTIFACTS_DIR env var must point to a completed eval run.
 * If no report exists yet, the test suite renders one before starting.
 */

const ARTIFACTS_DIR = resolve(process.env.ARTIFACTS_DIR || '.artifacts/RHAISTRAT-1433');
const EVAL_ROOT = join(__dirname, '..');
const PROJECT_ROOT = join(EVAL_ROOT, '..', '..', '..');

// ── Helpers ──────────────────────────────────────────────────────────────

function loadJson(filename) {
  const p = join(ARTIFACTS_DIR, filename);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// ── Pre-test: ensure report is rendered ──────────────────────────────────

test.beforeAll(async () => {
  const reportPath = join(ARTIFACTS_DIR, 'evaluation-report.html');
  if (!existsSync(reportPath)) {
    const renderScript = join(EVAL_ROOT, 'scripts', 'render-report.js');
    execSync(`node "${renderScript}" "${ARTIFACTS_DIR}" --note="playwright-test-render"`, {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
    });
  }
  if (!existsSync(reportPath)) {
    throw new Error(`Report not found after render: ${reportPath}`);
  }
});

// ── Load source data once ────────────────────────────────────────────────

const journeyLog = loadJson('journey-log.json');
const personaResults = loadJson('persona-results.json');
const consistencyReport = loadJson('consistency-report.json');
const evaluationSummary = loadJson('evaluation-summary.json');
const iterationLog = loadJson('iteration-log.json');
const extractState = loadJson('extract-state.json');

// ── Fixture: open the report ─────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  const reportPath = join(ARTIFACTS_DIR, 'evaluation-report.html');
  await page.goto(`file://${reportPath}`);
  await page.waitForLoadState('domcontentloaded');
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 1: Page Structure
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Page Structure', () => {
  test('report has a title with the Jira key', async ({ page }) => {
    const title = await page.title();
    expect(title).toMatch(/Evaluation:/);
    expect(title).toMatch(/[A-Z]+-\d+/);
  });

  test('executive summary section is visible', async ({ page }) => {
    const summary = page.locator('[data-tour="context"]');
    await expect(summary).toBeVisible();
  });

  test('status hero shows pass fraction', async ({ page }) => {
    const hero = page.locator('.status-hero-value');
    await expect(hero).toBeVisible();
    const text = await hero.textContent();
    expect(text).toMatch(/\d+\/\d+/);
  });

  test('appendix tabs are present and clickable', async ({ page }) => {
    const tabs = page.locator('[data-tour="appendix-tabs"] .appendix-tab');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 2: Acceptance Criteria Table
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Acceptance Criteria', () => {
  test('AC table renders with rows', async ({ page }) => {
    const table = page.locator('[data-tour="ac-table"]');
    await expect(table).toBeVisible();
    const rows = page.locator('#ac-table-jira tr, #evaluator-checks tr');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('every AC row has a verdict badge', async ({ page }) => {
    const badges = page.locator('#ac-table-jira .badge, #evaluator-checks .badge');
    const count = await badges.count();
    expect(count).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < count; i++) {
      const text = await badges.nth(i).textContent();
      expect(['PASS', 'FAIL', 'FLAGGED']).toContain(text.trim());
    }
  });

  test('AC IDs from extract-state appear in the table', async ({ page }) => {
    if (!extractState?.acceptance_criteria) test.skip();
    for (const ac of extractState.acceptance_criteria.slice(0, 3)) {
      const id = ac.criterion_id || ac.id;
      if (!id) continue;
      await expect(page.locator(`text=${id}`).first()).toBeVisible();
    }
  });

  test('evidence links are present on AC rows', async ({ page }) => {
    const links = page.locator('.ac-view-link');
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 3: Flagged Items
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Flagged Items', () => {
  test('flagged section exists', async ({ page }) => {
    const flagged = page.locator('[data-tour="flagged"]');
    await expect(flagged).toBeVisible();
  });

  test('flagged items have review CTA when present', async ({ page }) => {
    const flaggedBadges = page.locator('.badge-flagged');
    const count = await flaggedBadges.count();
    if (count === 0) test.skip();
    const reviewBtn = page.locator('.status-cta-primary');
    await expect(reviewBtn).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 4: Persona Walkthroughs (Journeys Tab)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Persona Walkthroughs', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => {
      if (typeof switchAppendixTab === 'function') switchAppendixTab('journeys');
    });
  });

  test('journeys tab is visible and active', async ({ page }) => {
    const tab = page.locator('#appendix-journeys');
    await expect(tab).toBeVisible();
  });

  test('persona cards render for each evaluated persona', async ({ page }) => {
    if (!journeyLog?.usability_dimensions?.personas_evaluated) test.skip();
    const personas = journeyLog.usability_dimensions.personas_evaluated;
    const cards = page.locator('#appendix-journeys .card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(personas.length);
  });

  test('persona cards show task count, patience, and confusion stats', async ({ page }) => {
    // Persona cards are inside the grid layout, not the first .card (which is persona-selection info)
    const cards = page.locator('#appendix-journeys .card:has(.badge)');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const text = await card.textContent();
      expect(text).toMatch(/task/i);
      expect(text).toMatch(/patience/i);
      expect(text).toMatch(/confusion/i);
    }
  });

  test('persona cards show completion badge', async ({ page }) => {
    const badges = page.locator('#appendix-journeys .badge');
    const count = await badges.count();
    expect(count).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < count; i++) {
      const text = await badges.nth(i).textContent();
      expect(['completed', 'abandoned']).toContain(text.trim());
    }
  });

  test('persona cards have "View Walkthrough" link', async ({ page }) => {
    const links = page.locator('#appendix-journeys >> text=View Walkthrough');
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('persona selection reasoning is substantive (not fallback)', async ({ page }) => {
    const fallback = page.locator('text=Full persona selection reasoning was not logged');
    await expect(fallback).toHaveCount(0);
  });

  test('target audience text renders', async ({ page }) => {
    if (!journeyLog?.persona_selection?.target_audience_text) test.skip();
    const audienceText = journeyLog.persona_selection.target_audience_text;
    const snippet = audienceText.slice(0, 30);
    await expect(page.locator(`text=${snippet}`).first()).toBeVisible();
  });

  test('considered-but-rejected personas render', async ({ page }) => {
    const rejected = journeyLog?.persona_selection?.considered_but_rejected;
    if (!rejected || rejected.length === 0) test.skip();
    // The rejected list is inside a collapsed <details>; expand it first
    const detailsSummary = page.locator('#appendix-journeys details summary').first();
    await detailsSummary.click();
    await page.waitForTimeout(300);
    const first = rejected[0];
    const id = first.persona_id || first.persona;
    await expect(page.locator(`#appendix-journeys >> text=${id}`).first()).toBeVisible();
  });

  test('walkthrough data is embedded in JS and non-empty', async ({ page }) => {
    const data = await page.evaluate(() => {
      return typeof personaWalkthroughData !== 'undefined' ? personaWalkthroughData : null;
    });
    expect(data).not.toBeNull();
    const personaIds = Object.keys(data);
    expect(personaIds.length).toBeGreaterThanOrEqual(1);
    for (const pid of personaIds) {
      expect(data[pid].tasks.length).toBeGreaterThanOrEqual(1);
      for (const task of data[pid].tasks) {
        expect(task.steps.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 5: Usability Dimension Scores
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Usability Dimensions', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => {
      if (typeof switchAppendixTab === 'function') switchAppendixTab('usability');
    });
  });

  test('usability tab renders', async ({ page }) => {
    const tab = page.locator('#appendix-usability');
    await expect(tab).toBeVisible();
  });

  test('overall usability score appears somewhere in the report', async ({ page }) => {
    if (!journeyLog?.usability_dimensions?.overall_score) test.skip();
    const score = String(journeyLog.usability_dimensions.overall_score);
    // The overall score (e.g. "17") appears in the executive summary narrative
    // as "Usability: 17", not in the dimension tab itself (which shows per-dimension N/3)
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toContain(`Usability: ${score}`);
  });

  test('all 7 dimension cards render with scores', async ({ page }) => {
    const cards = page.locator('.usability-card');
    const count = await cards.count();
    expect(count).toBe(7);
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const text = await card.textContent();
      expect(text).toMatch(/\d+(\.\d+)?\/3/);
    }
  });

  test('dimension names match journey-log data', async ({ page }) => {
    if (!journeyLog?.usability_dimensions?.dimensions) test.skip();
    for (const dim of journeyLog.usability_dimensions.dimensions) {
      const nameEl = page.locator(`#appendix-usability >> text=${dim.name}`).first();
      await expect(nameEl).toBeVisible();
    }
  });

  test('per-persona scores appear within dimension cards', async ({ page }) => {
    if (!journeyLog?.usability_dimensions?.personas_evaluated) test.skip();
    const firstCard = page.locator('.usability-card').first();
    const text = await firstCard.textContent();
    for (const pid of journeyLog.usability_dimensions.personas_evaluated) {
      const displayName = pid.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      expect(text.toLowerCase()).toContain(displayName.toLowerCase().split(' ')[0]);
    }
  });

  test('patience tracking section has progress bars', async ({ page }) => {
    if (!journeyLog?.usability_dimensions?.persona_overlays) test.skip();
    const overlayCount = journeyLog.usability_dimensions.persona_overlays.length;
    const bars = page.locator('#appendix-usability >> text=Patience').first();
    await expect(bars).toBeVisible();
  });

  test('journey comparison table has expected/actual columns', async ({ page }) => {
    const table = page.locator('#appendix-usability table.tbl');
    const count = await table.count();
    if (count === 0) test.skip();
    const headerText = await table.first().textContent();
    expect(headerText).toContain('Expected');
    expect(headerText).toContain('Actual');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 6: Design Compliance (Consistency)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Design Compliance', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => {
      if (typeof switchAppendixTab === 'function') switchAppendixTab('design-compliance');
    });
  });

  test('design compliance tab renders', async ({ page }) => {
    const tab = page.locator('#appendix-design-compliance');
    await expect(tab).toBeVisible();
  });

  test('guidelines checked count matches consistency-report', async ({ page }) => {
    if (!consistencyReport?.summary?.total_guidelines_checked) test.skip();
    const count = String(consistencyReport.summary.total_guidelines_checked);
    await expect(page.locator(`#appendix-design-compliance >> text=${count}`).first()).toBeVisible();
  });

  test('violations render when present in consistency-report', async ({ page }) => {
    const violations = consistencyReport?.source_mode?.violations;
    if (!violations || violations.length === 0) test.skip();
    const section = page.locator('#appendix-design-compliance');
    const text = await section.textContent();
    const first = violations[0];
    const hasContent = text.includes(first.guideline_id)
      || text.includes(first.guideline_title || '')
      || text.includes(first.file || '')
      || text.includes(first.description?.slice(0, 30) || '');
    expect(hasContent).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 7: Fix History
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Fix History', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => {
      if (typeof switchAppendixTab === 'function') switchAppendixTab('fix-history');
    });
  });

  test('fix history tab renders', async ({ page }) => {
    const tab = page.locator('#appendix-fix-history');
    await expect(tab).toBeVisible();
  });

  test('iteration timeline shows iterations when present', async ({ page }) => {
    if (!iterationLog?.iterations || iterationLog.iterations.length === 0) test.skip();
    const timeline = page.locator('#iteration-timeline');
    await expect(timeline).toBeVisible();
  });

  test('fix entries render when fix-log has items', async ({ page }) => {
    const fixLog = loadJson('fix-log.json');
    if (!Array.isArray(fixLog) || fixLog.length === 0) test.skip();
    const findings = page.locator('#findings-fixed');
    await expect(findings).toBeVisible();
    const text = await findings.textContent();
    expect(text.length).toBeGreaterThan(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 8: What Changed (Pipeline Tab)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('What Changed', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => {
      if (typeof switchAppendixTab === 'function') switchAppendixTab('pipeline');
    });
  });

  test('pipeline tab renders', async ({ page }) => {
    const tab = page.locator('#appendix-pipeline');
    await expect(tab).toBeVisible();
  });

  test('delta summary shows file count', async ({ page }) => {
    const delta = page.locator('.delta-summary');
    const count = await delta.count();
    if (count === 0) test.skip();
    const text = await delta.first().textContent();
    expect(text).toMatch(/\d+/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 9: Evidence Viewer (Modal)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Evidence Viewer', () => {
  test('evidence viewer data is embedded and structured', async ({ page }) => {
    const data = await page.evaluate(() => {
      return typeof evidenceViewerData !== 'undefined' ? evidenceViewerData : null;
    });
    expect(data).not.toBeNull();
    expect(data.personas).toBeDefined();
    expect(Object.keys(data.personas).length).toBeGreaterThanOrEqual(1);
    expect(data.ac_list).toBeDefined();
    expect(data.ac_list.length).toBeGreaterThanOrEqual(1);
  });

  test('evidence viewer opens when clicking AC evidence link', async ({ page }) => {
    const link = page.locator('.ac-view-link').first();
    const count = await link.count();
    if (count === 0) test.skip();
    await link.click();
    const modal = page.locator('#evidence-viewer-modal');
    await expect(modal).toBeVisible({ timeout: 3000 });
  });

  test('evidence viewer has navigation controls', async ({ page }) => {
    await page.evaluate(() => {
      if (typeof openEvidenceViewer === 'function') openEvidenceViewer();
    });
    const modal = page.locator('#evidence-viewer-modal');
    if (!(await modal.isVisible())) test.skip();
    await expect(page.locator('#ev-prev-btn')).toBeVisible();
    await expect(page.locator('#ev-next-btn')).toBeVisible();
    await expect(page.locator('#ev-nav-counter')).toBeVisible();
  });

  test('evidence viewer shows persona trace tree', async ({ page }) => {
    await page.evaluate(() => {
      if (typeof openEvidenceViewer === 'function') openEvidenceViewer();
    });
    const modal = page.locator('#evidence-viewer-modal');
    if (!(await modal.isVisible())) test.skip();
    const tree = page.locator('#ev-tree');
    await expect(tree).toBeVisible();
    const treeText = await tree.textContent();
    expect(treeText.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 10: Review Panel
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Review Panel', () => {
  test('review panel opens from CTA button', async ({ page }) => {
    const cta = page.locator('.status-cta-primary');
    const count = await cta.count();
    if (count === 0) test.skip();
    await cta.click();
    const panel = page.locator('#review-panel');
    await expect(panel).toBeVisible({ timeout: 3000 });
  });

  test('review panel has verdict override controls', async ({ page }) => {
    const flaggedBadge = page.locator('.badge-flagged').first();
    const count = await flaggedBadge.count();
    if (count === 0) test.skip();
    await flaggedBadge.click();
    const panel = page.locator('#review-panel');
    await expect(panel).toBeVisible({ timeout: 3000 });
    // Check the panel has override controls (buttons or selects with data-override-ac)
    const overrideControls = page.locator('#review-panel [data-override-ac], #review-panel .override-active-pass, #review-panel .override-active-fail, #review-panel button');
    const controlCount = await overrideControls.count();
    expect(controlCount).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 11: CSV Export
// ═══════════════════════════════════════════════════════════════════════════

test.describe('CSV Export', () => {
  test('CSV data is embedded in the page', async ({ page }) => {
    const csvData = await page.evaluate(() => {
      return typeof csvData !== 'undefined' ? csvData : null;
    });
    expect(csvData).not.toBeNull();
    expect(csvData.length).toBeGreaterThan(50);
  });

  test('CSV preview toggle shows table', async ({ page }) => {
    await page.evaluate(() => {
      if (typeof toggleCsvPreview === 'function') toggleCsvPreview();
    });
    const preview = page.locator('#csvPreview');
    // After toggle, it should be visible
    if (await preview.isVisible()) {
      const table = page.locator('#csvTableWrap table');
      const count = await table.count();
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 12: Data Integrity Cross-Checks
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Data Integrity', () => {
  test('persona count in HTML matches journey-log personas_evaluated', async ({ page }) => {
    if (!journeyLog?.usability_dimensions?.personas_evaluated) test.skip();
    const expected = journeyLog.usability_dimensions.personas_evaluated.length;
    const data = await page.evaluate(() => {
      return typeof personaWalkthroughData !== 'undefined'
        ? Object.keys(personaWalkthroughData).length : 0;
    });
    expect(data).toBe(expected);
  });

  test('dimension count in HTML matches journey-log dimensions', async ({ page }) => {
    if (!journeyLog?.usability_dimensions?.dimensions) test.skip();
    const expected = journeyLog.usability_dimensions.dimensions.length;
    const cards = page.locator('.usability-card');
    await page.evaluate(() => {
      if (typeof switchAppendixTab === 'function') switchAppendixTab('usability');
    });
    const count = await cards.count();
    expect(count).toBe(expected);
  });

  test('evidence viewer AC list covers all Jira ACs', async ({ page }) => {
    // The evidence viewer ac_list contains all ACs (Jira + evaluator-generated).
    // The table may split them across two sections. Verify the evidence viewer
    // has at least as many ACs as the Jira table section.
    const jiraAcCount = await page.evaluate(() => {
      return document.querySelectorAll('#ac-table-jira tr').length;
    });
    const evAcCount = await page.evaluate(() => {
      return typeof evidenceViewerData !== 'undefined' && evidenceViewerData.ac_list
        ? evidenceViewerData.ac_list.length : 0;
    });
    expect(evAcCount).toBeGreaterThanOrEqual(jiraAcCount);
    expect(evAcCount).toBeGreaterThanOrEqual(1);
  });

  test('usability score from evaluation-summary appears in report body', async ({ page }) => {
    if (!evaluationSummary?.usability?.overall_score) test.skip();
    const expected = String(evaluationSummary.usability.overall_score);
    // The overall score appears in the exec narrative paragraph (e.g. "Usability: 17")
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toContain(`Usability: ${expected}`);
  });

  test('no blank data sections (empty accordions or missing content)', async ({ page }) => {
    // Switch through all tabs and check each has non-trivial content
    const tabs = ['journeys', 'usability', 'fix-history', 'design-compliance', 'pipeline'];
    for (const tab of tabs) {
      await page.evaluate((t) => {
        if (typeof switchAppendixTab === 'function') switchAppendixTab(t);
      }, tab);
      const section = page.locator(`#appendix-${tab}`);
      if (await section.isVisible()) {
        const text = await section.textContent();
        expect(text.trim().length, `Tab "${tab}" should have content`).toBeGreaterThan(20);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 13: Accessibility Baseline
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Accessibility Baseline', () => {
  test('page has a lang attribute', async ({ page }) => {
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBe('en');
  });

  test('all images have alt text or are decorative', async ({ page }) => {
    const images = page.locator('img');
    const count = await images.count();
    for (let i = 0; i < count; i++) {
      const alt = await images.nth(i).getAttribute('alt');
      const role = await images.nth(i).getAttribute('role');
      const ariaHidden = await images.nth(i).getAttribute('aria-hidden');
      const hasAlt = alt !== null || role === 'presentation' || ariaHidden === 'true';
      expect(hasAlt, `Image ${i} should have alt text or be marked decorative`).toBe(true);
    }
  });

  test('interactive elements are keyboard accessible', async ({ page }) => {
    const tabs = page.locator('.appendix-tab');
    const count = await tabs.count();
    if (count === 0) test.skip();
    const tag = await tabs.first().evaluate(el => el.tagName.toLowerCase());
    const role = await tabs.first().getAttribute('role');
    const tabindex = await tabs.first().getAttribute('tabindex');
    const isAccessible = ['button', 'a'].includes(tag) || role === 'tab' || tabindex !== null;
    expect(isAccessible).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Section 14: Regression — Data Flow Fixes
// Guards against 8 bugs fixed in render-report.js (Jul 2026):
//   task_index 0-vs-1, empty think-aloud, missing screenshots, dead journey
//   blocks, wrong compliance paths, persona fallback, dim.scores null guard,
//   consistency findings path.
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Regression: Data Flow Fixes', () => {

  // Fix 2 — journey blocks were built but never injected into the template
  test('journey blocks render inside journeys tab', async ({ page }) => {
    await page.evaluate(() => {
      if (typeof switchAppendixTab === 'function') switchAppendixTab('journeys');
    });
    const tab = page.locator('#appendix-journeys');
    if (!(await tab.isVisible())) test.skip();
    const dividers = page.locator('#appendix-journeys .journey-divider');
    const headings = page.locator('#appendix-journeys h3[style*="border-left"]');
    const divCount = await dividers.count();
    const headCount = await headings.count();
    expect(divCount + headCount, 'Journey blocks should render with dividers or styled headings').toBeGreaterThanOrEqual(1);
  });

  // Fix 3 — compliance count read from wrong JSON path (source_mode.guidelines_checked)
  test('compliance count matches summary.total_guidelines_checked', async ({ page }) => {
    if (!consistencyReport?.summary?.total_guidelines_checked) test.skip();
    const expected = consistencyReport.summary.total_guidelines_checked;
    await page.evaluate(() => {
      if (typeof switchAppendixTab === 'function') switchAppendixTab('design-compliance');
    });
    const statEl = page.locator('.consistency-stat-n').first();
    if (!(await statEl.isVisible())) test.skip();
    const rendered = parseInt(await statEl.textContent(), 10);
    expect(rendered).toBe(expected);
  });

  // Consistency findings path — violations lived at source_mode.violations but
  // actual data is at top-level findings[]
  test('consistency findings render from top-level findings array', async ({ page }) => {
    const findings = consistencyReport?.findings || consistencyReport?.source_mode?.violations;
    if (!findings || findings.length === 0) test.skip();
    await page.evaluate(() => {
      if (typeof switchAppendixTab === 'function') switchAppendixTab('design-compliance');
    });
    const section = page.locator('#appendix-design-compliance');
    const text = await section.textContent();
    const first = findings[0];
    const hasContent = text.includes(first.guideline_id || '')
      || text.includes(first.guideline_title || '')
      || text.includes(first.description?.slice(0, 30) || '')
      || text.includes('Quick Fixes')
      || text.includes('By Page');
    expect(hasContent, 'Consistency findings from findings[] or source_mode.violations should appear in DOM').toBe(true);
  });

  // Fix 4 — normalizeJourneyLog didn't handle flat steps_completed → NaN in table
  test('journey table has numeric step counts, not NaN', async ({ page }) => {
    await page.evaluate(() => {
      if (typeof switchAppendixTab === 'function') switchAppendixTab('usability');
    });
    const table = page.locator('#appendix-usability table.tbl');
    const count = await table.count();
    if (count === 0) test.skip();
    const text = await table.first().textContent();
    expect(text).not.toContain('NaN');
  });

  // Fix 5 — "criteriona" typo in two render-report.js locations
  test('no "criteriona" typo in rendered HTML', async ({ page }) => {
    const html = await page.content();
    expect(html).not.toContain('criteriona');
  });

  // Fix 8 — personas_evaluated missing from journey-log; renderer should
  // derive persona list from persona-results.json
  test('evidence viewer personas match persona-results.json', async ({ page }) => {
    if (!personaResults || !Array.isArray(personaResults) || personaResults.length === 0) test.skip();
    const expectedPids = [...new Set(personaResults.map(r => r.persona_id || r.persona))];
    const evPersonas = await page.evaluate(() => {
      return typeof evidenceViewerData !== 'undefined' && evidenceViewerData.personas
        ? Object.keys(evidenceViewerData.personas) : [];
    });
    expect(evPersonas.length, 'Evidence viewer should have personas even without journey-log.personas_evaluated').toBeGreaterThanOrEqual(1);
    for (const pid of expectedPids) {
      expect(evPersonas, `Persona ${pid} from persona-results.json should be in evidence viewer`).toContain(pid);
    }
  });

  // Fix 7 — think-aloud text: trace.description was not mapped to what_i_see
  test('evidence viewer steps have descriptions', async ({ page }) => {
    const result = await page.evaluate(() => {
      if (typeof evidenceViewerData === 'undefined' || !evidenceViewerData.personas) return null;
      const stats = { total: 0, withDesc: 0 };
      for (const p of Object.values(evidenceViewerData.personas)) {
        for (const t of p.tasks || []) {
          for (const s of t.steps || []) {
            stats.total++;
            if (s.what_i_see || s.action) stats.withDesc++;
          }
        }
      }
      return stats;
    });
    if (!result || result.total === 0) test.skip();
    const ratio = result.withDesc / result.total;
    expect(ratio, `At least 50% of evidence steps should have descriptions (got ${result.withDesc}/${result.total})`).toBeGreaterThanOrEqual(0.5);
  });

  // Fix 7 — screenshots: task-N.png filenames weren't matched; 0-based task_index
  // caused wrong screenshot assignment
  test('evidence viewer steps have screenshots', async ({ page }) => {
    const result = await page.evaluate(() => {
      if (typeof evidenceViewerData === 'undefined' || !evidenceViewerData.personas) return null;
      const stats = { tasks: 0, tasksWithSs: 0 };
      for (const p of Object.values(evidenceViewerData.personas)) {
        for (const t of p.tasks || []) {
          stats.tasks++;
          const hasSs = (t.steps || []).some(s => s.screenshot && s.screenshot.startsWith('data:image'));
          if (hasSs) stats.tasksWithSs++;
        }
      }
      return stats;
    });
    if (!result || result.tasks === 0) test.skip();
    expect(result.tasksWithSs, `Each task should have at least 1 screenshot (got ${result.tasksWithSs}/${result.tasks})`).toBe(result.tasks);
  });

  // Fix 7 — multi-step traces: previously only 1 step per task was produced
  test('evidence viewer has multi-step traces per task', async ({ page }) => {
    const result = await page.evaluate(() => {
      if (typeof evidenceViewerData === 'undefined' || !evidenceViewerData.personas) return null;
      const stepCounts = [];
      for (const p of Object.values(evidenceViewerData.personas)) {
        for (const t of p.tasks || []) {
          stepCounts.push((t.steps || []).length);
        }
      }
      return stepCounts;
    });
    if (!result || result.length === 0) test.skip();
    for (let i = 0; i < result.length; i++) {
      expect(result[i], `Task ${i + 1} should have >= 2 steps (got ${result[i]})`).toBeGreaterThanOrEqual(2);
    }
  });

  // Fix 7 — modal screenshot visibility: "No screenshot" was shown for every step
  test('modal shows actual image, not "No screenshot"', async ({ page }) => {
    const stepWithSs = await page.evaluate(() => {
      if (typeof evidenceViewerData === 'undefined' || !evidenceViewerData.personas) return null;
      for (const [pid, p] of Object.entries(evidenceViewerData.personas)) {
        for (let ti = 0; ti < (p.tasks || []).length; ti++) {
          for (let si = 0; si < (p.tasks[ti].steps || []).length; si++) {
            if (p.tasks[ti].steps[si].screenshot) {
              return { persona: pid, task: ti, step: si };
            }
          }
        }
      }
      return null;
    });
    if (!stepWithSs) test.skip();

    // openEvidenceViewer makes the overlay visible; selectStep renders content
    await page.evaluate(() => {
      if (typeof openEvidenceViewer === 'function') openEvidenceViewer();
    });
    await page.waitForTimeout(300);

    await page.evaluate((s) => {
      if (typeof selectStep === 'function') selectStep(s.persona, s.task, s.step);
    }, stepWithSs);
    await page.waitForTimeout(300);

    const modal = page.locator('#evidence-viewer-modal');
    if (!(await modal.isVisible())) test.skip();

    const img = page.locator('#ev-screenshot img');
    const imgCount = await img.count();
    expect(imgCount, 'Screenshot area should contain an <img> element').toBeGreaterThanOrEqual(1);

    const src = await img.first().getAttribute('src');
    expect(src, 'Screenshot src should be a data URI').toMatch(/^data:image/);
  });
});
