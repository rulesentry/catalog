#!/usr/bin/env node
// v5-lint.mjs — validate catalog entries against the TIGHTENED v5 rules and report
// migration impact. Zero deps. Ported from the docs/v5-2 prototype per the v5
// Decision Record (docs/v5/v5.md), with D5 (structured references[]) applied.
//
//   node v5-lint.mjs <catalog-dir> [--lint-only]
//
// Two layers of output:
//   1. VIOLATIONS — entries failing the tightened rules (unknown fields, bad enums,
//      missing required description, etc.). These block v5 adoption. Run against the
//      UNMIGRATED catalog, this list is the migration checklist and regression
//      baseline (v5.md D7).
//   2. MIGRATION LINT — aggregate report: files carrying `metadata` (with key
//      frequency), `updated_at`, `needs_review` true/false split, null descriptions.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ---- canonical patterns (schemas/common/base.schema.json) ----
const SIMPLE = /^[a-z0-9][a-z0-9_-]*$/;
const DOTTED = /^[a-z0-9][a-z0-9_.-]*$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9a-zA-Z.-]+)?(?:\+[0-9a-zA-Z.-]+)?$/;
const STATUS = new Set(['draft', 'active', 'inactive', 'deprecated', 'archived']);
const SEVERITY = new Set(['info', 'low', 'medium', 'high', 'critical']);
const EFFECT_TYPES = new Set(['transform', 'info']);
const TRANSFORM_TYPES = new Set(['mask', 'hash', 'replace', 'redact', 'tokenize']);
const HASH_ALGOS = new Set(['sha256', 'sha512', 'blake3']);
const RATIONALE = new Set(['compliance', 'verification', 'inference', 'safety']);
const RULE_KEYS = new Set([
  '$schema', 'id', 'qualified_id', 'publisher_id', 'type', 'version', 'status', 'tags',
  'references', 'origin', 'created_at', 'created_by', 'modified_at', 'modified_by',
  'name', 'summary', 'description', 'category_id', 'severity', 'profiles', 'regions',
  'evaluation',
]);
// keys that exist today but are REMOVED/RENAMED in v5 — lint, don't hard-fail twice
const MIGRATION_KEYS = new Set(['metadata', 'updated_at', '_runtime', 'rule_kind']);

function checkReferences(refs, errs) {
  // v5.md D5: references[] is STRUCTURED — { url?, note? }, at least one present.
  if (refs == null) return;
  if (!Array.isArray(refs)) { errs.push('references must be an array'); return; }
  refs.forEach((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      errs.push(`references[${i}]: must be object {url?, note?} (D5 — structured, not flat strings)`);
      return;
    }
    const keys = Object.keys(r);
    for (const k of keys) if (k !== 'url' && k !== 'note') errs.push(`references[${i}]: unknown key '${k}'`);
    if (r.url == null && r.note == null) errs.push(`references[${i}]: at least one of url|note required`);
  });
}

function checkEffect(eff, path, errs) {
  if (!eff || typeof eff !== 'object') { errs.push(`${path}: effect must be object`); return; }
  if (!EFFECT_TYPES.has(eff.type)) errs.push(`${path}.type '${eff.type}': not transform|info`);
  if (eff.rationale != null && !RATIONALE.has(eff.rationale)) errs.push(`${path}.rationale '${eff.rationale}': not in canonical enum`);
  for (const k of Object.keys(eff)) if (!['type', 'rationale', 'message', 'transform'].includes(k)) errs.push(`${path}: unknown key '${k}'`);
  if (eff.type === 'transform') {
    if (!eff.transform) { errs.push(`${path}: transform required`); return; }
    if (!TRANSFORM_TYPES.has(eff.transform.type)) errs.push(`${path}.transform.type '${eff.transform.type}': invalid`);
    const p = eff.transform.params ?? {};
    if (eff.transform.type === 'hash') {
      if (p.algorithm != null && !HASH_ALGOS.has(p.algorithm)) errs.push(`${path}: hash algorithm '${p.algorithm}' invalid`);
      if (p.truncate != null && (p.truncate < 8 || p.truncate > 64)) errs.push(`${path}: truncate ${p.truncate} out of 8..64`);
    }
    if (eff.transform.type === 'replace' && p.replacement == null) errs.push(`${path}: replace needs params.replacement`);
  } else if ('transform' in eff) errs.push(`${path}: transform present on non-transform effect`);
}

function checkEval(ev, path, errs) {
  const et = ev?.evaluation_type;
  const KNOWN = ['pattern_match', 'list_membership', 'metadata_check', 'ner_match', 'composite', 'rule_ref'];
  if (!KNOWN.includes(et)) { errs.push(`${path}: evaluation_type '${et}' invalid`); return; }
  if ('priority' in ev && et !== 'pattern_match') errs.push(`${path}: priority only on pattern_match`);
  if (et === 'composite') {
    if (!['all', 'any', 'not'].includes(ev.operator)) errs.push(`${path}: bad operator '${ev.operator}'`);
    const kids = ev.evaluations ?? [];
    if (!kids.length) errs.push(`${path}: empty evaluations`);
    if (ev.operator === 'not' && kids.length !== 1) errs.push(`${path}: 'not' needs exactly 1 sub-eval`);
    checkEffect(ev.effect, `${path}.effect`, errs);
    kids.forEach((c, i) => checkEval(c, `${path}.evaluations[${i}]`, errs));
    return;
  }
  if (et === 'rule_ref') {
    if (!DOTTED.test(ev.rule_id ?? '')) errs.push(`${path}.rule_id invalid`);
    if (!SEMVER.test(ev.pinned_version ?? '')) errs.push(`${path}.pinned_version invalid`);
    if ('effect' in ev) errs.push(`${path}: rule_ref must not carry effect`);
    return;
  }
  if (et === 'pattern_match') {
    const p = ev.pattern ?? {};
    const hasP = !!p.pattern, hasId = !!p.pattern_id;
    if (hasP === hasId) errs.push(`${path}.pattern: exactly one of pattern|pattern_id`);
  }
  if (et === 'list_membership') {
    const l = ev.list ?? {};
    if (!!(l.values?.length) === !!l.list_id) errs.push(`${path}.list: exactly one of values|list_id`);
  }
  checkEffect(ev.effect, `${path}.effect`, errs);
}

