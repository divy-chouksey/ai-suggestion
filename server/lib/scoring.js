/**
 * Scoring engine — overhauled
 *
 * Changes from original:
 *  - Negation detection ("I don't care about speed")
 *  - Constraint extraction from prompt text
 *  - LLM ParsedIntent integration (when available)
 *  - Fixed formula: Fit^1.3 (from 1.5), confidence 0.65+0.35*c (from 0.85+0.15*c)
 *  - Non-compensatory quality floor
 *  - Data-sourced buildReasons() with benchmark references
 *  - Structured filter acceptance (latency, privacy, context, modalities)
 */

import { parsePromptWithLLM, isLLMAvailable } from './llm-parser.js'
import { getFullBenchmark, derivePrivacyScore } from './benchmarks.js'

const MIN_SCORE = 0.08

export const categories = ['general', 'code', 'image', 'video', 'voice', 'music', 'document']

export const defaultWeights = {
  quality: 1.25,
  affordability: 0.75,
  speed: 0.7,
  context: 0.65,
  privacy: 0.55,
  availability: 0.6,
}

// ── Signal rules (regex-based keyword detection) ──
const signalRules = [
  {
    id: 'budgetSensitive',
    label: 'Budget sensitive',
    pattern: /(cheap|budget|cost|affordable|high volume|scale|low price|inexpensive)/,
    weights: { affordability: 0.9 },
  },
  {
    id: 'speedSensitive',
    label: 'Speed sensitive',
    pattern: /(fast|speed|latency|realtime|real time|instant|support|call|live)/,
    weights: { speed: 0.75 },
  },
  {
    id: 'qualitySensitive',
    label: 'Quality sensitive',
    pattern: /(best|accurate|quality|high stakes|legal|medical|finance|reasoning|critical|reliable)/,
    weights: { quality: 1.2, affordability: -0.35 },
  },
  {
    id: 'longContext',
    label: 'Long context',
    pattern: /(long|pdf|document|context|book|repo|many files|contract|thesis|manual)/,
    weights: { context: 0.85 },
  },
  {
    id: 'privacySensitive',
    label: 'Privacy sensitive',
    pattern: /(private|privacy|self-host|self host|local|offline|internal|sensitive|secure|confidential)/,
    weights: { privacy: 1.05 },
  },
]

// ── Negation patterns ──
const negationPatterns = [
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

// ── Constraint extraction from natural language ──
function extractConstraints(text) {
  const constraints = { excludeModels: [], excludeProviders: [] }

  const priceMatch = text.match(/(?:under|below|less than|max|maximum|at most)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:per\s*(?:million|m|1m))?/i)
  if (priceMatch) constraints.maxPrice = parseFloat(priceMatch[1])

  const contextMatch = text.match(/(?:at least|minimum|min)\s*(\d+)\s*(k)?/i)
  if (contextMatch) {
    let val = parseInt(contextMatch[1], 10)
    const hasK = contextMatch[2] && contextMatch[2].toLowerCase() === 'k'
    if (hasK || val < 1000) {
      val *= 1000
    }
    constraints.minContext = val
  }

  if (/\b(?:self[- ]?host(?:able|ing|ed|s)?|run locally|air[- ]?gap|locally|local|offline|air-gapped)\b/i.test(text)) {
    constraints.mustSelfHost = true
  }

  const excludeModelMatch = text.match(/(?:not|exclude|avoid|no)\s+(gpt-[\w.-]+|claude[\w.-]*|gemini[\w.-]*|deepseek[\w.-]*|llama[\w.-]*)/gi)
  if (excludeModelMatch) {
    for (const m of excludeModelMatch) {
      constraints.excludeModels.push(m.replace(/^(?:not|exclude|avoid|no)\s+/i, '').trim().toLowerCase())
    }
  }

  const excludeProviderMatch = text.match(/(?:not|exclude|avoid|no)\s+(openai|anthropic|google|meta|mistral|cohere|deepseek)/gi)
  if (excludeProviderMatch) {
    for (const m of excludeProviderMatch) {
      constraints.excludeProviders.push(m.replace(/^(?:not|exclude|avoid|no)\s+/i, '').trim().toLowerCase())
    }
  }

  return constraints
}

export function normalizeCategory(category) {
  return categories.includes(category) ? category : 'general'
}

