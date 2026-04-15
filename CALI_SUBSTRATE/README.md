# CALI_SUBSTRATE

**Cognitively Aligned Linear Intelligence — Knowledge Substrate**

The a_priori vault. Curated, stable, domain-structured knowledge that seeds CALI's belief state before any runtime query, API call, or empirical observation is made. This is not a cache and not a log. Everything here was placed deliberately and is considered epistemically stable — reliable enough to shape how CALI reasons from the first moment it is online.

---

## What This Is and Why It Exists

CALI operates a two-vault epistemology modeled on the classical distinction between a_priori and a_posteriori knowledge:

| Vault | Origin | Philosophical type | Persistence | Trust basis |
|---|---|---|---|---|
| **a_priori** | This substrate (CSV/JSON loaded at boot) | Stable, curated prior belief | Permanent on disk | Human-reviewed; high trust |
| **a_posteriori** | Runtime API returns, swarm synthesis, research results | Empirical, observed evidence | Append-only JSONL in memory | Weighted by source quality and confidence |

The a_priori vault is CALI's starting knowledge — what it already knows before looking anything up. The a_posteriori vault is what it learns from the world at runtime. This substrate is the source of the former.

Without the substrate, CALI starts from nothing and must build every belief from raw API data alone. With it, CALI enters every query already understanding the domain landscape, the priority rules between domains, the governance constraints, and the system architecture it operates within. This is what makes domain-aware routing, governance checks, and cross-domain conflict resolution possible from the first query.

CALI's four philosopher reasoning seeds map naturally onto this architecture:
- **Locke** (LOCKE_EMPIRICAL) — treats API returns and research synthesis as sensory evidence. All runtime data is Lockean.
- **Hume** (HUME_SKEPTICAL) — questions causal claims and insists on correlation-only unless causation is established. Applied when queries involve causal language.
- **Kant** (KANT_SYNTHETIC) — synthesizes multiple reasoning threads into a single verdict. The default arbitration mode.
- **Spinoza** (SPINOZA_MONISTIC) — seeks the unified, systemic view across domains. Applied when queries require holistic reasoning.

Substrate knowledge is not stamped with a reasoning mode — it is the prior that all four modes reason *against*.

---

## Runtime Integration

### Boot sequence

At startup, `CALISKG.__init__` in `cali_skg.py` runs:

1. `_load_substrate_domain_knowledge()` — rglobs all CSV files under `domain_knowledge/`, reads every row regardless of which domain folder it is in
2. `_csv_row_to_content()` — joins `name`, `description`, `keywords`, `semantic_tags`, `implications`, and `edge_case_handling` into a single content string per row
3. `_inject_substrate_knowledge()` — appends each row as an entry in the in-memory `a_priori_vault["entries"]` and registers a corresponding KG node linked to `cali_identity` and `vault_a_priori`

The knowledge graph nodes enable multi-hop traversal — CALI can follow edges from a substrate entry to related entries across domains, not just keyword-match in isolation.

### Query time

When a query arrives, `SubstrateRouter.match_query()` in `orb_controller.py`:

1. Scores query tokens against `keywords` and `semantic_tags` from all loaded substrate entries
2. Identifies the primary domain, secondary domains, and a domain priority override if one applies
3. Selects a resolution strategy (see cross-domain section below)
4. Runs governance checks against `governance_flags` and the domain priority matrix
5. Returns a routing context dict that is injected into CALI's reasoning path before the philosopher seeds run

This means CALI knows the domain, the rules, and any active constraints *before* it reasons — the substrate shapes the frame, not just the content.

### Crystallization

High-confidence research returns (confidence ≥ 0.82) are crystallized into the in-memory a_priori vault at runtime via `_store_research_return()`. These crystallized entries behave like substrate entries for the remainder of the session but are **never persisted back to this directory**. Only human-reviewed, intentionally placed files earn permanent substrate status. The distinction matters: the substrate is curated knowledge; crystallized runtime findings are strong empirical conclusions that have not yet been validated for permanence.

---

## Top-Level Layout

