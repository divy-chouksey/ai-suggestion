# PRD: Model Registry and Classification Redesign

## 1. Product Summary

Model Compass currently recommends AI models from a mixed registry containing real API models, Hugging Face repositories, curated placeholders, provider families, and synthetic strategy entries. This makes recommendations confusing: some cards are not actual models, some links go to catalog pages instead of model pages, and some strong models rank poorly because they are classified into only one category or are missing benchmark mappings.

This PRD defines the changes needed to make Model Compass a trustworthy model recommendation engine with canonical model identity, multi-label classification, source trust ranking, endpoint separation, benchmark enrichment, and clearer UI presentation.

## 2. Problem Statement

Users expect recommendations to contain real, usable AI models. The current system violates that expectation in several ways:

- Placeholder entries such as `Realtime Voice Stack` appear as if they are real models.
- Hugging Face repositories are mixed with commercial API models without enough distinction.
- Some OpenRouter links are generated but not verified as valid model pages.
- A model can only have one primary `category`, even though many models support multiple use cases such as code, text, vision, tools, and document analysis.
- New models can rank poorly if the benchmark table does not include them.
- Curated older entries can outrank newer better models due to higher confidence scores.
- The registry does not separate a model from the providers/endpoints that serve it.

The result is a recommendation system that looks polished but can be wrong, stale, or misleading.

## 3. Goals

- Represent real AI models separately from provider endpoints, repositories, placeholders, and strategy templates.
- Support multi-label model classification instead of one rigid category.
- Improve recommendation quality by using source trust and benchmark freshness.
- Prevent non-model entries from appearing as normal model recommendations.
- Make links reliable and clearly sourced.
- Preserve the current app experience while improving the underlying registry and scoring system.
- Keep the system maintainable without scraping every AI company manually.

## 4. Non-Goals

- Build a complete commercial gateway like Helicone.
- Support every AI provider with a first-party integration immediately.
- Replace all JSON storage with a database in the first phase.
- Guarantee perfect benchmark accuracy for every long-tail model.
- Automatically evaluate models by running benchmark suites ourselves.

## 5. Users and Use Cases

### Primary User

A developer, founder, researcher, or product builder who wants to choose an AI model for a specific use case.

### Core Use Cases

- “Best coding model for repository refactors.”
- “Cheap voice generation model.”
- “Private model for internal document analysis.”
- “Fast model for customer support.”
- “Vision model with large context and tool use.”
- “Compare frontier coding models by cost and quality.”

## 6. Current Architecture Issues

### 6.1 Flat Model Registry

The current `ModelProfile` object combines identity, endpoint, source, pricing, benchmark, and recommendation metadata into one record. This is too flat.

Example problem:

```text
Claude Opus 4.8 via Anthropic
Claude Opus 4.8 via OpenRouter
Claude Opus 4.8 via Bedrock
Claude Opus 4.8 benchmark result
```

These are related, but they are not the same thing. The current registry cannot model that cleanly.

### 6.2 Single Category Classification

The current schema uses:

```ts
category: 'general' | 'code' | 'image' | 'video' | 'voice' | 'music' | 'document'
```

This fails for multi-purpose models. For example, Claude Opus, Gemini Pro, and GPT-class models can be relevant for:

- general reasoning,
- coding,
- documents,
- vision,
- tool use,
- agents.

A single category causes category-fit penalties when a model is classified too narrowly or too broadly.

### 6.3 Mixed Record Types

The registry contains:

- real API models,
- open-weight models,
- Hugging Face repos,
- curated models,
- provider family placeholders,
- strategy stacks.

All of them render as `ModelCard`, so the UI cannot tell users what is actually deployable.

### 6.4 Weak Link Validity

Some `sourceUrl` values point to:

- a real model page,
- a broad catalog page,
- an API endpoint,
- a Hugging Face search result,
- a generated OpenRouter URL that may not exist.

The app currently does not distinguish these link types.

## 7. Proposed Solution

Redesign the registry around four separate concepts:

```text
CanonicalModel
ProviderEndpoint
BenchmarkRecord
RecommendationProfile
```

The app should recommend canonical models, then show where those models are available.

## 8. New Data Model

### 8.1 CanonicalModel

Represents the actual model identity.

```ts
type CanonicalModel = {
  id: string
  canonicalId: string
  displayName: string
  provider: string
  providerModelId?: string
  family?: string
  version?: string
  releaseDate?: string
  status: 'active' | 'preview' | 'deprecated' | 'unknown'
  recordType: 'api_model' | 'open_weight_model'
  sourceAuthority: 'first_party' | 'aggregator' | 'curated'
  sourceUrl: string
  linkStatus: 'verified' | 'unverified' | 'catalog' | 'broken'
}
```

### 8.2 Capabilities

Replace single-category logic with multi-label capabilities.