export function detectCategory(prompt) {
  const text = String(prompt).toLowerCase()

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

/**
 * Analyze a prompt using regex rules + negation + constraint extraction.
 * This is the core regex-based path, always available.
 */
export function analyzePrompt(prompt, requestedCategory, parsedIntent = null) {
  const cleanPrompt = String(prompt || '').trim()

  // If LLM intent is available, use it as the primary source
  if (parsedIntent) {
    return analyzeWithIntent(cleanPrompt, requestedCategory, parsedIntent)
  }

  const category =
    requestedCategory && requestedCategory !== 'auto'
      ? normalizeCategory(requestedCategory)
      : detectCategory(cleanPrompt)

  const weights = { ...defaultWeights }
  const signals = []
  const lowered = cleanPrompt.toLowerCase()
  const requestedMetrics = new Set()

  // ── Detect negations ──
  const negatedMetrics = new Set()
  for (const np of negationPatterns) {
    if (np.pattern.test(lowered)) {
      negatedMetrics.add(np.metric)
    }
  }

  // ── Apply signal rules ──
  for (const rule of signalRules) {
    if (!rule.pattern.test(lowered)) continue

    signals.push({ id: rule.id, label: rule.label })

    for (const [key, delta] of Object.entries(rule.weights)) {
      // Skip boosting negated metrics
      if (negatedMetrics.has(key) && delta > 0) continue
      weights[key] = (weights[key] || 0) + delta
      if (delta > 0) requestedMetrics.add(key)
    }
  }

  // Suppress negated metrics hard
  for (const metric of negatedMetrics) {
    weights[metric] = Math.max(0.05, weights[metric] * 0.15)
    requestedMetrics.delete(metric)
  }

  // Category specific adjustments
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

  // Scale down non-requested weights
  if (signals.length > 0) {
    for (const key of Object.keys(weights)) {
      if (!requestedMetrics.has(key)) {
        weights[key] = weights[key] * 0.35
      }
      weights[key] = Math.max(0.05, weights[key])
    }
  }

  // Extract hard constraints from prompt text
  const constraints = extractConstraints(lowered)

  return {
    prompt: cleanPrompt,
    targetCategory: category,
    weights,
    signals,
    negatedMetrics: [...negatedMetrics],
    constraints,
    parserUsed: 'regex',
  }
}

/**
 * Analyze using LLM-provided ParsedIntent.
 * LLM priorities → weight boosts, negations → weight suppression, constraints → hard filters.
 */
function analyzeWithIntent(cleanPrompt, requestedCategory, intent) {
  const category =
    requestedCategory && requestedCategory !== 'auto'
      ? normalizeCategory(requestedCategory)
      : normalizeCategory(intent.category)

  const weights = { ...defaultWeights }
  const signals = []

  // Apply LLM-extracted priorities as weight boosts
  for (const priority of intent.priorities || []) {
    if (priority in weights) {
      weights[priority] += 0.8
      signals.push({ id: `llm-${priority}`, label: `${priority} priority (LLM)` })
    }
  }

  // Apply LLM-extracted negations
  for (const negation of intent.negations || []) {
    if (negation in weights) {
      weights[negation] = Math.max(0.05, weights[negation] * 0.15)
    }
  }

  // Category-specific adjustments
  if (category === 'image' || category === 'video' || category === 'music') {
    weights.quality += 0.35
    weights.availability += 0.2
  }
  if (category === 'voice') {
    weights.speed += 0.35
  }

  // Scale down non-priority weights when we have explicit signals
  if (intent.priorities?.length > 0) {
    const prioritySet = new Set(intent.priorities)
    for (const key of Object.keys(weights)) {
      if (!prioritySet.has(key)) {
        weights[key] = weights[key] * 0.35
      }
      weights[key] = Math.max(0.05, weights[key])
    }
  }

  return {
    prompt: cleanPrompt,
    targetCategory: category,
    weights,
    signals,
    negatedMetrics: intent.negations || [],
    constraints: intent.constraints || {},
    excludeProviders: intent.excludeProviders || [],
    excludeModels: intent.excludeModels || [],
    useCaseSummary: intent.useCaseSummary || '',
    parserUsed: intent.parserUsed || 'llm',
  }
}

export function categoryFit(modelCategory, targetCategory) {
  if (modelCategory === targetCategory) return 1
  if (modelCategory === 'general' && ['code', 'document'].includes(targetCategory)) return 0.72
  if (targetCategory === 'general' && ['code', 'document', 'voice'].includes(modelCategory)) return 0.58
  return 0.16
}

export function isCompatible(model, targetCategory) {
  if (model.category === targetCategory) return true
  if (targetCategory === 'code') return model.category === 'general'
  if (targetCategory === 'document') return model.category === 'general' || model.category === 'code'
  if (targetCategory === 'general') return ['general', 'code', 'document', 'voice'].includes(model.category)
  return false
}

/**
 * Fixed scoring formula:
 *  - Fit exponent: 1.3 (was 1.5, more balanced)
 *  - Confidence factor: 0.65 + 0.35 * confidence (was 0.85 + 0.15, makes confidence actually matter)
 *  - Non-compensatory: if quality-flagged and model.quality < 0.7, hard penalty
 */
export function weightedAdditiveScore(model, targetCategory, weights, qualityFlagged = false) {
  const weightSum = Object.values(weights).reduce((sum, w) => sum + w, 0)

  if (weightSum <= 0) return MIN_SCORE * 100

  const weightedSum = Object.entries(weights).reduce((sum, [key, weight]) => {
    const metric = model.metrics?.[key] ?? MIN_SCORE
    return sum + (weight * Math.max(metric, MIN_SCORE))
  }, 0)

  const metricScore = weightedSum / weightSum
  const fit = categoryFit(model.category, targetCategory)
  const confidence = model.confidence ?? 0.52

  const fitFactor = Math.pow(fit, 1.3)
  const confidenceFactor = 0.65 + 0.35 * confidence

  let scaled = metricScore * fitFactor * confidenceFactor * 100

  // Non-compensatory: quality floor when quality is flagged as important
  if (qualityFlagged && (model.metrics?.quality ?? 0) < 0.7) {
    scaled *= 0.6 // Hard penalty for low-quality models when quality matters
  }

  return Math.round(Math.max(1, Math.min(99, scaled)))
}

/**
 * Improved reason builder — more specific, data-sourced reasons.
 */
export function buildReasons(model, analysis) {
  const reasons = []
  const metrics = model.metrics || {}

  // Category match
  if (categoryFit(model.category, analysis.targetCategory) >= 0.95) {
    reasons.push(`Specialized for ${analysis.targetCategory} workflows`)
  }

  // Benchmark-based reasons
  const benchmark = getFullBenchmark(`${model.id} ${model.name}`)
  if (benchmark) {
    if (benchmark.arena && benchmark.arena >= 1280) {
      reasons.push(`Top-tier: Arena Elo ${benchmark.arena}`)
    } else if (benchmark.arena && benchmark.arena >= 1200) {
      reasons.push(`Strong performer: Arena Elo ${benchmark.arena}`)
    }
    if (benchmark.humaneval && benchmark.humaneval >= 0.9) {
      reasons.push(`${Math.round(benchmark.humaneval * 100)}% HumanEval pass rate`)
    }
    if (benchmark.tps && benchmark.tps >= 150) {
      reasons.push(`Fast: ${benchmark.tps} tokens/sec`)
    }
  }

  // Metric-based reasons (only when no benchmark data)
  if (reasons.length < 2) {
    const sorted = Object.entries(metrics)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name)

    if (sorted.includes('affordability') && metrics.affordability >= 0.8) {
      const price = model.pricing?.inputPerMillion
      if (typeof price === 'number' && price > 0) {
        reasons.push(`Cost-effective at $${price.toFixed(2)}/M input tokens`)
      } else {
        reasons.push('Strong cost fit')
      }
    }
    if (sorted.includes('speed') && metrics.speed >= 0.8) {
      reasons.push('Low-latency response profile')
    }
    if (sorted.includes('privacy') && metrics.privacy >= 0.8) {
      reasons.push('Self-hostable for private deployments')
    }
    if (sorted.includes('context') && metrics.context >= 0.8) {
      const ctx = model.contextLength
      if (ctx >= 1000000) {
        reasons.push(`${(ctx / 1000000).toFixed(1)}M token context window`)
      } else if (ctx >= 100000) {
        reasons.push(`${Math.round(ctx / 1000)}k token context window`)
      } else {
        reasons.push('Useful long-context capacity')
      }
    }
  }

  // Source verification
  if (model.source && model.source !== 'Seed registry') {
    reasons.push(`Data from ${model.source}`)
  }

  return reasons.slice(0, 4)
}