```
CALI_SUBSTRATE/
└── domain_knowledge/
    ├── manifest.json
    ├── code_review/
    │   ├── code_rule_set.csv
    │   ├── code_topics.csv
    │   └── code_use_cases.csv
    ├── cross_domain/
    │   ├── domain_priority_matrix.csv
    │   ├── cross_domain_query_patterns.csv
    │   ├── cross_domain_topic_links.csv
    │   └── cross_domain_usecase_links.csv
    ├── farm_economics/
    │   ├── arms-all-variables-december-2023.csv
    │   ├── variable_dictionary.json
    │   ├── variable_index.json
    │   └── by_report/
    │       ├── farm_business_balance_sheet.json
    │       ├── farm_business_debt_repayment_capacity.json
    │       ├── farm_business_financial_ratios.json
    │       ├── farm_business_income_statement.json
    │       ├── government_payments.json
    │       ├── operator_household_balance_sheet.json
    │       ├── operator_household_income.json
    │       └── structural_characteristics.json
    ├── financial_knowledge/
    │   ├── financial_topics.csv
    │   └── financial_use_cases.csv
    ├── general_datasets/
    │   ├── general_topics.csv
    │   └── general_use_cases.csv
    ├── industrial_knowledge/
    │   ├── industrial_topics.csv
    │   └── industrial_use_cases.csv
    ├── macro_economic_knowledge/
    │   ├── macro_topics.csv
    │   └── macro_use_cases.csv
    ├── medical_knowledge/
    │   ├── medical_topics.csv
    │   └── medical_use_cases.csv
    ├── micro_economic_knowledge/
    │   ├── micro_topics.csv
    │   └── micro_use_cases.csv
    ├── research_layer/
    │   ├── research_api_registry.csv
    │   ├── research_api_validation_ledger.csv
    │   └── research_category_links.csv
    └── truemark_mint/
        ├── ontology_graph.md
        ├── truemark_system_map.csv
        ├── truemark_asset_types.csv
        ├── truemark_cert_layers.csv
        ├── truemark_use_cases.csv
        ├── truemark_value_channels.csv
        ├── truemark_market_model.csv
        ├── truemark_financial_domain_integration.csv
        ├── truemark_asset_to_certlayer_bindings.csv
        ├── truemark_asset_to_usecase_links.csv
        └── truemark_usecase_to_valuechannel_links.csv
```

**Ontology version:** 1.3 (tracked in `manifest.json`)
**Last updated:** 2026-04-12
**Research API manifest:** `R:\manifests\research_api_manifest.json`

---

## Domain Folders

### `manifest.json`

The ontology registry. Tracks the current set of active domains and their version. When adding a new domain folder, increment `ontology_version` here and add the domain name to the `new_domains` array. This file is the single source of truth for what domains exist — do not add a domain folder without updating it.

Cross-domain note from the manifest: *"All domains link to TrueMark Mint (issuance), GOAT (preservation), and spruked.com (hosting/integration)."*

---

### `code_review/`

Rules and topic structure for code analysis, review, and quality assurance tasks.

- `code_rule_set.csv` — explicit coding standards and constraint rules that CALI applies when reviewing code
- `code_topics.csv` — topic taxonomy for structuring code review queries and routing them correctly
- `code_use_cases.csv` — common review scenarios including edge case handling for ambiguous or borderline code patterns

---

### `cross_domain/`

The governance layer. This folder does not contain domain knowledge — it contains the rules that govern how domains interact when a query spans more than one of them. It is the substrate's internal policy document.

#### `domain_priority_matrix.csv`

When two domains conflict — when medical constraints contradict financial optimization, or when industrial safety limits packaging shortcuts — this matrix determines which domain wins. Priority is not negotiable at runtime; it is resolved here at the substrate level.

| Domain | Priority role |
|---|---|
| `medical_knowledge` | Highest. Patient safety and privacy override everything without exception. |
| `financial_knowledge` | Overrides process goals. Disclosure and audit constraints are non-negotiable. |
| `macro_economic_knowledge` | Frames interpretation. Macro conditions contextualize financial and micro decisions. |
| `industrial_knowledge` | Overrides packaging shortcuts. Operational and certification safety takes precedence. |
| `general_datasets` | Support role only. Informs reasoning but never overrides a domain-specific fact. |

Full matrix:

| Domain A | Domain B | Rule | Description |
|---|---|---|---|
| medical_knowledge | truemark_mint | medical_overrides | Health constraints override packaging or licensing preferences |
| medical_knowledge | financial_knowledge | medical_overrides | Patient safety overrides financial optimization when privacy is implicated |
| medical_knowledge | industrial_knowledge | medical_overrides | Clinical safety overrides process throughput goals |
| financial_knowledge | truemark_mint | financial_overrides | Audit and disclosure constraints override packaging preferences |
| financial_knowledge | industrial_knowledge | financial_overrides | Cost and disclosure constraints override non-critical process expansion |
| macro_economic_knowledge | financial_knowledge | macro_context_priority | Macro conditions frame risk and pricing interpretation |
| macro_economic_knowledge | micro_economic_knowledge | macro_context_priority | Macro trends contextualize micro-level decisions |
| industrial_knowledge | truemark_mint | industrial_overrides | Operational safety and certification override packaging shortcuts |
| general_datasets | (all) | support_only | General data informs but never overrides domain-specific rules |

#### `cross_domain_query_patterns.csv`

Known query patterns with their primary domain, secondary domain, and the resolution strategy CALI should apply. This is a curated lookup of how real cross-domain queries should be handled — not heuristics, but explicit mappings.

