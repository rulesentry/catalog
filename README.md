# RuleSentry Community Contributors

Community-contributed rules, policies, categories, profiles, and regions for [RuleSentry](https://rulesentry.io) — the rule evaluation engine for detecting sensitive data patterns, enforcing compliance policies, and applying transforms.

## Getting Started

1. **Fork** this repository
2. **Clone** your fork locally
3. **Install** dependencies: `npm install`
4. **Create** your rule, policy, or other entity (see below)
5. **Validate** locally: `npm run ci`
6. **Open a PR** to `main`

GitHub Actions will automatically validate your contribution on every PR. On merge, changed entities are imported into the RuleSentry catalog.

## Directory Structure

```
contributors/
├── publishers/               # Registered publisher identities
│   ├── rulesentry.json       # Core publisher
│   └── mycos.json            # Community publisher
├── rules/
│   ├── core/                 # RuleSentry-authored rules (~153)
│   │   ├── contact/          # Category subdirectory
│   │   ├── financial/
│   │   ├── government/
│   │   └── ...
│   └── mycos/                # Community publisher
│       └── contact/
│           └── th-phone-number.json
├── policies/
│   ├── core/                 # Core policies (11)
│   └── {publisher}/          # Community policies
├── categories/
│   ├── core/                 # Core categories (8)
│   └── {publisher}/
├── profiles/
│   ├── core/                 # Core profiles (8)
│   └── {publisher}/
├── regions/
│   └── core/                 # Region registry
├── examples/                 # Example contributions (not imported)
├── scripts/                  # Validation and import scripts
├── json-schema/              # Vendored RuleSentry schemas (do not modify)
└── .github/workflows/        # CI: validate on PR, import on merge
```

**Key conventions:**
- `core/` is reserved for RuleSentry-authored entities. Uses `qualified_id: "core.{id}"`.
- Other directories are community publishers. The directory name must match a registered publisher in `publishers/{name}.json`. Uses `qualified_id: "community.{publisher}.{category}.{name}"`.
- Category subdirectories are optional — uncategorized entities sit directly under the publisher directory.

## Contributing a Rule

1. **Register as a publisher** (if first contribution):

   Create `publishers/{your-id}.json`:
   ```json
   {
     "id": "your-id",
     "name": "Your Name or Org",
     "url": "https://your-site.com",
     "contact": "you@example.com",
     "description": "Brief description of your contributions"
   }
   ```

2. **Create your rule** in `rules/{your-id}/{category}/`:

   ```json
   {
     "$schema": "../../../json-schema/rule.schema.json",
     "id": "{category}.{rule-name}",
     "qualified_id": "community.{your-id}.{category}.{rule-name}",
     "type": "rule",
     "version": "1.0.0",
     "name": "Human-Readable Name",
     "description": "What this rule detects and why.",
     "category_id": "{category}",
     "rule_kind": "atomic",
     "severity": "medium",
     "evaluation": {
       "evaluation_type": "pattern_match",
       "target": "content",
       "pattern": {
         "pattern": "your-regex-here",
         "engine": "regex"
       },
       "effect": {
         "type": "transform",
         "transform": { "type": "redact", "params": {} },
         "message": "Description of the action taken"
       }
     },
     "status": "active",
     "regions": ["GLOBAL"],
     "origin": {
       "source_type": "local",
       "publisher": "{your-id}",
       "author": "Your Name"
     },
     "created_at": "2026-01-01T00:00:00Z",
     "updated_at": "2026-01-01T00:00:00Z"
   }
   ```

3. **Validate**: `npm run ci`
4. **Open a PR**

See `examples/rules/contact/mx-phone-number.json` for a complete example.

## Contributing a Policy

Policies assemble rules via direct references, category inclusion, and filters. Your policy can reference:

- **Your own rules** — by their bare `id` (e.g., `contact.mx-phone-number`)
- **Core rules** — built-in RuleSentry rules (e.g., `government.ssn_format`)

Create your policy in `policies/{your-id}/` and follow the same `community.{your-id}.*` ID convention.

See `examples/policies/mx-pii-policy.json` for a complete example.

## ID Conventions

| Prefix | Usage | Directory |
|--------|-------|-----------|
| `core.*` | RuleSentry-authored entities | `{entity-type}/core/` |
| `community.{publisher}.*` | Community contributions | `{entity-type}/{publisher}/` |

- The publisher directory name must match the publisher ID in the `qualified_id`
- Community publishers must be registered in `publishers/{id}.json`
- File path should reflect the ID: `rules/{publisher}/{category}/{rule-name}.json`

## Validation

Two validation scripts run in CI:

- **`npm run validate`** — JSON Schema validation against vendored RuleSentry schemas
- **`npm run check`** — Convention checks (ID namespacing, publisher registration, directory sync)
- **`npm run ci`** — Runs both

Run locally before opening a PR:

```bash
npm install
npm run ci
```

## Catalog Import

When a PR is merged to `main`, the **import-catalog** workflow automatically detects changed entity files and imports them into the RuleSentry catalog API. Entities then appear in the desktop app's Store tab.

For initial seeding, use the bulk import script:

```bash
IMPORT_API_KEY=<key> API_URL=https://api.rulesentry.io ./scripts/import-all.sh
```

## Schema Reference

The `json-schema/` directory contains the canonical RuleSentry schemas. These are vendored from the main repository and should not be modified. Key schemas:

| Schema | Validates |
|--------|-----------|
| `rule.schema.json` | Rule definitions |
| `policy.schema.json` | Policy definitions |
| `category.schema.json` | Category definitions |
| `profile.schema.json` | Profile definitions |
| `region.schema.json` | Region definitions |
| `base.schema.json` | Shared base types (Origin, ID patterns) |
| `rule-evaluation.schema.json` | Evaluation types, effects, transforms |

Full schema documentation: [rulesentry.io/docs/schemas](https://rulesentry.io/docs/schemas)

## License

MIT — see [LICENSE](LICENSE).
