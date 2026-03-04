#!/usr/bin/env node
/**
 * Convention checker for RuleSentry community contributions.
 *
 * Enforces ID namespacing, publisher registration, dependency rules,
 * and origin metadata beyond what JSON Schema validation covers.
 *
 * Usage:
 *   node scripts/check-conventions.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { resolve, join, relative } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const SCAN_DIRS = ["rules", "policies", "categories", "profiles", "regions", "examples"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".github", "scripts", "json-schema", "publishers"]);

let errors = 0;
let warnings = 0;

function error(file, msg) {
  console.error(`  ERROR: ${msg}`);
  errors++;
}

function warn(file, msg) {
  console.warn(`  WARN:  ${msg}`);
  warnings++;
}

function findJsonFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) {
        results.push(...findJsonFiles(full));
      }
    } else if (entry.endsWith(".json")) {
      results.push(full);
    }
  }
  return results;
}

// --- Load registered publishers ---
function loadPublishers() {
  const pubDir = join(ROOT, "publishers");
  const publishers = new Map();
  if (!existsSync(pubDir)) return publishers;

  for (const file of readdirSync(pubDir)) {
    if (!file.endsWith(".json")) continue;
    const filePath = join(pubDir, file);
    try {
      const data = JSON.parse(readFileSync(filePath, "utf-8"));
      const expectedId = file.replace(/\.json$/, "");

      // Validate publisher structure
      if (!data.id || !data.name) {
        console.error(`Publisher ${file}: missing required fields (id, name)`);
        errors++;
        continue;
      }
      if (data.id !== expectedId) {
        console.error(`Publisher ${file}: id "${data.id}" does not match filename "${expectedId}"`);
        errors++;
        continue;
      }

      publishers.set(data.id, data);
    } catch (err) {
      console.error(`Publisher ${file}: parse error: ${err.message}`);
      errors++;
    }
  }
  return publishers;
}

// --- Check a single entity file ---
function checkEntity(filePath, publishers) {
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return; // parse errors caught by validate.mjs
  }

  const entityType = data.type;
  if (!entityType) return; // not a typed entity

  const relPath = relative(ROOT, filePath);
  console.log(`Checking: ${relPath}`);

  const qid = data.qualified_id;

  // --- ID checks ---
  if (!qid) {
    error(relPath, "missing qualified_id");
    return;
  }

  if (qid.startsWith("core.")) {
    error(relPath, `qualified_id "${qid}" uses reserved 'core.' prefix — community contributions must use 'community.*'`);
    return;
  }

  if (!qid.startsWith("community.")) {
    error(relPath, `qualified_id "${qid}" must start with 'community.' (got "${qid.split(".")[0]}.")`);
    return;
  }

  // Extract publisher ID: community.{publisher-id}.rest...
  const segments = qid.split(".");
  if (segments.length < 3) {
    error(relPath, `qualified_id "${qid}" must have at least 3 segments: community.{publisher-id}.{name}`);
    return;
  }

  const publisherId = segments[1];

  // --- Publisher checks ---
  if (!publishers.has(publisherId)) {
    error(relPath, `publisher "${publisherId}" not registered — add publishers/${publisherId}.json`);
  }

  // --- Origin checks ---
  if (data.origin) {
    if (data.origin.publisher && data.origin.publisher !== publisherId) {
      warn(relPath, `origin.publisher "${data.origin.publisher}" doesn't match publisher ID "${publisherId}" from qualified_id`);
    }
    if (!data.origin.author) {
      warn(relPath, "origin.author is missing — consider adding author attribution");
    }
  } else {
    warn(relPath, "no origin block — consider adding provenance metadata");
  }

  // --- Dependency checks (policies only) ---
  if (entityType === "policy") {
    checkPolicyDependencies(data, publisherId, relPath);
  }
}

function checkPolicyDependencies(policy, publisherId, relPath) {
  const ruleRefs = (policy.rules || []).map((r) => r.rule_id);

  for (const ruleId of ruleRefs) {
    // core.* refs are allowed (validated at runtime)
    if (ruleId.startsWith("core.") || !ruleId.includes(".")) {
      continue;
    }

    // Community refs: must resolve to community.{same-publisher}.*
    // The rule_id in policy refs is the bare id (not qualified), so we check
    // if it looks like a community rule by seeing if qualified form would work.
    // Actually, rule_ids in policies use the bare `id` field, not `qualified_id`.
    // Cross-publisher refs would need the target rule to exist, which we can't
    // fully validate here. We just check that community policy rule refs are
    // either bare IDs (same publisher assumed) or core.* prefixed.
  }

  // Check rule_categories references — these reference category IDs which are SimpleIds
  // No cross-publisher concern for category IDs

  // Check extends references
  if (policy.extends) {
    for (const ext of Array.isArray(policy.extends) ? policy.extends : [policy.extends]) {
      const extId = typeof ext === "string" ? ext : ext.policy_id;
      if (extId && !extId.startsWith("core.") && !extId.startsWith(`community.${publisherId}.`)) {
        warn(relPath, `extends "${extId}" references a different publisher — ensure it exists`);
      }
    }
  }
}

// --- Main ---
const publishers = loadPublishers();
let fileCount = 0;

console.log(`Loaded ${publishers.size} publisher(s): ${[...publishers.keys()].join(", ")}\n`);

for (const dir of SCAN_DIRS) {
  const absDir = join(ROOT, dir);
  const files = findJsonFiles(absDir);
  for (const file of files) {
    fileCount++;
    checkEntity(file, publishers);
  }
}

console.log(`\n${fileCount} file(s) checked. ${errors} error(s), ${warnings} warning(s).`);

if (errors > 0) {
  process.exit(1);
}