| Query pattern | Primary | Secondary | Strategy |
|---|---|---|---|
| clinical compliance audit | medical_knowledge | truemark_mint | constraint_first |
| medical billing governance | medical_knowledge | financial_knowledge | merge_causal |
| telemedicine infrastructure risk | medical_knowledge | industrial_knowledge | dependency_chain |
| financial risk under rate shifts | macro_economic_knowledge | financial_knowledge | contextual_overlay |
| supply chain trade exposure | industrial_knowledge | macro_economic_knowledge | causal_trace |
| pricing competition impact | micro_economic_knowledge | financial_knowledge | weighted_balance |
| sustainability reporting | general_datasets | financial_knowledge | merge_causal |
| smart factory governance | industrial_knowledge | general_datasets | constraint_first |
| family health preservation | medical_knowledge | truemark_mint | dependency_chain |
| ip competition licensing | micro_economic_knowledge | truemark_mint | constraint_first |

Resolution strategies:
- `constraint_first` — apply the higher-priority domain's constraints before any synthesis
- `merge_causal` — merge evidence from both domains into a unified causal chain
- `dependency_chain` — trace the dependency path from primary to secondary and reason along it
- `contextual_overlay` — use the secondary domain as framing context over the primary domain's answer
- `causal_trace` — follow explicit cause-effect relationships between domains
- `weighted_balance` — weight both domains proportionally and synthesize

#### `cross_domain_topic_links.csv`

Semantic links between named topic nodes across domain boundaries, with strength, relationship type, and confidence. These are the edges in the knowledge graph that connect substrate entries to each other across domain lines.

Key link types: `constraint`, `dependency`, `correlated`, `causal`, `influence`

Examples:
- `financial_knowledge/risk_metrics` → `macro_economic_knowledge/monetary_policy` — **causal, high confidence** (policy rates directly alter risk conditions)
- `medical_knowledge/diagnostic_codes` → `financial_knowledge/regulatory_filings` — **dependency, high confidence** (coding precision affects billing and disclosure)
- `industrial_knowledge/supply_chain_models` → `macro_economic_knowledge/global_trade_dynamics` — **dependency, high confidence** (logistics models depend on tariff and trade conditions)

All links include `valid_from` dates. Links with `valid_to` dates are temporally bounded.

#### `cross_domain_usecase_links.csv`

Use case relationships that cross domain boundaries — where completing one use case has implications for or dependencies on use cases in another domain.

---

### `farm_economics/`

Real USDA Agricultural Resource Management Survey (ARMS) data. This is primary-source empirical data — actual survey variables covering the financial structure of American farm businesses.

- `arms-all-variables-december-2023.csv` — complete variable listing with descriptions, updated December 2023
- `variable_dictionary.json` — machine-readable variable definitions with units and survey methodology notes
- `variable_index.json` — lookup index by variable code for fast retrieval

**`by_report/` — structured extracts organized by USDA report type:**

| File | Content |
|---|---|
| `farm_business_balance_sheet.json` | Assets, liabilities, and equity structure of farm operations |
| `farm_business_income_statement.json` | Gross revenue, expenses, and net farm income |
| `farm_business_financial_ratios.json` | Solvency, liquidity, profitability, and efficiency ratios |
| `farm_business_debt_repayment_capacity.json` | Debt service coverage and repayment margin metrics |
| `government_payments.json` | Federal program payment types and amounts |
| `operator_household_balance_sheet.json` | Total household wealth including off-farm assets |
| `operator_household_income.json` | Farm and off-farm household income composition |
| `structural_characteristics.json` | Farm size, tenure, commodity type, and operator demographics |

This domain directly supports agricultural lending, rural economic analysis, and food system research. Cross-links to `financial_knowledge` and `macro_economic_knowledge`.

---

### `financial_knowledge/`

Corporate, institutional, and regulatory finance substrate. These entries seed CALI's understanding of financial reporting frameworks, risk models, valuation methods, and disclosure obligations before any financial query runs.

**Topics (`financial_topics.csv`):**

| ID | Name | Keywords | Cross-domain links |
|---|---|---|---|
| `gaap_standards` | GAAP & IFRS Accounting Standards | gaap, ifrs | truemark_market_model, macro_economic_knowledge |
| `risk_metrics` | Financial Risk Metrics & Models | risk, metrics, var, sharpe | micro_economic_knowledge |
| `valuation_models` | Asset & Business Valuation Models | valuation, models, dcf, comparables | truemark_value_channels |
| `regulatory_filings` | SEC & Regulatory Filing Requirements | sec, filings, regulatory, disclosure | industrial_knowledge |