```ts
type ModelCapabilities = {
  primaryUseCases: UseCase[]
  secondaryUseCases: UseCase[]
  modalities: Modality[]
  supportsTools: boolean
  supportsVision: boolean
  supportsAudioInput: boolean
  supportsAudioOutput: boolean
  supportsJsonMode?: boolean
  supportsBatch?: boolean
}

type UseCase =
  | 'general'
  | 'code'
  | 'agent'
  | 'document'
  | 'rag'
  | 'vision'
  | 'image_generation'
  | 'video_generation'
  | 'speech_to_text'
  | 'text_to_speech'
  | 'music_generation'
  | 'embedding'
  | 'reranking'
```

### 8.3 ProviderEndpoint

Represents where and how a model can be called.

```ts
type ProviderEndpoint = {
  id: string
  canonicalModelId: string
  provider: string
  routeModelId: string
  endpointType: 'first_party' | 'aggregator' | 'cloud_platform' | 'self_hosted'
  apiBase?: string
  sourceUrl: string
  pricing?: Pricing
  contextLength?: number
  availability: 'available' | 'limited' | 'unknown' | 'deprecated'
  confidence: number
}
```

### 8.4 BenchmarkRecord

Represents external benchmark evidence.

```ts
type BenchmarkRecord = {
  id: string
  canonicalModelId: string
  source: 'Artificial Analysis' | 'SWE-bench' | 'HumanEval' | 'MTEB' | 'Chatbot Arena' | 'Provider Eval' | 'Curated'
  metric: string
  rawValue: number
  normalizedValue: number
  date?: string
  sourceUrl?: string
  confidence: number
}
```

### 8.5 Non-Model Records

Strategy templates should not be stored as normal models.

```ts
type StrategyTemplate = {
  id: string
  name: string
  useCase: UseCase
  description: string
  recommendedComponents: string[]
  exampleProviders: string[]
}
```

Example: `Realtime Voice Stack` should become a strategy template, not a model card.

## 9. Classification Redesign

### 9.1 Multi-Label Classification

Models should have both primary and secondary use cases.

Example:

```json
{
  "displayName": "Claude Opus 4.8",
  "primaryUseCases": ["general", "code", "agent", "document"],
  "secondaryUseCases": ["vision", "rag"],
  "modalities": ["text", "vision", "tools"]
}
```

### 9.2 Use Case Fit

Replace the current `categoryFit(model.category, targetCategory)` with capability-aware fit.

Proposed fit function:

```text
exact primary use case match      = 1.00
secondary use case match          = 0.82
general model for code/document   = 0.75
modality-only partial match       = 0.55
unrelated                         = 0.15
```

This allows a model to be good at both coding and document analysis without duplicating records.

### 9.3 Capability Confidence

Each capability should carry a source and confidence.

```ts
type CapabilityEvidence = {
  useCase: UseCase
  confidence: number
  source: 'first_party' | 'benchmark' | 'aggregator' | 'curated' | 'heuristic'
}
```

First-party and benchmark evidence should outrank heuristic classification.

## 10. Source Strategy

Do not scrape every AI company. Use a tiered source system.

### Tier 1: First-Party Sources

Use first-party docs/APIs for major providers:

- OpenAI,
- Anthropic,
- Google Gemini,
- Mistral,
- Cohere,
- DeepSeek,
- ElevenLabs,
- Deepgram.

Use these for:

- canonical model names,
- model IDs,
- status,
- context window,
- modalities,
- pricing where available,
- deprecation info.

### Tier 2: Aggregators

Use aggregators for long-tail coverage:

- OpenRouter,
- LiteLLM model prices,
- Helicone-style registries if usable,
- Artificial Analysis for comparison metadata.

Use aggregators for:

- endpoint availability,
- route pricing,
- context fallback,
- broad model discovery.

### Tier 3: Open-Source Catalogs

Use Hugging Face only for:

- open-weight models,
- embeddings,
- rerankers,
- TTS/STT models,
- image/video models,
- self-hostable deployments.

Do not let random Hugging Face repos compete directly with first-party commercial API models unless they are validated as usable models.

### Tier 4: Curated Overrides

Maintain a small file:

```text
server/data/model-overrides.json
```

Used for:

- correcting categories,
- adding new frontier models before aggregators update,
- marking broken links,
- deprecating aliases,
- merging duplicate IDs.

## 11. Recommendation Scoring Changes

### 11.1 Current Problem

Current score:

```text
weighted metrics * categoryFit^1.3 * confidenceFactor
```

This is reasonable, but bad metadata causes bad rankings.

### 11.2 Proposed Score

Use:

```text
score =
  utilityScore
  * capabilityFit
  * sourceTrust
  * freshnessFactor
  * confidenceFactor
```

Where:

- `utilityScore` is weighted quality/cost/speed/context/privacy/availability.
- `capabilityFit` uses multi-label classification.
- `sourceTrust` penalizes placeholders and low-quality sources.
- `freshnessFactor` penalizes stale benchmark or unknown model data.
- `confidenceFactor` reflects data completeness and verification.

### 11.3 Source Trust Multipliers

```text
first_party verified model        = 1.00
benchmark verified model          = 0.97
aggregator model with endpoint    = 0.90
curated model                     = 0.85
Hugging Face validated model      = 0.80
heuristic-only model              = 0.65
placeholder/strategy              = hidden from normal recommendations
```

### 11.4 Hard Exclusions

