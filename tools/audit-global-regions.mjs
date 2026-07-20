#!/usr/bin/env node
/**
 * audit-global-regions.mjs — jurisdiction-v2 J4c (report only, no mutations).
 *
 * Doctrine (v5.md D16): GLOBAL is for structure-universal formats (email, IP,
 * credit-card, MAC, URL). A rule tagged `["GLOBAL"]` whose id/name/description,
 * validator, or references betray a specific jurisdiction is SUSPECT — it
 * likely wants a narrower region (narrow-as-truthful).
 *
 * This scans every GLOBAL-only rule in catalog/catalog/rules/ and flags the
 * suspects with the evidence found. It NEVER rewrites a rule — re-scoping is a
 * human call (some GLOBAL tags are correct; e.g. an "IPv6 address" rule
 * mentioning no country is genuinely global). Output is a markdown table
 * written to docs/dev/global-region-audit.md.
 *
 * Usage:  node catalog/tools/audit-global-regions.mjs
 *         node catalog/tools/audit-global-regions.mjs --stdout   (print, no write)
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RULES_DIR = join(REPO, "catalog", "catalog", "rules");
const OUT = join(REPO, "docs", "dev", "global-region-audit.md");

// ── Heuristics ───────────────────────────────────────────────────────────────

// Country / nationality tokens → the region they most likely imply. Word-
// boundary matched, case-insensitive, against id + name + description.
//
// DELIBERATELY EXCLUDED as signals: GDPR, CCPA, VAT, IBAN, SEPA, RFC. Those are
// compliance FRAMEWORKS or format SPECS that legitimately co-occur with a
// GLOBAL rule (an IPv4 rule may cite GDPR; "RFC" means RFC-5322, not Mexico's
// tax id). A framework mention is a `profiles` concern, not a jurisdiction — so
// matching them produced only false positives. We flag only tokens that mean
// the DETECTED DATA is nation-defined (a national ID name, a country name, a
// national scheme).
const COUNTRY_TOKENS = [
  [/\b(social security number|\bssn\b|\bitin\b|\bein\b|routing number|medicaid|\bnpi\b)\b/i, "US"],
  [/\b(california bar|ccpa consumer|cpra)\b/i, "US-CA"],
  [/\b(canadian|social insurance number|\bpipeda\b)\b/i, "CA"],
  [/\b(national insurance number|\bnino\b|\bnhs number\b|uk sort code)\b/i, "UK"],
  [/\b(german(y)?|steuer)\b/i, "DE"],
  [/\b(france|french|\binsee\b)\b/i, "FR"],
  [/\b(spanish|spain|\bdni\b|\bnie\b)\b/i, "ES"],
  [/\b(ital(y|ian)|codice fiscale)\b/i, "IT"],
  [/\b(netherlands|dutch|\bbsn\b)\b/i, "NL"],
  [/\b(brazil(ian)?|\bcpf\b|\bcnpj\b)\b/i, "BR"],
  [/\b(mexico|mexican|\bcurp\b)\b/i, "MX"],
  [/\b(india(n)?|aadhaar|\bgstin\b|\bifsc\b|indian pan)\b/i, "IN"],
  [/\b(singapore(an)?|\bnric\b|singapore uen)\b/i, "SG"],
  [/\b(japan(ese)?|my ?number)\b/i, "JP"],
  [/\b(china|chinese|resident identity)\b/i, "CN"],
  [/\b(south korea(n)?|\brrn\b)\b/i, "KR"],
  [/\b(taiwan(ese)?)\b/i, "TW"],
  [/\b(hong kong|\bhkid\b)\b/i, "HK"],
  [/\b(thai(land)?)\b/i, "TH"],
  [/\b(australia(n)?|\btfn\b|\babn\b|\bacn\b)\b/i, "AU"],
  [/\b(new zealand)\b/i, "NZ"],
  [/\b(turk(ey|ish)|kimlik)\b/i, "TR"],
  [/\b(israel(i)?)\b/i, "IL"],
];

// ccTLD references in the description (e.g. ".de", ".co.uk") → country.
const CCTLD = [
  [/\.us\b/i, "US"], [/\.ca\b/i, "CA"], [/\.co\.uk\b|\.uk\b/i, "UK"],
  [/\.de\b/i, "DE"], [/\.fr\b/i, "FR"], [/\.jp\b/i, "JP"], [/\.cn\b/i, "CN"],
  [/\.in\b/i, "IN"], [/\.br\b/i, "BR"], [/\.au\b/i, "AU"],
];

// Validator names that are inherently country-specific.
const VALIDATOR_COUNTRY = {
  aadhaar_verhoeff: "IN",
  cpf_checksum: "BR",
  cnpj_checksum: "BR",
  curp_checksum: "MX",
  codice_fiscale_checksum: "IT",
  french_nir_insee: "FR",
  hkid_checksum: "HK",
  taiwan_nid_checksum: "TW",
  tc_kimlik_checksum: "TR",
  nino_prefix: "UK",
  ein_prefix: "US",
  ssn_format: "US",
};

// ── Collect ──────────────────────────────────────────────────────────────────

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

function collectValidatorNames(evaluation) {
  const names = new Set();
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.validators)) {
      for (const v of node.validators) if (v?.name) names.add(v.name);
    }
    for (const k of ["all", "any", "not"]) {
      if (Array.isArray(node[k])) node[k].forEach(visit);
    }
  };
  visit(evaluation);
  return [...names];
}

function auditRule(rule) {
  const hay = `${rule.id} ${rule.name ?? ""} ${rule.description ?? ""}`;
  const evidence = [];
  const suspected = new Set();

  for (const [re, code] of COUNTRY_TOKENS) {
    const m = hay.match(re);
    if (m) { evidence.push(`token "${m[0].trim()}"`); suspected.add(code); }
  }
  for (const [re, code] of CCTLD) {
    const m = (rule.description ?? "").match(re);
    if (m) { evidence.push(`ccTLD ${m[0]}`); suspected.add(code); }
  }
  for (const v of collectValidatorNames(rule.evaluation)) {
    if (VALIDATOR_COUNTRY[v]) {
      evidence.push(`validator ${v}`);
      suspected.add(VALIDATOR_COUNTRY[v]);
    }
  }
  return { evidence, suspected: [...suspected] };
}

// ── Run ────────────────────────────────────────────────────────────────────

const files = walk(RULES_DIR);
const globalRules = [];
for (const f of files) {
  let r;
  try { r = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
  if (!r.id) continue;
  const regions = r.regions ?? ["GLOBAL"];
  if (regions.length === 1 && regions[0] === "GLOBAL") globalRules.push(r);
}
globalRules.sort((a, b) => a.id.localeCompare(b.id));

const suspects = [];
for (const r of globalRules) {
  const { evidence, suspected } = auditRule(r);
  if (evidence.length > 0) {
    suspects.push({ id: r.id, name: r.name ?? "", suspected, evidence });
  }
}

const now = new Date().toISOString().slice(0, 10);
const lines = [];
lines.push("# GLOBAL region audit (jurisdiction-v2 J4c)");
lines.push("");
lines.push("> **Auto-generated report** — run `node catalog/tools/audit-global-regions.mjs`.");
lines.push("> REPORT ONLY: nothing is re-scoped automatically. Each suspect is a");
lines.push("> human judgement call (some GLOBAL tags are correct).");
lines.push(`> Last generated: ${now}`);
lines.push("");
lines.push(
  "Doctrine (v5.md D16): `GLOBAL` is for structure-universal formats (email, IP, " +
    "credit card, MAC, URL). A `[\"GLOBAL\"]` rule whose id/name/description, " +
    "validator, or references betray a specific jurisdiction is a candidate for " +
    "narrowing (narrow-as-truthful). This scans the " +
    `${globalRules.length} GLOBAL-only rules and flags ${suspects.length} suspects.`,
);
lines.push("");
lines.push("| rule_id | current | suspected | evidence |");
lines.push("|---------|---------|-----------|----------|");
for (const s of suspects) {
  lines.push(
    `| \`${s.id}\` | GLOBAL | ${s.suspected.join(", ") || "—"} | ${s.evidence.join("; ")} |`,
  );
}
lines.push("");
lines.push(
  `_${globalRules.length} GLOBAL-only rules scanned; ` +
    `${globalRules.length - suspects.length} showed no jurisdiction signal (likely correctly GLOBAL)._`,
);
lines.push("");

const report = lines.join("\n");
if (process.argv.includes("--stdout")) {
  process.stdout.write(report);
} else {
  writeFileSync(OUT, report);
  console.log(`Wrote ${OUT} — ${suspects.length} suspects of ${globalRules.length} GLOBAL rules.`);
}
