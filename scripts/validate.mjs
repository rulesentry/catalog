#!/usr/bin/env node
/**
 * AJV-based multi-schema validator for RuleSentry community contributions.
 *
 * Loads all schemas from ../json-schema/, recursively finds *.json in
 * contribution directories, auto-detects entity type, and validates
 * against the appropriate schema.
 *
 * Usage:
 *   node scripts/validate.mjs                  # validate all contribution dirs
 *   node scripts/validate.mjs rules/contact/    # validate specific directory
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { resolve, join, relative } from "path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = resolve(import.meta.dirname, "..");
const SCHEMA_DIR = join(ROOT, "json-schema");

const SCAN_DIRS = ["rules", "policies", "categories", "profiles", "regions", "examples"];

const SKIP_DIRS = new Set(["publishers", "node_modules", ".git", ".github", "scripts", "json-schema"]);

const TYPE_TO_SCHEMA_ID = {
  rule: "https://schemas.rulesentry.io/schema/v3/core/rule.schema.json",
  policy: "https://schemas.rulesentry.io/schema/v3/core/policy.schema.json",
  category: "https://schemas.rulesentry.io/schema/v3/core/category.schema.json",
  profile: "https://schemas.rulesentry.io/schema/v3/core/profile.schema.json",
  extension: "https://schemas.rulesentry.io/schema/v3/core/extension.schema.json",
};

function loadSchemas() {
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    validateFormats: true,
  });
  addFormats(ajv);

  const schemaFiles = readdirSync(SCHEMA_DIR).filter((f) =>
    f.endsWith(".schema.json")
  );

  for (const file of schemaFiles) {
    const content = JSON.parse(readFileSync(join(SCHEMA_DIR, file), "utf-8"));
    try {
      ajv.addSchema(content);
    } catch (err) {
      if (!err.message?.includes("already exists")) {
        console.error(`Warning: failed to add ${file}: ${err.message}`);
      }
    }
  }

  return ajv;
}

function detectType(data) {
  if (typeof data.type === "string") {
    return data.type;
  }
  if (data.regions && data.version && !data.type) {
    return "__region-registry";
  }
  if (data.code && data.level && data.tier) {
    return "__region";
  }
  return null;
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

function validateFile(ajv, filePath) {
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.error(`  PARSE ERROR: ${err.message}`);
    return false;
  }

  const entityType = detectType(data);
  if (!entityType) {
    console.error(`  SKIP: cannot detect entity type (no "type" field found)`);
    return true;
  }

  const schemaId = TYPE_TO_SCHEMA_ID[entityType];
  if (!schemaId) {
    console.error(`  SKIP: no schema mapped for type="${entityType}"`);
    return true;
  }

  const validate = ajv.getSchema(schemaId);
  if (!validate) {
    console.error(`  ERROR: schema not found for $id ${schemaId}`);
    return false;
  }

  const valid = validate(data);
  if (valid) {
    console.log(`  PASS (type=${entityType})`);
    return true;
  }

  console.error(`  FAIL (type=${entityType}):`);
  for (const err of validate.errors) {
    const path = err.instancePath || "/";
    console.error(`    ${path}: ${err.message}`);
    if (err.params) {
      const details = Object.entries(err.params)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ");
      console.error(`      (${details})`);
    }
  }
  return false;
}

// --- Main ---
const targets = process.argv.slice(2);
const ajv = loadSchemas();
let allPassed = true;
let fileCount = 0;

if (targets.length > 0) {
  // Validate specific files/dirs passed as arguments
  for (const target of targets) {
    const abs = resolve(target);
    const stat = statSync(abs);
    const files = stat.isDirectory() ? findJsonFiles(abs) : [abs];
    for (const file of files) {
      fileCount++;
      console.log(`Validating: ${relative(ROOT, file)}`);
      if (!validateFile(ajv, file)) {
        allPassed = false;
      }
    }
  }
} else {
  // Validate all contribution directories
  for (const dir of SCAN_DIRS) {
    const absDir = join(ROOT, dir);
    const files = findJsonFiles(absDir);
    for (const file of files) {
      fileCount++;
      console.log(`Validating: ${relative(ROOT, file)}`);
      if (!validateFile(ajv, file)) {
        allPassed = false;
      }
    }
  }
}

if (fileCount === 0) {
  console.log("No JSON files found to validate.");
} else {
  console.log(`\n${fileCount} file(s) checked.`);
}

process.exit(allPassed ? 0 : 1);
