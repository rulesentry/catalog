# RuleSentry Catalog

Rules, policies, categories, profiles, validators, and regions for [RuleSentry](https://rulesentry.io) — the rule evaluation engine for detecting sensitive data patterns, enforcing compliance policies, and applying transforms.

This repository is the **canonical source of catalog data**. It is:
- Embedded at compile time into RuleSentry's engine, CLI, WASM, and desktop binaries (via the `rulesentry-data` crate)
- Synced at runtime into the public API at `https://api.rulesentry.io` (via a GitHub webhook — see [Consumers](#consumers))

Every push to `main` propagates to `api.rulesentry.io` within ~30 seconds.

## What's in here

```
.
├── catalog/                          # Core, RuleSentry-published entities
│   ├── rules/rulesentry/             # 279 rules organized by category
│   │   ├── contact/
│   │   ├── financial/
│   │   ├── government/
│   │   ├── healthcare/
│   │   └── ...
│   ├── policies/rulesentry/          # 12 policies (regional + framework)
│   ├── categories/                   # 10 data-category definitions
│   ├── profiles/                     # 21 profile definitions (compliance frameworks, envs)
│   ├── validators/                   # 40 declarative checksum validators
│   └── regions/
│       └── regions.json              # Region hierarchy (GLOBAL > AMERICAS > US > US-CA ...)
├── configuration/
│   └── tenants/                      # Tenant-specific overrides and extensions
│       └── {tenant-id}/
│           ├── rules/                # Tenant custom rules
│           ├── policies/
│           └── ...
├── fixtures/
│   └── samples/                      # Reference input/output samples for engine tests
├── LICENSE
└── README.md
```

**Layout rules:**
- `catalog/` holds RuleSentry-published entities (`publisher_id: "rulesentry"`).
- `configuration/tenants/{tenant-id}/` mirrors the `catalog/` shape for entities scoped to a specific tenant.
- Category subdirectories under `rules/` are organizational only — a rule's canonical identity comes from its JSON fields, not its path.

## Identity principle

> **File path is storage layout, not canonical identity.** Canonical identity is defined by `id`, `qualified_id`, `publisher_id`, and `version` inside the JSON file.

You can reorganize the directory tree without changing the meaning of any entity, as long as the identity fields inside the JSON remain unchanged.

### ID conventions

**`qualified_id` format:** `{publisher_id}.{category_id}.{name}`

| Publisher | Example `qualified_id` | `publisher_id` |
|-----------|------------------------|----------------|
| RuleSentry | `rulesentry.government.ssn_format` | `rulesentry` |
| Tenant | `mycos.contact.th_phone_number` | `mycos` |

Rules:
- `publisher_id` matches the publishing organization. For tenant entities, it matches the `{tenant-id}` directory.
- `qualified_id` starts with `{publisher_id}`.
- `id` is a local dotted identifier (e.g., `government.ssn_format`) — stable across reorganizations.
- `version` is semver (`MAJOR.MINOR.PATCH`). Bump when publishing a changed entity.

## Schema

Entities conform to v4 JSON schemas published at `https://schemas.rulesentry.io/schema/v4/`. Include a `$schema` URL in every file so editors (VS Code, JetBrains) validate and autocomplete:

```json
{
  "$schema": "https://schemas.rulesentry.io/schema/v4/catalog/rule.schema.json",
  ...
}
```

Schema reference by entity type:

| Entity | Schema |
|--------|--------|
| Rule | `catalog/rule.schema.json` |
| Policy | `catalog/policy.schema.json` |
| Category | `catalog/category.schema.json` |
| Profile | `catalog/profile.schema.json` |
| Validator | `catalog/validator-definition.schema.json` |
| Region | `catalog/region.schema.json` |
| Region registry | `catalog/region-registry.schema.json` |

Source of truth for the schemas themselves lives in the [`rulesentry/rulesentry`](https://github.com/rulesentry/rulesentry) repo under `schemas/`.

## Contributing

### 1. Fork + clone + branch

```bash
git clone git@github.com:<your-fork>/catalog.git
cd catalog
git checkout -b feat/my-rule
```

### 2. Add or edit an entity

Place your file under the appropriate path. Minimum rule example:

```json
{
  "$schema": "https://schemas.rulesentry.io/schema/v4/catalog/rule.schema.json",
  "id": "contact.my_thing",
  "qualified_id": "rulesentry.contact.my_thing",
  "publisher_id": "rulesentry",
  "type": "rule",
  "version": "1.0.0",
  "name": "My Thing",
  "description": "Detects ...",
  "category_id": "contact",
  "severity": "medium",
  "regions": ["GLOBAL"],
  "evaluation": {
    "evaluation_type": "pattern_match",
    "target": "content",
    "pattern": {
      "pattern": "\\bmy-regex\\b",
      "engine": "regex"
    },
    "effect": {
      "type": "transform",
      "transform": { "type": "redact", "params": {} },
      "message": "Removed my_thing"
    }
  },
  "status": "active",
  "created_at": "2026-04-20T00:00:00Z",
  "modified_at": "2026-04-20T00:00:00Z"
}
```

### 3. Open a PR

Target `main`. The PR's required `validate` status check runs JSON Schema validation. Merges to `main` propagate automatically to `api.rulesentry.io`.

### Policies

Policies assemble rules via three mechanisms: direct references (`rules[]`), category inclusion (`rule_categories[]`), and filters (`rule_filters[]`). A policy can reference any rule in the catalog by its `id` (when unique) or `qualified_id`. See existing policies under `catalog/policies/rulesentry/` for patterns.

### Validators

Validators are declarative checksum algorithms (Luhn, MOD-11, IBAN MOD-97, Verhoeff, prefix-check, multi-stage). Each is a JSON file in `catalog/validators/` that the engine loads into a registry at startup; rules reference them by name. To add a new validator, copy an existing one with the closest algorithm family and adjust params — no engine code change needed unless the algorithm is novel.

### NER rules and the deterministic boundary

A `ner_match` rule declares the canonical entity types it wants, and the engine
intersects those with what the bound model can emit. Two model families ship:
DistilBERT (4 coarse types — person, location, organization) and Ettin 32M PII
(55 fine types).

**The convention: a NER rule for a type that a VALIDATED deterministic rule
already owns ships `status: "inactive"`.**

The line is verifiability, not existence. It is not "does a regex for this exist"
— plenty of types have both and both earn their place. It is whether the
deterministic rule *proves* the value:

| The deterministic partner | The NER rule | Why |
|---|---|---|
| carries a **validator** (checksum, format, scope) | ships `inactive` | The regex does not merely find the value, it adjudicates it. A model re-finding a card number that failed Luhn is overriding a proof with a guess — and because a rejection is a `RejectedMatch` rather than a result, nothing opposes it downstream. |
| pattern-match only, no validator | ships `active` | The regex is a proxy, not a proof. A model may genuinely be better in prose — `street_address`, `city`, `date` — and both findings are worth having. |
| does not exist | ships `active` | Free-form semantics no regex can reach: `person_name`, `occupation`, `organization`, `religious_belief`. This is what the capability is for. |

`inactive` is disabled-by-default, NOT deleted: an operator who wants the backup
detector turns it on with an `enabled: true` override per configuration. The
complement case — NER finding something in prose where the regex form never
appears — is preserved where it is real, and switched off where the format IS
the identity and a checksum already settles it.

Measured 2026-07-29: validators reject about a quarter of all deterministic
candidate spans on realistic text, and roughly three quarters of those
rejections fall on a canonical type some NER rule claims. That is the size of
the problem this convention removes.

Reference: `docs/dev/ner-decoupling-execution.md` in the code repo (D-6/D-7, §5).

### Tenant overrides

Tenant-specific entities live under `configuration/tenants/{tenant-id}/`. Use this for custom rules, policies, or overrides that shouldn't ship in the public catalog. Each tenant directory mirrors the `catalog/` layout.

## Consumers

| Consumer | How it reads the catalog |
|---|---|
| **`rulesentry-api`** (api.rulesentry.io) | GitHub webhook on every push to `main` → background tarball fetch → upsert into `catalog_items` Postgres table. Catalog browseable via `GET /api/v1/catalog/public`. See the API's [README](https://github.com/rulesentry/rulesentry/blob/main/rulesentry-api/README.md) for sync internals. |
| **`rulesentry-data`** (embedded defaults) | Build-time `include_str!` walks the `catalog/` tree and embeds all JSON into the engine/CLI/WASM/desktop binaries. Override the build source with `RULESENTRY_DATA_DIR=/path/to/local-clone`. |
| **Desktop app** | Reads embedded defaults plus tenant overrides from local SQLite. Can optionally pull fresh data from the API. |
| **Engine tests** | Load from `fixtures/samples/` for deterministic regression tests. |

## Identity + versioning workflow

- **Minor edits** (typo fix, pattern tightening, new example): bump `PATCH` and set `modified_at` to the commit timestamp.
- **Breaking changes** (semantics, regions covered, `evaluation_type`): bump `MAJOR` and consider publishing under a new `id` so consumers can pin the old version.
- **New entities**: start at `1.0.0`.

The API catalog keeps all versions by `(item_id, version)`. Consumers choose the version via `pinned_version` in policies, or fetch latest via `GET /api/v1/catalog/public/{id}` without `?version=`.

## License

MIT — see [LICENSE](LICENSE).