function validateRule(r, file, lint) {
  const errs = [];
  // v5 tightening: unknown fields rejected (minus migration keys, lint-tracked)
  for (const k of Object.keys(r)) {
    if (MIGRATION_KEYS.has(k)) continue; // reported in lint below
    if (!RULE_KEYS.has(k)) errs.push(`unknown field '${k}' (v5 rejects — unevaluatedProperties:false)`);
  }
  if (!DOTTED.test(r.id ?? '')) errs.push(`id '${r.id}' invalid DottedId`);
  if (!SEMVER.test(r.version ?? '')) errs.push(`version '${r.version}' invalid`);
  if (!r.name) errs.push('name missing');
  if (typeof r.description !== 'string' || !r.description) {
    errs.push('description missing/null (v5 requires non-empty string)');
    if (r.description === null) lint.nullDescription.push(file);
  }
  if (!SIMPLE.test(r.category_id ?? '')) errs.push(`category_id '${r.category_id}' invalid SimpleId`);
  if (r.severity != null && !SEVERITY.has(r.severity)) errs.push(`severity '${r.severity}' invalid`);
  if (r.status != null && !STATUS.has(r.status)) errs.push(`status '${r.status}' invalid`);
  checkReferences(r.references, errs);
  if (!r.evaluation) errs.push('evaluation missing');
  else checkEval(r.evaluation, 'evaluation', errs);
  // migration lint
  if (r.metadata && typeof r.metadata === 'object') {
    lint.metadataFiles.push(file);
    for (const k of Object.keys(r.metadata)) lint.metadataKeyFreq[k] = (lint.metadataKeyFreq[k] ?? 0) + 1;
    if (r.metadata.needs_review === true) lint.needsReviewTrue.push(file);
    else if (r.metadata.needs_review === false) lint.needsReviewFalse.push(file);
  }
  if ('updated_at' in r) lint.updatedAtFiles.push(file);
  if ('_runtime' in r) lint.runtimeFiles.push(file);
  if ('rule_kind' in r) lint.ruleKindFiles.push(file);
  if (!r.publisher_id) lint.missingPublisher.push(file);
  return errs;
}

// ---- walk + report ----
function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (e.endsWith('.json')) yield p;
  }
}

const root = process.argv[2];
const lintOnly = process.argv.includes('--lint-only');
if (!root) { console.error('usage: node v5-lint.mjs <catalog-dir> [--lint-only]'); process.exit(2); }

const lint = {
  metadataFiles: [], metadataKeyFreq: {}, updatedAtFiles: [], runtimeFiles: [],
  ruleKindFiles: [], nullDescription: [], missingPublisher: [],
  needsReviewTrue: [], needsReviewFalse: [],
};
let total = 0, rules = 0, failed = 0, skipped = 0;

for (const file of walk(root)) {
  total++;
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch { console.log(`✗ ${file}: invalid JSON`); failed++; continue; }
  if (doc.type !== 'rule') { skipped++; continue; } // rule validation first; other types later
  rules++;
  const errs = validateRule(doc, file, lint);
  if (errs.length && !lintOnly) {
    failed++;
    console.log(`✗ ${file}`);
    errs.forEach((e) => console.log(`    - ${e}`));
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`${total} JSON files scanned, ${rules} rules validated, ${skipped} non-rule entities skipped, ${failed} failing under v5 tightening.`);
console.log(`\n=== MIGRATION LINT ===`);
console.log(`metadata present:        ${lint.metadataFiles.length} rule(s)`);
if (Object.keys(lint.metadataKeyFreq).length) {
  console.log('  metadata key frequency (drives the what-replaces-metadata decision):');
  for (const [k, n] of Object.entries(lint.metadataKeyFreq).sort((a, b) => b[1] - a[1]))
    console.log(`    ${String(n).padStart(4)}  ${k}`);
}
console.log(`updated_at (→modified_at): ${lint.updatedAtFiles.length}`);
console.log(`_runtime persisted:        ${lint.runtimeFiles.length}`);
console.log(`rule_kind (deprecated):    ${lint.ruleKindFiles.length}`);
console.log(`needs_review true (D3 → review-queue): ${lint.needsReviewTrue.length}`);
lint.needsReviewTrue.forEach((f) => console.log(`    ${f}`));
console.log(`needs_review false (D3 → drop):        ${lint.needsReviewFalse.length}`);
console.log(`null description:          ${lint.nullDescription.length}`);
console.log(`missing publisher_id:      ${lint.missingPublisher.length}`);
process.exit(failed ? 1 : 0);