Key implications by topic:
- `gaap_standards` — E-NFTs for corporate playbooks must embed `layer_license`. Accounting standard updates trigger GOAT migration workflows.
- `risk_metrics` — Supports IP structuring and audit record use cases. Market crash edge case requires `temporal_reasoning` fallback.
- `valuation_models` — Mintable as M-NFT templates. Inflation volatility requires recalibration protocol.
- `regulatory_filings` — Enterprise assets must carry full audit layer. Late filings trigger compliance flag in CALI Core.

**Use cases (`financial_use_cases.csv`):**

| ID | Name | TrueMark asset | GOAT workflow | Spruked integration |
|---|---|---|---|---|
| `corporate_reporting_packaging` | Corporate Reporting Packaging | enft/mnft | quality_assurance | enterprise reporting workspace |
| `risk_model_preservation` | Risk Model Preservation | knft/lnft | preservation_structuring | model vault |
| `filing_compliance_documentation` | Filing Compliance Documentation | enft | derivative_preparation | compliance dashboard |

---

### `general_datasets/`

Broad reference knowledge that supports reasoning across all domains without overriding any domain-specific facts. General datasets are the connective tissue — environmental standards, legal frameworks, emerging technology trends — that inform every domain without asserting priority over any of them.

- `general_topics.csv` — topic taxonomy including legal frameworks, environmental standards, and emerging tech
- `general_use_cases.csv` — use cases that draw on broad data without domain-specific constraints

Priority rule: `support_only` — general data informs but never overrides domain-specific facts or constraints.

---

### `industrial_knowledge/`

Manufacturing, operations, certification, and industrial process substrate. Covers the standards and models that govern how physical production systems are structured, measured, and governed.

**Topics (`industrial_topics.csv`):**

| ID | Name | Keywords | Implications |
|---|---|---|---|
| `iso_standards` | ISO Quality & Safety Standards | iso, quality, manufacturing, safety | Suitable for E-NFT operational deployment; certification expiry requires re-anchoring |
| `supply_chain_models` | Supply Chain & Logistics Models | supply_chain, logistics, lean, scor | Supports system documentation use cases; geopolitical disruption requires multi-chain fallback |
| `industry_4.0_technologies` | Industry 4.0 & Smart Manufacturing | industry4.0, digital_twin, smart_factory | Mintable as MNFT blueprints; cybersecurity breach routes to risk_compliance |

Priority rule: Industrial safety and certification constraints override packaging shortcuts (overrides `truemark_mint`). Logistics models depend on trade and tariff conditions (dependency on `macro_economic_knowledge`).

---

### `macro_economic_knowledge/`

Macroeconomic conditions, monetary policy frameworks, and global trade dynamics. This domain's primary role is framing — macro context shapes how CALI interprets financial risk, micro pricing decisions, and industrial planning.

**Topics (`macro_topics.csv`):**

| ID | Name | Keywords | Edge case |
|---|---|---|---|
| `gdp_indicators` | GDP & National Income Metrics | gdp, macro, economic_growth | Recession signals trigger preservation_core weighting |
| `monetary_policy` | Monetary Policy Frameworks | monetary, policy, inflation, interest | Hyperinflation edge case requires temporal_reasoning |
| `global_trade_dynamics` | Global Trade & Geopolitical Risk | trade, geopolitics, tariffs, wto | Trade war triggers multi-jurisdiction consent workflow |

Priority rule: `macro_context_priority` over both `financial_knowledge` and `micro_economic_knowledge` — macro conditions frame interpretation, they do not override, but they set the context within which financial and micro conclusions must be understood.

---

### `medical_knowledge/`

Clinical, health, regulatory, and patient-safety substrate. This is the highest-priority domain in the entire substrate. Medical constraints — patient privacy, clinical safety, consent, jurisdictional licensing — override all other domain conclusions without negotiation.

**Topics (`medical_topics.csv`):**

| ID | Name | Keywords | Governance implications |
|---|---|---|---|
| `hipaa_compliance` | HIPAA & Data Privacy | hipaa, privacy, health_data_regulation | PHI-carrying assets must embed `layer_license + layer_audit`; patient consent re-verified on every derivative mint |
| `clinical_guidelines` | Clinical Practice Guidelines | guidelines, protocols, evidence_based | Mintable as reusable M-NFT templates; version drift triggers GOAT re-structuring alert |
| `diagnostic_codes` | Diagnostic & Procedure Codes | icd, cpt, coding, classification | Code deprecation requires automatic migration workflow |
| `pharmacology_basics` | Pharmacology & Drug Interaction Data | pharmacology, drugs, medication, safety | Allergic reaction edge case requires mandatory advisory_support flag |
| `telemedicine_standards` | Telemedicine & Remote Care Standards | telemedicine, remote, virtual_care | Jurisdictional licensing conflicts resolved via `layer_chain` |

Priority rule: `medical_overrides` — medical privacy and patient-safety constraints override packaging, licensing, financial optimization, and industrial throughput goals. This is absolute.

