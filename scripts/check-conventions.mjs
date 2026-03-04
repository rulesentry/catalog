#!/usr/bin/env node
/**
 * Convention checker for RuleSentry contributions.
 *
 * Enforces ID namespacing, publisher registration, directory-publisher sync,
 * dependency rules, and origin metadata beyond what JSON Schema validation covers.
 *
 * Directory convention:
 *   {entity-type}/{publisher-dir}/{optional-category}/{file}.json
 *
 *   - "core/" is reserved for RuleSentry-authored entities (qualified_id starts with "core.")
 *   - Other directories must match a registered publisher in publishers/{name}.json
 *     and use qualified_id starting with "community.{publisher}."
 *
 * Usage:
 *   node scripts/check-conventions.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { resolve, join, relative, sep } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const ENTITY_DIRS = ["rules", "policies", "categories", "profiles", "regions"];
const SCAN_DIRS = [...ENTITY_DIRS, "examples"];
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

/**
 * Extract the publisher directory name from a file path.
 * For entity dirs (rules/, policies/, etc.), the first subdirectory is the publisher.
 * Returns null for examples/ or files directly in the entity root (no publisher dir).
 */
function extractPublisherDir(filePath) {
  const relPath = relative(ROOT, filePath);
  const parts = relPath.split(sep);

  // parts[0] = entity type (rules, policies, etc.)
  // parts[1] = publisher dir (core, mycos, etc.) — if present
  if (parts.length < 3) return null; // file directly in entity root, no publisher dir

  const entityDir = parts[0];
  if (!ENTITY_DIRS.includes(entityDir)) return null;

  return parts[1];
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
function checkEntity(filePath, publishers, isExample) {
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return; // parse errors caught by validate.mjs
  }

  const entityType = data.type;
  if (!entityType) return; // not a typed entity (e.g., region-registry)

  const relPath = relative(ROOT, filePath);
  console.log(`Checking: ${relPath}`);

  const qid = data.qualified_id;
  const publisherDir = extractPublisherDir(filePath);

  if (isExample) {
    // Examples: relaxed checks — just verify qualified_id format if present
    if (qid && !qid.startsWith("core.") && !qid.startsWith("community.")) {
      error(relPath, `qualified_id "${qid}" must start with 'core.' or 'community.'`);
    }
    return;
  }

  // --- Directory-publisher sync ---
  if (publisherDir === "core") {
    // Core entities: qualified_id must start with "core." if present.
    // Some entity types (category, profile) use simple IDs without qualified_id — that's OK.
    if (qid && !qid.startsWith("core.")) {
      error(relPath, `file is in core/ directory but qualified_id "${qid}" does not start with 'core.'`);
      return;
    }
  } else if (publisherDir) {
    // Community entities: must have qualified_id starting with "community.{publisher}."
    if (!qid) {
      error(relPath, "missing qualified_id — required for community contributions");
      return;
    }

    if (!qid.startsWith("community.")) {
      error(relPath, `qualified_id "${qid}" must start with 'community.' for non-core contributions`);
      return;
    }

    const segments = qid.split(".");
    if (segments.length < 3) {
      error(relPath, `qualified_id "${qid}" must have at least 3 segments: community.{publisher-id}.{name}`);
      return;
    }

    const publisherId = segments[1];

    // Directory must match publisher ID in qualified_id
    if (publisherDir !== publisherId) {
      error(relPath, `directory "${publisherDir}" does not match publisher "${publisherId}" in qualified_id`);
    }

    // Publisher must be registered
    if (!publishers.has(publisherId)) {
      error(relPath, `publisher "${publisherId}" not registered — add publishers/${publisherId}.json`);
    }

    // Origin checks for community contributions
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
  }

  // --- Dependency checks (policies only) ---
  if (entityType === "policy") {
    const pubId = publisherDir === "core" ? null : qid?.split(".")[1];
    checkPolicyDependencies(data, pubId, relPath);
  }
}

function checkPolicyDependencies(policy, publisherId, relPath) {
  // Check extends references
  if (policy.extends) {
    for (const ext of Array.isArray(policy.extends) ? policy.extends : [policy.extends]) {
      const extId = typeof ext === "string" ? ext : ext.policy_id;
      if (
        extId &&
        publisherId &&
        !extId.startsWith("core.") &&
        !extId.startsWith(`community.${publisherId}.`)
      ) {
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
  const isExample = dir === "examples";
  for (const file of files) {
    fileCount++;
    checkEntity(file, publishers, isExample);
  }
}

console.log(`\n${fileCount} file(s) checked. ${errors} error(s), ${warnings} warning(s).`);

if (errors > 0) {
  process.exit(1);
}