// ── Context need mapping ──
const CONTEXT_NEED_MAP = {
  'short': 0,
  'medium': 32000,
  'large': 128000,
  'massive': 1000000,
}

// ── Latency → speed score mapping ──
const LATENCY_SPEED_MAP = {
  'realtime': 0.88,
  'fast': 0.75,
  'standard': 0.5,
  'any': 0,
}

/**
 * Main recommendation function — overhauled.
 * 
 * Accepts structured filters alongside prompt for combined NLP + structured filtering.
 * Optionally calls LLM parser for rich intent extraction.
 */
export async function recommendModels(models, request) {
  let parsedIntent = null
  let parserUsed = 'regex'

  // ── Try LLM parsing if available ──
  if (isLLMAvailable() && request.prompt && String(request.prompt).trim().length >= 5) {
    try {
      parsedIntent = await parsePromptWithLLM(request.prompt)
      if (parsedIntent) {
        parserUsed = parsedIntent.parserUsed || 'llm'
      }
    } catch (err) {
      console.warn('[scoring] LLM parsing failed, using regex:', err.message)
    }
  }

  const analysis = analyzePrompt(request.prompt, request.category, parsedIntent)

  // Apply custom weights override if provided in request
  if (request.weights && typeof request.weights === 'object') {
    analysis.isCustomized = true
    for (const [key, val] of Object.entries(request.weights)) {
      if (key in analysis.weights && typeof val === 'number' && !isNaN(val)) {
        analysis.weights[key] = val
      }
    }
  } else {
    analysis.isCustomized = false
  }

  const limit = Number.isFinite(Number(request.limit)) ? Math.min(Math.max(Number(request.limit), 1), 24) : 8
  const openOnly = Boolean(request.openOnly)
  const maxPrice = Number.isFinite(Number(request.maxInputPricePerMillion))
    ? Number(request.maxInputPricePerMillion)
    : (analysis.constraints?.maxPrice ?? undefined)

  // ── Merge structured filters from frontend ──
  const filters = request.filters || {}
  const minContext = analysis.constraints?.minContext || CONTEXT_NEED_MAP[filters.contextNeed] || 0
  const mustSelfHost = analysis.constraints?.mustSelfHost || filters.privacy === 'self-host' || filters.privacy === 'air-gapped'
  const minSpeed = LATENCY_SPEED_MAP[filters.latency] || 0
  const excludeProviders = new Set([...(analysis.excludeProviders || []), ...(request.excludeProviders || [])])
  const excludeModels = new Set([...(analysis.excludeModels || []), ...(request.excludeModels || [])])

  // If budget specified in structured filters, use it
  const effectiveMaxPrice = maxPrice ?? (filters.budget >= 0 ? filters.budget : undefined)

  // Detect if quality was flagged as important
  const qualityFlagged = analysis.weights.quality >= 2.0

  const recommendations = models
    // ── Category compatibility ──
    .filter((model) => isCompatible(model, analysis.targetCategory))
    // ── Open-only filter ──
    .filter((model) => !openOnly || model.access !== 'API')
    // ── Self-host constraint ──
    .filter((model) => !mustSelfHost || model.access === 'Open source')
    // ── Price filter ──
    .filter((model) => {
      if (effectiveMaxPrice === undefined) return true
      const inputPrice = model.pricing?.inputPerMillion
      return typeof inputPrice !== 'number' || inputPrice <= effectiveMaxPrice
    })
    // ── Context minimum ──
    .filter((model) => {
      if (!minContext) return true
      return (model.contextLength || 0) >= minContext
    })
    // ── Speed minimum ──
    .filter((model) => {
      if (!minSpeed) return true
      return (model.metrics?.speed ?? 0) >= minSpeed
    })
    // ── Exclude providers ──
    .filter((model) => {
      if (excludeProviders.size === 0) return true
      const provider = String(model.provider || '').toLowerCase()
      for (const ex of excludeProviders) {
        if (provider.includes(ex)) return false
      }
      return true
    })
    // ── Exclude models ──
    .filter((model) => {
      if (excludeModels.size === 0) return true
      const name = String(model.name || '').toLowerCase()
      const id = String(model.id || '').toLowerCase()
      for (const ex of excludeModels) {
        if (name.includes(ex) || id.includes(ex)) return false
      }
      return true
    })
    // ── Modality filter ──
    .filter((model) => {
      if (!filters.modalities?.length) return true
      const modelMods = (model.modalities || []).map(m => m.toLowerCase())
      return filters.modalities.every(required => modelMods.some(m => m.includes(required.toLowerCase())))
    })
    // ── Privacy filter for structured input ──
    .filter((model) => {
      if (!filters.privacy || filters.privacy === 'cloud-ok') return true
      if (filters.privacy === 'no-training') {
        return (model.metrics?.privacy ?? 0) >= 0.5
      }
      return true // self-host/air-gapped already handled above
    })
    // ── Score and sort ──
    .map((model) => ({
      ...model,
      fit: categoryFit(model.category, analysis.targetCategory),
      score: weightedAdditiveScore(model, analysis.targetCategory, analysis.weights, qualityFlagged),
      reasons: buildReasons(model, analysis),
    }))
    .sort((a, b) => b.score - a.score)

  return {
    analysis,
    recommendations: recommendations.slice(0, limit),
    totalMatches: recommendations.length,
    parserUsed,
  }
}