---

### `micro_economic_knowledge/`

Market structure, firm cost theory, and consumer behavior substrate. Micro-level reasoning about pricing, competition regimes, and market dynamics — used to inform valuation, IP structuring, and asset monetization decisions.

**Topics (`micro_topics.csv`):**

| ID | Name | Keywords | Cross-domain links |
|---|---|---|---|
| `consumer_behavior` | Consumer Behavior Models | consumer, behavior, elasticity, utility | financial_knowledge |
| `firm_theory` | Firm Theory & Cost Structures | firm, cost, marginal, economies | industrial_knowledge |
| `market_structures` | Market Structures & Competition | market, competition, monopoly, oligopoly | macro_economic_knowledge |

Key implications:
- `consumer_behavior` — supports expert packaging for consumer-facing K-NFTs; behavioral bias in data requires explicit disclosure
- `firm_theory` — ideal for MNFT operational templates; market entry barriers affect derivative royalty calculations
- `market_structures` — informs IP structuring decisions; monopoly regulation changes require license review

---

### `research_layer/`

Registry and validation metadata for the live API research layer. This folder bridges the static substrate and the dynamic research system — it documents which APIs exist, what domains they serve, how they have been validated, and how their categories map to substrate domains.

- `research_api_registry.csv` — 25+ APIs with base URLs, categories, priority, auth type, rate limits, mirror paths, and fallback endpoints
- `research_api_validation_ledger.csv` — per-API validation status, last checked date, and audit history
- `research_category_links.csv` — maps API storage categories to substrate domain names for routing

**API categories and sample entries:**

| Category | Sample APIs | Auth | Mirror path |
|---|---|---|---|
| earth_systems_and_climate | NASA EONET, NOAA CDO, AirNow | none / api_key | `R:\datasets\bulk_mirrors\earth_systems_and_climate` |
| agriculture_food_and_water | USDA NASS, USGS Water Services | api_key / none | `R:\datasets\bulk_mirrors\agriculture_food_and_water` |
| biomedical_and_public_health | CDC RespLens, CDC PLACES | none | `R:\datasets\bulk_mirrors\biomedical_and_public_health` |
| financial_economic | FRED, SEC EDGAR | api_key / none | `R:\datasets\bulk_mirrors\financial_economic` |
| macro_economic_indicators | BEA API, World Bank | api_key / none | `R:\datasets\bulk_mirrors\macro_economic_indicators` |
| industrial_manufacturing | BLS Public API | none | `R:\datasets\bulk_mirrors\industrial_manufacturing` |
| micro_economic_markets | Census ACS | none | `R:\datasets\bulk_mirrors\micro_economic_markets` |
| geospatial_and_regional_analysis | USGS Earthquake, Census Geocoder | none | `R:\datasets\bulk_mirrors\geospatial_and_regional_analysis` |
| space_exploration_and_mars | SpaceX API, NASA Mars Rover, CelesTrak, Launch Library 2 | none / optional | `R:\datasets\bulk_mirrors\space_exploration_and_mars` |
| scientific_literature_and_evidence | PubMed eUtils, CrossRef | none | `R:\datasets\bulk_mirrors\scientific_literature_and_evidence` |
| legal_and_regulatory | Regulations.gov, Congress.gov API | api_key | `R:\datasets\bulk_mirrors\legal_and_regulatory` |

The live runtime manifest with full confidence weighting configuration is at `R:\manifests\research_api_manifest.json`. That file controls how `BulkMirrorCache.weight_api_confidence()` scores each API's returns using `priority × auth_multiplier × raw_data_quality`.

---

### `truemark_mint/`

The complete ontology and system map for TrueMark Mint — the asset issuance, certification, and knowledge packaging system. CALI uses this domain to reason about how knowledge assets should be structured, certified, licensed, and monetized.

The system architecture (`truemark_system_map.csv`):

| Layer | System | Visibility | Role |
|---|---|---|---|
| 1 | TrueMark Mint | full | Primary external brand and issuance system |
| 2 | CertSig | hidden | Certification engine — never surfaced to users |
| 3 | GOAT Preservation System | hidden | Content preparation and structuring |
| 4 | CALI Core | full (reasoning only) | Knowledge authority and cross-linking |
| 5 | Orb Interface | full | User interaction and visualization |

**Brand rule:** TrueMark Mint is the visible root. CertSig is the hidden engine. No brand inversion or CertSig surface leakage is permitted. The Orb must never override TrueMark branding.

#### Asset Types (`truemark_asset_types.csv`)

