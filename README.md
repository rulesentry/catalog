# RuleSentry Community Contributors

Community-contributed rules, policies, categories, profiles, and regions for [RuleSentry](https://rulesentry.io) — the rule evaluation engine for detecting sensitive data patterns, enforcing compliance policies, and applying transforms.

## Identity Principle

> **File path is storage layout, not canonical identity. Canonical identity is defined by the explicit metadata fields `id`, `qualified_id`, `publisher_id`, and `version` inside the JSON file.**

You can reorganize the directory tree without changing the meaning of any entity, as long as the identity fields inside the JSON remain unchanged.

## Getting Started

1. **Fork** this repository
2. **Clone** your fork locally
3. **Create** your rule, policy, or other entity (see below)
4. **Open a PR** to `main`

## Directory Structure

```
contributors/
├── publishers/               # Registered publisher identities
│   ├── rulesentry.json       # RuleSentry publisher
│   └── mycos.json            # Example community publisher
├── rules/
│   ├── core/                 # RuleSentry-authored rules (~153)
│   │   ├── contact/          # Category subdirectory
│   │   ├── financial/
│   │   ├── government/
│   │   └── ...
│   └── {publisher}/          # Community publisher rules
│       └── {category}/
├── policies/
│   ├── core/                 # RuleSentry policies (11)
│   └── {publisher}/          # Community policies
├── categories/
│   ├── core/                 # Core categories (8)
│   └── {publisher}/
├── profiles/
│   ├── core/                 # Core profiles (8)
│   └── {publisher}/
├── regions/
│   └── core/                 # Region registry
└── LICENSE
```

**Directory conventions:**
- `core/` holds RuleSentry-authored entities (`publisher_id: "rulesentry"`).
- Other directories hold community publisher entities. The directory name should match the publisher's registered `id`.
- Category subdirectories are optional — uncategorized entities sit directly under the publisher directory.
- The directory layout is storage organization only. Identity comes from the JSON fields.

## ID Conventions

**`qualified_id` format: `{publisher_id}.{category_id}.{name}`**

| Publisher | Example `qualified_id` | Example `publisher_id` |
|-----------|------------------------|------------------------|
| RuleSentry | `rulesentry.government.ssn_format` | `rulesentry` |
| Community | `mycos.contact.th_phone_number` | `mycos` |

Rules:
- `publisher_id` must match a registered entry in `publishers/{id}.json`.
- `qualified_id` must start with the publisher's `id` prefix.
- `id` is a local dotted identifier (e.g., `government.ssn_format`) — stable across reorganizations.
- `version` is a semver string (`MAJOR.MINOR.PATCH`).
- All four fields together define canonical identity. **File path is not part of identity.**

> **Note:** `publisher_id` is currently defined on `rule` entities. Policy, profile, and category entities are expected to follow the same convention in a future schema version.

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
     "$schema": "https://schemas.rulesentry.io/schema/v4/catalog/rule.schema.json",
     "id": "{category}.{rule-name}",
     "qualified_id": "{your-id}.{category}.{rule-name}",
     "publisher_id": "{your-id}",
     "type": "rule",
     "version": "1.0.0",
     "name": "Human-Readable Name",
     "description": "What this rule detects and why.",
     "category_id": "{category}",
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
       "source_type": "catalog",
       "publisher": "{your-id}",
       "author": "Your Name"
     },
     "created_at": "2026-01-01T00:00:00Z",
     "modified_at": "2026-01-01T00:00:00Z"
   }
   ```

3. **Open a PR**

## Contributing a Policy

Policies assemble rules via direct references, category inclusion, and filters. Your policy can reference:

- **Your own rules** — by their bare `id` (e.g., `contact.th-phone-number`)
- **Core rules** — built-in RuleSentry rules (e.g., `government.ssn_format`)

Create your policy in `policies/{your-id}/` with `publisher_id: "{your-id}"` and `qualified_id: "{your-id}.policy.{name}"`.

## Schema Reference

For the canonical JSON schemas that define rule, policy, category, profile, and region formats, see the `schemas/` directory in the [main RuleSentry repository](https://github.com/rulesentry/rulesentry).

Full schema documentation: [rulesentry.io/docs/schemas](https://rulesentry.io/docs/schemas)

## License

MIT — see [LICENSE](LICENSE).
