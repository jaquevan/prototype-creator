#!/usr/bin/env node
/**
 * validate-phase-b-output.js
 * 
 * INLINE VALIDATOR — runs after eval-discover (Phase B) completes and BEFORE
 * render-report.js. Catches schema mismatches that would cause the report to
 * render blank usability sections.
 * 
 * Three failure modes this prevents:
 *   1. Flat-dict usability_dimensions (must be nested with dimensions[])
 *   2. Missing persona_overlays (must be array with patience data)
 *   3. Missing overall_score (must be a number, not null)
 * 
 * If any check fails, it FIXES the data in-place (reads persona-results.json
 * to reconstruct the correct format) and prints a warning.
 * 
 * Usage: node validate-phase-b-output.js <artifacts-dir>
 * Exit: 0 always (self-healing — fixes issues and continues)
 */

const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');

const artifactsDir = process.argv[2];
if (!artifactsDir) {
  console.error('Usage: node validate-phase-b-output.js <artifacts-dir>');
  process.exit(1);
}

const journeyLogPath = join(artifactsDir, 'journey-log.json');
const personaResultsPath = join(artifactsDir, 'persona-results.json');

if (!existsSync(journeyLogPath)) {
  console.log('  ⚠ journey-log.json not found — skipping Phase B validation');
  process.exit(0);
}

const journeyLog = JSON.parse(readFileSync(journeyLogPath, 'utf8'));
const ud = journeyLog.usability_dimensions;

if (!ud) {
  console.log('  ⚠ No usability_dimensions in journey-log.json — Phase B may not have run');
  process.exit(0);
}

let needsFix = false;
const issues = [];

// Check 1: Is it a flat dict instead of nested schema?
const KNOWN_DIM_IDS = [
  'workflow_continuity', 'cross_persona_context', 'scalability_progressive_complexity',
  'system_status_observability', 'technical_abstraction', 'mental_model_fidelity',
  'accessibility_inclusion'
];
const isFlatDict = KNOWN_DIM_IDS.some(id => ud[id] !== undefined && !ud.dimensions);

if (isFlatDict) {
  issues.push('usability_dimensions is a flat dict — converting to nested schema');
  needsFix = true;
}

// Check 2: Missing dimensions array
if (!isFlatDict && (!Array.isArray(ud.dimensions) || ud.dimensions.length === 0)) {
  issues.push('usability_dimensions.dimensions is missing or empty');
  needsFix = true;
}

// Check 3: Missing overall_score
if (typeof ud.overall_score !== 'number') {
  issues.push(`overall_score is ${typeof ud.overall_score}, expected number`);
  needsFix = true;
}

// Check 4: Missing persona_overlays
if (!Array.isArray(ud.persona_overlays) || ud.persona_overlays.length === 0) {
  issues.push('persona_overlays is missing or empty');
  needsFix = true;
}

// Check 5: persona_selection missing full reasoning (Step 3b.1)
const ps = journeyLog.persona_selection;
if (!ps || !ps.method || !ps.target_audience_source || !Array.isArray(ps.considered_but_rejected)) {
  issues.push('persona_selection missing full reasoning (method, target_audience_source, or considered_but_rejected)');
  // Not self-healable without extract-state context — just warn
  console.log('  ⚠ persona_selection incomplete — see SKILL.md Step 3b.1 for required fields');
  console.log('    Required: method, target_audience_text, target_audience_source, reasoning, selected, considered_but_rejected');
}

if (!needsFix) {
  console.log('  ✓ Phase B output schema valid');
  process.exit(0);
}

// ═══════════════════ SELF-HEALING ═══════════════════

console.log(`  ⚠ Phase B schema issues detected (${issues.length}):`);
issues.forEach(i => console.log(`    - ${i}`));
console.log('  → Attempting self-heal from persona-results.json...');

const DIMENSION_NAMES = {
  'workflow_continuity': 'Workflow Continuity & Integrity',
  'cross_persona_context': 'Cross-Persona Context & Handoffs',
  'scalability_progressive_complexity': 'Scalability & Progressive Complexity',
  'system_status_observability': 'System Status, Observability & Trust',
  'technical_abstraction': 'Technical Abstraction & Signal-to-Noise',
  'mental_model_fidelity': 'Mental Model Fidelity',
  'accessibility_inclusion': 'Accessibility & Inclusion'
};

if (isFlatDict) {
  // Convert flat dict to nested schema
  const dimensions = [];
  let totalScore = 0;

  for (const [dimId, dimName] of Object.entries(DIMENSION_NAMES)) {
    const old = ud[dimId] || {};
    const score = old.score || 0;
    totalScore += score;
    dimensions.push({
      id: dimId,
      name: dimName,
      composite_score: score,
      confidence: old.confidence || 'Medium',
      evidence: old.rationale || old.evidence || '',
      scores: {}
    });
  }

  // Read persona-results for overlays
  let personaOverlays = [];
  let personasEvaluated = [];
  
  if (existsSync(personaResultsPath)) {
    const personaResults = JSON.parse(readFileSync(personaResultsPath, 'utf8'));
    personasEvaluated = [...new Set(personaResults.map(pr => pr.persona_id))];
    personaOverlays = personaResults.map(pr => ({
      persona: pr.persona_id,
      persona_name: pr.persona_name,
      task_index: pr.task_index,
      patience_start: 100,
      patience_end: pr.patience_end || 100,
      abandoned: pr.abandoned || false,
      confusion_events: [],
      cli_escapes: 0
    }));

    // Add per-persona scores to dimensions
    for (const dim of dimensions) {
      for (const pid of personasEvaluated) {
        dim.scores[pid] = { score: dim.composite_score, finding: dim.evidence };
      }
    }
  } else {
    personasEvaluated = ud.personas_evaluated || journeyLog.persona_selection?.selected || [];
  }

  journeyLog.usability_dimensions = {
    overall_score: totalScore,
    personas_evaluated: personasEvaluated,
    dimensions,
    persona_overlays: personaOverlays,
    think_aloud: ud.think_aloud || { traces: [] }
  };

} else {
  // Partial fix: fill in missing fields
  if (typeof ud.overall_score !== 'number' && Array.isArray(ud.dimensions)) {
    ud.overall_score = ud.dimensions.reduce((sum, d) => sum + (d.composite_score || 0), 0);
  }
  if (!Array.isArray(ud.persona_overlays)) {
    ud.persona_overlays = [];
    if (existsSync(personaResultsPath)) {
      const personaResults = JSON.parse(readFileSync(personaResultsPath, 'utf8'));
      ud.persona_overlays = personaResults.map(pr => ({
        persona: pr.persona_id,
        persona_name: pr.persona_name,
        task_index: pr.task_index,
        patience_start: 100,
        patience_end: pr.patience_end || 100,
        abandoned: pr.abandoned || false,
        confusion_events: [],
        cli_escapes: 0
      }));
    }
  }
  if (!Array.isArray(ud.personas_evaluated) || ud.personas_evaluated.length === 0) {
    ud.personas_evaluated = [...new Set((ud.persona_overlays || []).map(o => o.persona))];
  }
}

writeFileSync(journeyLogPath, JSON.stringify(journeyLog, null, 2));
console.log('  ✓ Self-healed — journey-log.json updated with correct schema');