| ID | Name | Description | Orb access | Key edge case |
|---|---|---|---|---|
| `knft` | Knowledge Asset (K-NFT) | Single structured knowledge unit | full | Orphaned content auto-archived after 7 years of inactivity |
| `hnft` | Heirloom Asset (H-NFT) | Personal/family preservation asset | heirloom | Multi-generational key rotation required; emotional value weighting in valuation |
| `lnft` | Legacy Asset (L-NFT) | Aggregated multi-unit long-term record | full | Minimum 5 linked units; license chain integrity required across bundle |
| `enft` | Enterprise Asset (E-NFT) | Organizational knowledge system | enterprise | Audit log must remain attached indefinitely; supports role-based access |
| `cnft` | Certificate Preview Asset (C-NFT) | Non-production demo artifact | preview | Expires after 30 days; watermarked; never mintable as final asset |
| `mnft` | Master Template Asset (M-NFT) | Reusable derivative blueprint | full | Template updates propagate only with explicit consent from original issuer |

#### Certification Layers (`truemark_cert_layers.csv`)

All assets pass through CertSig. The certification stack:

| Layer | Purpose | Visibility | Required for |
|---|---|---|---|
| `layer_identity` | Creator/ownership attribution (DID + verifiable credential) | hidden | All assets |
| `layer_content` | Knowledge encoding (JSON-LD + TrueMark schema) | hidden | All assets |
| `layer_metadata` | Descriptive attributes (Dublin Core + custom) | hidden | All assets |
| `layer_hash` | Content fingerprint (SHA-512 + BLAKE3 dual hash) | hidden | All assets |
| `layer_license` | Usage rights and permissions (CC + TrueMark License v1) | hidden | All assets |
| `layer_timestamp` | Multi-anchor time proof (UTC + NTP + blockchain) | hidden | All assets |
| `layer_chain` | Multi-chain blockchain anchor (Ethereum, Polygon, etc.) | hidden | Enterprise only |
| `layer_encryption` | Content protection (ChaCha20-Poly1305 / XChaCha20) | hidden | Optional |
| `layer_signature` | Cryptographic verification (Ed25519 / post-quantum Dilithium) | hidden | All assets |
| `layer_render` | Human-readable certificate output (PDF + SVG + HTML) | **visible** | Preview & final cert |
| `layer_qr` | Field verification QR code (dynamic + offline fallback hash) | **visible** | All assets |
| `layer_audit` | Immutable append-only traceability log | hidden | Enterprise only |
| `layer_registry` | Global registry linkage (TrueMark Global Registry DID) | hidden | All assets |

#### Ontology traversal paths

The primary traversal: `asset → use_case → value_channel → market_model`

Key paths:

**High-revenue enterprise path:**
`enft → ip_structuring → licensed_access → operator_control`
Requires: `layer_chain + layer_audit`. White-label capable. Recurring licensed revenue. Strong compliance posture.

**Generational preservation path:**
`hnft → family_preservation → derivative_royalty → preservation_core`
Requires: `layer_timestamp`. Multi-generational inheritance. Passive royalty stream. Emotional and legal defensibility are both first-class.

**Atomic expert packaging path:**
`knft → expert_packaging → direct_issue + licensed_access → license_first`
Requires: `layer_identity + layer_license + layer_render`. Granular monetization. Derivative-friendly. Strong fit for repeatable method packaging.

**Preview and onboarding path:**
`cnft → training_delivery → education_use`
Requires: `layer_qr`. Safe demo artifact. Time-limited. Never treated as a final production asset.

Full Mermaid diagram and hierarchical view are in `truemark_mint/ontology_graph.md`.

---

## CSV Column Convention

Most domain topic and use case files follow this shared schema. Not every file uses every column — domain-specific schemas (farm economics, research layer, TrueMark) use their own.

| Column | Type | Purpose |
|---|---|---|
| `id` | string | Stable identifier — used as KG node ID and cross-domain link target. Never change once set. |
| `name` | string | Human-readable label |
| `sequence` | int | Load order within the domain |
| `description` | string | Narrative description of what this entry represents |
| `keywords` | comma-separated | Matched against query text tokens at runtime by SubstrateRouter. Keep specific. |
| `semantic_tags` | comma-separated | Higher-level concept tags used for domain scoring. More abstract than keywords. |
| `cross_domain_links` | comma-separated IDs | References to related entries in other domains. Must be resolvable IDs. |
| `implications` | string | What CALI should infer or assume when this entry matches a query |
| `edge_case_handling` | string | Explicit guidance for known corner cases. Load-bearing — CALI acts on these. |
| `governance_flags` | string | Constraints that trigger governance checks in SubstrateRouter. Do not add speculatively. |
| `review_cycle` | string | How often this entry should be reviewed for accuracy (annual, quarterly, biennial) |
| `example_metric_or_standard` | string | Concrete real-world reference (e.g., "VaR", "ISO 9001:2015") |
| `implications_for_assets` | string | TrueMark-specific: what asset types or cert layers this entry affects |

---

## Governance and Addition Policy

### Read-only at runtime

