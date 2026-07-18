import type { ModelCategory, WeightKey, ModelProfile, RecommendedModel, PromptAnalysis } from '../types'
import { MIN_SCORE, defaultWeights, signalRules, localModelRegistry } from './constants'

// ─── Negation Detection ───
// Detects phrases like "I don't care about speed", "no need for privacy",
// "speed is not important", "ignore latency"
const negationPatterns: Array<{ pattern: RegExp; metric: WeightKey }> = [
  { pattern: /(?:don'?t|do not|no)\s+(?:care|need|worry|matter)\s+(?:about\s+)?(?:speed|latency|fast)/i, metric: 'speed' },
  { pattern: /(?:don'?t|do not|no)\s+(?:care|need|worry|matter)\s+(?:about\s+)?(?:cost|price|cheap|budget|afford)/i, metric: 'affordability' },
  { pattern: /(?:don'?t|do not|no)\s+(?:care|need|worry|matter)\s+(?:about\s+)?(?:quality|accuracy|reliable)/i, metric: 'quality' },
  { pattern: /(?:don'?t|do not|no)\s+(?:care|need|worry|matter)\s+(?:about\s+)?(?:privacy|private|secure)/i, metric: 'privacy' },
  { pattern: /(?:don'?t|do not|no)\s+(?:care|need|worry|matter)\s+(?:about\s+)?(?:context|length|window|long)/i, metric: 'context' },
  { pattern: /(?:speed|latency)\s+(?:is\s+)?(?:not|isn'?t)\s+(?:important|critical|a concern|needed|required)/i, metric: 'speed' },
  { pattern: /(?:cost|price|budget)\s+(?:is\s+)?(?:not|isn'?t)\s+(?:important|critical|a concern|needed|an issue)/i, metric: 'affordability' },
  { pattern: /(?:quality|accuracy)\s+(?:is\s+)?(?:not|isn'?t)\s+(?:important|critical|a concern|needed)/i, metric: 'quality' },
  { pattern: /(?:privacy|security)\s+(?:is\s+)?(?:not|isn'?t)\s+(?:important|critical|a concern|needed)/i, metric: 'privacy' },
  { pattern: /(?:ignore|skip)\s+(?:speed|latency)/i, metric: 'speed' },
  { pattern: /(?:ignore|skip)\s+(?:cost|price|budget)/i, metric: 'affordability' },
  { pattern: /(?:ignore|skip)\s+(?:privacy|security)/i, metric: 'privacy' },
]

// ─── Constraint Extraction ───
// Detects hard constraints embedded in natural language
function extractConstraints(text: string) {
  const constraints: {
    maxPrice?: number
    minContext?: number
    mustSelfHost?: boolean
    excludeModels: string[]
    excludeProviders: string[]
  } = { excludeModels: [], excludeProviders: [] }

  // Price constraints: "under $5", "less than $2 per million"
  const priceMatch = text.match(/(?:under|below|less than|max|maximum|at most)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:per\s*(?:million|m|1m))?/i)
  if (priceMatch) {
    constraints.maxPrice = parseFloat(priceMatch[1])
  }

  // Context constraints: "at least 128k context", "minimum 100k tokens"
  const contextMatch = text.match(/(?:at least|minimum|min)\s*(\d+)\s*(k)?/i)
  if (contextMatch) {
    let val = parseInt(contextMatch[1], 10)
    const hasK = contextMatch[2] && contextMatch[2].toLowerCase() === 'k'
    if (hasK || val < 1000) {
      val *= 1000
    }
    constraints.minContext = val
  }

  // Self-host requirements
  if (/\b(?:self[- ]?host(?:able|ing|ed|s)?|run locally|air[- ]?gap|locally|local|offline|air-gapped)\b/i.test(text)) {
    constraints.mustSelfHost = true
  }

  // Model exclusions: "not gpt-4o", "exclude claude"
  const excludeModelMatch = text.match(/(?:not|exclude|avoid|no)\s+(gpt-[\w.-]+|claude[\w.-]*|gemini[\w.-]*|deepseek[\w.-]*|llama[\w.-]*)/gi)
  if (excludeModelMatch) {
    for (const m of excludeModelMatch) {
      const modelName = m.replace(/^(?:not|exclude|avoid|no)\s+/i, '').trim()
      constraints.excludeModels.push(modelName.toLowerCase())
    }
  }

  // Provider exclusions: "no OpenAI", "avoid Google"
  const excludeProviderMatch = text.match(/(?:not|exclude|avoid|no)\s+(openai|anthropic|google|meta|mistral|cohere|deepseek)/gi)
  if (excludeProviderMatch) {
    for (const m of excludeProviderMatch) {
      const provider = m.replace(/^(?:not|exclude|avoid|no)\s+/i, '').trim()
      constraints.excludeProviders.push(provider.toLowerCase())
    }
  }

  return constraints
}

export function detectCategory(promptText: string): ModelCategory {
  const text = promptText.toLowerCase()
  if (/\b(code|coding|coder|repo|debug|test|typescript|python|developer|programming|pull request|database|develop|dev|software|rust|compiler|c\+\+|java|html|css)\b/.test(text)) {
    return 'code'
  }
  if (/\b(image|photo|picture|poster|logo|visual|ecommerce|product|thumbnail|design)\b/.test(text)) {
    return 'image'
  }
  if (/\b(music|song|track|beat|soundtrack|instrumental)\b/.test(text)) {
    return 'music'
  }
  if (/\b(voice|audio|speech|transcription|call|realtime|real time|narration|tts|stt|dubbing)\b/.test(text)) {
    return 'voice'
  }
  if (/\b(video|clip|film|cinematic|motion|ad|ads|reel|shorts|storyboard)\b/.test(text)) {
    return 'video'
  }
  if (/\b(document|pdf|contract|invoice|ocr|legal|paper|report|spreadsheet|slide|slides|docx)\b/.test(text)) {
    return 'document'
  }
  return 'general'
}

export function analyzePrompt(
  promptText: string,
  requestedCategory: ModelCategory | 'auto'
): PromptAnalysis {
  const cleanPrompt = String(promptText || '').trim()
  const category =
    requestedCategory && requestedCategory !== 'auto'
      ? requestedCategory
      : detectCategory(cleanPrompt)

  const weights = { ...defaultWeights }
  const signals: Array<{ id: string; label: string }> = []
  const lowered = cleanPrompt.toLowerCase()
  const requestedMetrics = new Set<WeightKey>()

  // ─── Detect negations first (suppress specific metrics) ───
  const negatedMetrics = new Set<WeightKey>()
  for (const np of negationPatterns) {
    if (np.pattern.test(lowered)) {
      negatedMetrics.add(np.metric)
    }
  }

  for (const rule of signalRules) {
    if (!rule.pattern.test(lowered)) {
      continue
    }

    signals.push({ id: rule.id, label: rule.label })

    for (const [key, delta] of Object.entries(rule.weights)) {
      const wKey = key as WeightKey
      // Skip boosting negated metrics
      if (negatedMetrics.has(wKey) && delta && delta > 0) {
        continue
      }
      weights[wKey] = (weights[wKey] || 0) + (delta || 0)
      if (delta && delta > 0) {
        requestedMetrics.add(wKey)
      }
    }
  }

  // Suppress negated metrics hard
  for (const metric of negatedMetrics) {
    weights[metric] = Math.max(0.05, weights[metric] * 0.15)
    requestedMetrics.delete(metric)
  }

  // Category specific adjustments (these also count as requested)
  if (category === 'image' || category === 'video' || category === 'music') {
    weights.quality += 0.35
    weights.availability += 0.2
    requestedMetrics.add('quality')
    requestedMetrics.add('availability')
  }

  if (category === 'voice') {
    weights.speed += 0.35
    requestedMetrics.add('speed')
  }

  // If the prompt has explicit keywords/signals, scale down non-requested weights
  if (signals.length > 0) {
    for (const key of Object.keys(weights)) {
      const wKey = key as WeightKey
      if (!requestedMetrics.has(wKey)) {
        weights[wKey] = weights[wKey] * 0.35
      }
      weights[wKey] = Math.max(0.05, weights[wKey])
    }
  }

  return {
    prompt: cleanPrompt,
    targetCategory: category,
    weights,
    signals,
  }
}

export function categoryFit(modelCategory: ModelCategory, targetCategory: ModelCategory) {
  if (modelCategory === targetCategory) return 1
  if (modelCategory === 'general' && ['code', 'document'].includes(targetCategory)) return 0.72
  if (targetCategory === 'general' && ['code', 'document', 'voice'].includes(modelCategory)) return 0.58
  return 0.16
}

const targetUseCaseAliases: Record<ModelCategory, string[]> = {
  general: ['general', 'agent'],
  code: ['code', 'agent'],
  image: ['image', 'vision', 'image_generation'],
  video: ['video', 'video_generation'],
  voice: ['voice', 'speech_to_text', 'text_to_speech'],
  music: ['music', 'music_generation'],
  document: ['document', 'rag', 'embedding', 'reranking'],
}

const hiddenRecordTypes = new Set(['strategy_template', 'placeholder'])

export function sourceTrustFactor(model: ModelProfile) {
  if (hiddenRecordTypes.has(model.recordType || '')) return 0
  if (!model.recordType && !model.sourceAuthority) return 1

  const authorityTrust: Record<string, number> = {
    first_party: 1,
    benchmark: 0.97,
    aggregator: 0.9,
    curated: 0.86,
    seed: 0.72,
    heuristic: 0.65,
  }
  const typeTrust: Record<string, number> = {
    api_model: 1,
    open_weight_model: 0.92,
    hosted_open_model: 0.86,
    hf_repo: 0.78,
    model_family: 0.7,
  }
  const linkTrust: Record<string, number> = {
    verified: 1,
    unverified: 0.96,
    catalog: 0.9,
    broken: 0.5,
  }

  const trust =
    (authorityTrust[model.sourceAuthority || ''] ?? 0.82) *
    (typeTrust[model.recordType || ''] ?? 0.82) *
    (linkTrust[model.linkStatus || ''] ?? 0.96)

  return Math.max(0.45, Math.min(1, trust))
}

export function capabilityFit(model: ModelProfile, targetCategory: ModelCategory) {
  const targetUseCases = targetUseCaseAliases[targetCategory] || [targetCategory]
  const primary = model.primaryUseCases || []
  const secondary = model.secondaryUseCases || []

  if (primary.some((useCase) => targetUseCases.includes(useCase))) return 1
  if (secondary.some((useCase) => targetUseCases.includes(useCase))) return 0.82

  return categoryFit(model.category, targetCategory)
}

function isCompatible(model: ModelProfile, targetCategory: ModelCategory): boolean {
  if (hiddenRecordTypes.has(model.recordType || '')) return false
  if (capabilityFit(model, targetCategory) >= 0.55) return true
  if (model.category === targetCategory) return true
  if (targetCategory === 'code') return model.category === 'general'
  if (targetCategory === 'document') return model.category === 'general' || model.category === 'code'
  if (targetCategory === 'general') return ['general', 'code', 'document', 'voice'].includes(model.category)
  return false
}

export function getLocalRecommendations(
  promptText: string,
  category: ModelCategory | 'auto',
  openOnly: boolean,
  maxPrice: string | number,
  customWeights: Record<WeightKey, number> | null
) {
  const analysis = analyzePrompt(promptText, category)

  // Apply custom weights override if provided
  if (customWeights) {
    analysis.isCustomized = true
    for (const [key, val] of Object.entries(customWeights)) {
      if (key in analysis.weights && typeof val === 'number' && !isNaN(val)) {
        analysis.weights[key as WeightKey] = val
      }
    }
  } else {
    analysis.isCustomized = false
  }

  // Extract constraints from prompt
  const constraints = extractConstraints(promptText)
  const maxPriceNum = maxPrice ? Number(maxPrice) : constraints.maxPrice ?? null

  const filtered = localModelRegistry
    .filter((model) => !hiddenRecordTypes.has(model.recordType || ''))
    .filter((model) => isCompatible(model, analysis.targetCategory))
    .filter((model) => !openOnly || model.access !== 'API')
    .filter((model) => {
      if (maxPriceNum === null || isNaN(maxPriceNum)) return true
      const price = model.pricing?.inputPerMillion
      return typeof price !== 'number' || price <= maxPriceNum
    })
    // Apply self-host constraint
    .filter((model) => {
      if (!constraints.mustSelfHost) return true
      return model.access === 'Open source'
    })
    // Apply context minimum constraint
    .filter((model) => {
      if (!constraints.minContext) return true
      return (model.contextLength ?? 0) >= constraints.minContext
    })
    .map((model) => {
      const weights = analysis.weights
      const weightSum = Object.values(weights).reduce((sum, w) => sum + w, 0)

      let metricScore = MIN_SCORE
      if (weightSum > 0) {
        const weightedSum = Object.entries(weights).reduce((sum, [key, weight]) => {
          const metric = model.metrics[key as WeightKey] ?? MIN_SCORE
          return sum + (weight * Math.max(metric, MIN_SCORE))
        }, 0)
        metricScore = weightedSum / weightSum
      }

      const fit = capabilityFit(model, analysis.targetCategory)
      const confidence = model.confidence ?? 0.52
      const sourceTrust = sourceTrustFactor(model)

      // Improved formula: configurable fit exponent, confidence matters more
      const fitFactor = Math.pow(fit, 1.3)
      const confidenceFactor = 0.65 + 0.35 * confidence
      const scaled = metricScore * fitFactor * confidenceFactor * sourceTrust * 100
      const score = Math.round(Math.max(1, Math.min(99, scaled)))

      const modelMetrics = Object.entries(model.metrics)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([name]) => name)

      const reasons: string[] = []
      if (capabilityFit(model, analysis.targetCategory) >= 0.95) {
        reasons.push(`Matches ${analysis.targetCategory} work`)
      }
      if (modelMetrics.includes('affordability')) reasons.push('Strong cost fit')
      if (modelMetrics.includes('speed')) reasons.push('Good latency profile')
      if (modelMetrics.includes('privacy')) reasons.push('Better privacy posture')
      if (modelMetrics.includes('context')) reasons.push('Useful long-context capacity')
      if (model.source) reasons.push(`Verified by ${model.source}`)

      return {
        ...model,
        fit,
        sourceTrust,
        score,
        reasons: reasons.slice(0, 4),
        warnings: model.linkStatus === 'catalog' ? ['Source link opens a catalog, not a model page'] : [],
      } as RecommendedModel
    })
    .sort((a, b) => b.score - a.score)

  const strategies = localModelRegistry
    .filter((model) => model.recordType === 'strategy_template' && (model.category === analysis.targetCategory || model.primaryUseCases?.includes(analysis.targetCategory)))
    .map((model) => ({
      id: model.id,
      name: model.name,
      useCase: model.category,
      description: model.bestFor,
      recommendedComponents: model.id === 'voice-agent' 
        ? ["Deepgram Nova-2 (STT)", "GPT-4o or Claude 3.5 Sonnet (LLM)", "ElevenLabs Reader/Multilingual v2 (TTS)"]
        : ["Cohere Embed v3 (Embeddings)", "Pinecone or pgvector (Database)", "Cohere Rerank v3 (Reranking)", "Claude 3.5 Sonnet (LLM)"],
      exampleProviders: model.id === 'voice-agent'
        ? ["Deepgram", "OpenAI", "ElevenLabs", "Gemini Live API"]
        : ["Cohere", "Pinecone", "Anthropic", "Voyage AI"]
    }))

  return {
    analysis,
    recommendations: filtered.slice(0, 16),
    strategies,
    totalMatches: filtered.length,
  }
}

// ─── Formatting Helpers ───

export function percentage(value: number) {
  return `${Math.round(value * 100)}%`
}

export function formatPricing(model: RecommendedModel | ModelProfile) {
  if (model.access !== 'API' || model.pricing?.unit === 'infrastructure') {
    return 'Self-hosted / Free'
  }
  const input = model.pricing?.inputPerMillion
  const output = model.pricing?.outputPerMillion
  if (typeof input !== 'number' || typeof output !== 'number' || (input === 0 && output === 0)) {
    return 'Free / No pricing data'
  }
  return `In: $${input.toFixed(2)} | Out: $${output.toFixed(2)} (per 1M)`
}

export function formatContext(contextLength: number | undefined) {
  if (!contextLength) return 'Unknown'
  if (contextLength >= 1000000) {
    return `${(contextLength / 1000000).toFixed(1)}M tokens`
  }
  if (contextLength >= 1000) {
    return `${Math.round(contextLength / 1000)}k tokens`
  }
  return `${contextLength} tokens`
}