Normal recommendations should exclude:

- `recordType = placeholder`,
- `recordType = strategy_template`,
- broken links unless no alternatives exist,
- deprecated models by default,
- Hugging Face repos without model-like tags or inference metadata.

## 12. UI Changes

### 12.1 Model Card Labels

Each card should show what type of thing it is:

```text
API Model
Open-Weight Model
Hosted Open Model
Strategy Template
Provider Route
```

### 12.2 Source Badges

Examples:

```text
Verified by Anthropic
Available via OpenRouter
Benchmark from Artificial Analysis
Open model from Hugging Face
Curated estimate
```

### 12.3 Link Treatment

Use different labels:

- `Open model page`,
- `Open provider docs`,
- `Open route`,
- `Open Hugging Face repo`,
- `Open catalog`.

Do not pretend catalog pages are model pages.

### 12.4 Strategy Templates

Strategy entries like `Realtime Voice Stack` should appear in a separate section:

```text
Suggested architecture
Realtime voice agent = STT + LLM + TTS + streaming transport
Example providers: Deepgram, OpenAI Realtime, ElevenLabs
```

They should not compete with actual voice models.

## 13. API Changes

### 13.1 Recommendation Response

Add richer metadata:

```ts
type RecommendedModel = CanonicalModel & {
  endpoints: ProviderEndpoint[]
  capabilities: ModelCapabilities
  score: number
  scoreBreakdown: {
    utility: number
    capabilityFit: number
    sourceTrust: number
    confidence: number
    freshness: number
  }
  reasons: string[]
  warnings: string[]
}
```

### 13.2 Model Detail Endpoint

Add:

```text
GET /api/models/:id
```

Returns canonical model details, endpoints, benchmarks, source history, and link status.

### 13.3 Registry Diagnostics Endpoint

Add:

```text
GET /api/registry/diagnostics
```

Returns:

- duplicate model groups,
- broken/unverified links,
- stale benchmark records,
- placeholder records,
- low-confidence classifications.

## 14. Migration Plan

### Phase 1: Schema Preparation

- Add `recordType`.
- Add `primaryUseCases` and `secondaryUseCases`.
- Add `linkStatus`.
- Add `sourceAuthority`.
- Keep old `category` for backwards compatibility.

### Phase 2: Source Cleanup

- Move seed placeholders into `strategy-templates.json`.
- Add first-party canonical records for top models.
- Add override file for known classification fixes.
- Mark Hugging Face records as `hf_repo` or `open_weight_model`.

### Phase 3: Scoring Upgrade

- Replace single-category fit with capability fit.
- Add source trust multiplier.
- Add freshness multiplier.
- Add score breakdown in response.

### Phase 4: UI Upgrade

- Add model type badges.
- Add source/verification badges.
- Add separate strategy section.
- Add link labels based on link type.

### Phase 5: Diagnostics and Tests

- Add registry diagnostics endpoint.
- Add tests for multi-label classification.
- Add tests for placeholders not appearing as models.
- Add golden ranking tests for known prompts.

## 15. Acceptance Criteria

### Model Identity

- Placeholder entries no longer appear as normal model cards.
- A real model has one canonical identity even if multiple providers serve it.
- OpenRouter route entries enrich canonical models instead of duplicating them unnecessarily.

### Classification

- A model can match multiple use cases.
- Claude/Gemini/GPT frontier models can rank for both `general` and `code`.
- Voice generation, speech-to-text, and voice-agent workflows are separate use cases.

### Ranking

- New verified frontier models do not rank below stale curated entries because of missing benchmark table mappings.
- Source trust is visible in score breakdown.
- Hard constraints remain hard constraints.

### Links

- Cards distinguish model page, route page, docs page, repo page, and catalog page.
- Broken or unverified links are labeled or hidden.

### UI

- Users can tell whether a recommendation is an API model, open-weight model, Hugging Face repo, or strategy template.
- Strategy templates have their own section and do not compete with actual models.

## 16. Risks

- First-party provider docs may not expose machine-readable model lists.
- Manual overrides can become stale if not reviewed.
- Source merging can accidentally combine distinct models with similar names.
- Overly strict filtering may hide useful long-tail models.
- More metadata increases complexity in the UI and tests.

## 17. Open Questions

- Should JSON remain the registry store, or should this redesign move directly to SQLite?
- Should `strategy_templates` be shown by default or only when no model directly satisfies the query?
- Should first-party provider data require API keys, or should public docs be used where possible?
- Should score explainability be shown to all users or behind an advanced panel?
- Should OpenRouter be considered a provider endpoint, an aggregator, or both depending on the model?

## 18. Recommended First Implementation Slice

The smallest valuable implementation is:

1. Add `recordType`, `primaryUseCases`, `secondaryUseCases`, `sourceAuthority`, and `linkStatus`.
2. Move seed placeholders such as `Realtime Voice Stack` out of the model registry.
3. Add capability-based fit while keeping the current weighted metric formula.
4. Add a curated override file for known frontier models and classification fixes.
5. Add UI badges for model type and source trust.

This fixes the most visible trust problems without rewriting the entire project.