CALI reads this directory at boot and never writes back to it. The a_posteriori vault at `R:\Orb_Assistant_Desktop\electron\src\cali_vaults\a_posteriori.jsonl` receives runtime data. Crystallized high-confidence findings go to in-memory a_priori. Neither touches this directory.

### Human-reviewed additions only

Do not auto-generate substrate files from API returns or research synthesis. If a research result is so consistently reliable that it deserves permanent substrate status, review it manually, structure it in the correct CSV schema, and add it deliberately. The threshold for substrate inclusion is higher than the crystallization threshold (0.82) — substrate entries are considered authoritative, not just probable.

### Stable IDs

Once an `id` is set in a CSV, treat it as permanent. SubstrateRouter and the knowledge graph reference these IDs to build edges. Changing an ID silently breaks cross-domain links. If an entry is no longer valid, deprecate it with a note rather than deleting or renaming it.

### Ontology versioning

Increment `ontology_version` in `manifest.json` when:
- Adding a new domain folder
- Adding a new cross-domain link type
- Restructuring the priority matrix

Minor additions within an existing domain (new rows in an existing CSV) do not require a version bump.

### Cross-domain links must be directional and declared in both files

If `financial_knowledge/risk_metrics` has `cross_domain_links = micro_economic_knowledge`, then `micro_economic_knowledge` should have a corresponding link back. One-directional links will work at runtime but are incomplete as documentation. The `cross_domain_topic_links.csv` file is the authoritative record — entries there take precedence over inline `cross_domain_links` columns.

### Governance flags are load-bearing

Rows with `governance_flags` values will trigger constraint checks in SubstrateRouter. These are not annotations — they are behavioral instructions. Add them only when you want CALI to actively enforce a constraint during routing.

### Priority overrides are absolute

The domain priority matrix is not advisory. When medical overrides financial or industrial overrides truemark, that is the final answer before reasoning begins. Do not add new override rules without understanding the downstream effect on all queries that touch both domains.

---

## Cognitive Substrate Extractor

The substrate can grow from raw conversational material — past sessions, research transcripts, design discussions — through a dedicated extraction pipeline that automatically classifies content into five cognitive-layer categories and produces structured vault files CALI loads at boot as a_priori knowledge.

### Tool location

```
R:\CALI_SUBSTRATE\tools\cognitive_substrate_extractor.py
```

### What it does

Scans raw HTML chat exports from `R:\raw\chats\` (recursively), scores each conversation against five cognitive categories, extracts the highest-signal segments with surrounding context, and writes one JSON vault per category to `R:\CALI_SUBSTRATE\seeds\cognitive_seed_vault\`.

CALI loads those vault files at every boot via `_load_cognitive_seed_vaults()` in `cali_skg.py`. Each matched segment becomes an in-memory a_priori vault entry and a KG node of type `cognitive_seed` linked to `cali_identity` with relation `cognitive_layer`. This means conversational knowledge about how CALI reasons, how the architecture is designed, what sovereignty means, or what counts as ethical behavior becomes part of CALI's prior belief state — influencing how it frames every query without requiring a network call.

### The five cognitive categories

| Category | What it captures | Example signals |
|---|---|---|
| `epistemology` | Nature of knowledge, truth, belief, justification, a_priori/a_posteriori distinctions | "justified true belief", "what counts as knowledge", "epistemic warrant" |
| `cognition` | Consciousness, awareness, self-reflection, metacognition, attention | "conscious experience", "self-reflection", "metacognition", qualia |
| `ethics_integrity` | Moral reasoning, alignment, epistemic integrity, accountability, harm avoidance | "is it ethical", "epistemic integrity", "do no harm", deontology |
| `architecture_systems` | CALI's own design — SKG, vaults, orb architecture, reasoning pipelines, philosopher seeds | "cognitive architecture", "knowledge graph", "substrate injection", "reasoning path" |
| `sovereignty_legacy` | User sovereignty, memory preservation, identity continuity, privacy, perpetual learning | "user sovereignty", "memory export", "identity continuity", "perpetual memory" |

### Scoring

Each conversation is scored per category:
- **+2** per keyword match
- **+3** per phrase match
- **+10** bonus if ≥ 2 keywords OR ≥ 1 phrase matches (strong cognitive signal)
- **Threshold: 8** — conversations below this score are excluded

Extracted segments get up to 2 sentences of context before and after the matching sentence. Up to 4 segments are kept per conversation, sorted by density score (keyword count + phrase_count × 3).

### KG integration

High-density segments (density_score ≥ 4) receive a KG edge weight of 0.85 vs the default 0.65. This means deeply cognitive content — passages where multiple signals cluster — has stronger influence on multi-hop reasoning paths than lightly-matched content.

### Output files

| Path | Format | Contents |
|---|---|---|
| `seeds/cognitive_seed_vault/epistemology_vault.json` | JSON | All conversations matched on epistemology, sorted by relevance score |
| `seeds/cognitive_seed_vault/cognition_vault.json` | JSON | Consciousness, awareness, self-reflection content |
| `seeds/cognitive_seed_vault/ethics_integrity_vault.json` | JSON | Moral reasoning, alignment, accountability content |
| `seeds/cognitive_seed_vault/architecture_systems_vault.json` | JSON | CALI design, SKG, orb architecture, pipeline content |
| `seeds/cognitive_seed_vault/sovereignty_legacy_vault.json` | JSON | Sovereignty, memory preservation, identity content |

With `--csv`, the tool also writes `domain_knowledge/cognitive_layer/cognitive_topics.csv` in the standard substrate CSV schema so `_load_substrate_domain_knowledge()` picks it up alongside all other domain CSVs.

### Usage

```bash
# Basic — scan R:\raw\chats\ and write vaults
python R:\CALI_SUBSTRATE\tools\cognitive_substrate_extractor.py

# Custom paths
python cognitive_substrate_extractor.py \
  --raw-dir R:/raw/chats \
  --output-dir R:/CALI_SUBSTRATE/seeds/cognitive_seed_vault

# Also write a substrate-compatible CSV
python cognitive_substrate_extractor.py --csv

# Custom CSV output location
python cognitive_substrate_extractor.py --csv --csv-dir R:/CALI_SUBSTRATE/domain_knowledge/cognitive_layer
```

**Dependency:** `pip install beautifulsoup4` for full HTML parsing. Falls back to regex stripping if BS4 is unavailable.

### Where to put raw chat exports

Drop HTML exports from Claude, ChatGPT, or any other conversation source into:

```
R:\raw\chats\
```

The extractor recurses into subdirectories so you can organise by date, project, or source. Only `.html` files are processed — `.json` and `.txt` exports are not currently supported by this tool.

### Boot sequence with cognitive seeds

Updated boot sequence with cognitive seeds wired in:

1. `_inject_substrate_knowledge()` — loads all domain CSVs under `domain_knowledge/`
2. **`_load_cognitive_seed_vaults()`** ← new — loads all `*_vault.json` files from `seeds/cognitive_seed_vault/`
3. `_background_prefetch()` (daemon thread) — seeds bulk mirrors from no-auth APIs

If the seeds directory does not exist or is empty, CALI boots normally — cognitive seeds are additive, not required.

### Benefits summary

| Benefit | Detail |
|---|---|
| Self-referential reasoning | CALI knows its own architecture, vault structure, and reasoning modes as a_priori knowledge — not just from code comments |
| Conversational continuity | Design decisions, philosophical discussions, and engineering rationale from past sessions persist into future sessions as prior belief |
| Ethical grounding | Ethics and alignment content from past conversations becomes part of CALI's belief state before any query runs |
| Sovereignty awareness | User sovereignty and memory preservation principles are seeded into reasoning, not just enforced by code |
| No network dependency | All cognitive seed knowledge is local and offline — available even when APIs are down or rate-limited |
| Additive and non-destructive | Seeds extend the a_priori vault; they do not replace or alter domain CSV knowledge |
| Re-runnable | Run the extractor any time new chat exports are available. Each run overwrites the vault files with fresh content. CALI picks up the new vaults on next boot. |

---

## Related Files on R:\

| Resource | Path | Purpose |
|---|---|---|
| Cognitive extractor | `R:\CALI_SUBSTRATE\tools\cognitive_substrate_extractor.py` | Extracts and classifies raw chat exports into cognitive seed vaults |
| Cognitive seed vaults | `R:\CALI_SUBSTRATE\seeds\cognitive_seed_vault\` | JSON vault files loaded by CALI at boot as a_priori cognitive knowledge |
| Raw chat exports | `R:\raw\chats\` | Drop HTML exports here for extraction |
| Research API manifest | `R:\manifests\research_api_manifest.json` | Live API registry with confidence weighting config |
| Bulk mirrors | `R:\datasets\bulk_mirrors\` | Local cache of API returns, organized by category |
| CALI vaults | `R:\Orb_Assistant_Desktop\electron\src\cali_vaults\` | Runtime a_priori and a_posteriori JSONL files |
| Patterns DB | `R:\Orb_Assistant_Desktop\electron\src\cali_patterns.db` | SQLite inductive memory — learned query→response patterns |
| Drive README | `R:\README.txt` | Full R:\ drive layout, ORB mesh structure, and policies |
| CALI SKG | `R:\Orb_Assistant_Desktop\electron\src\cali_skg.py` | Primary implementation — vault loading, swarm, reasoning |
| Orb controller | `R:\Orb_Assistant_Desktop\electron\src\orb_controller.py` | SubstrateRouter and cognitively_emerge() decision path |
