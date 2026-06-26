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

export function normalizeCategory(category) {
  return categories.includes(category) ? category : 'general'
}

export function detectCategory(prompt) {
  const text = String(prompt).toLowerCase()

  if (/(code|coding|coder|repo|debug|test|typescript|python|developer|programming|pull request|database|develop|dev|software)/.test(text)) {
    return 'code'
  }

  if (/(image|photo|picture|poster|logo|visual|ecommerce|product|thumbnail|design)/.test(text)) {
    return 'image'
  }

  if (/(video|clip|film|cinematic|motion|ad|reel|shorts|storyboard)/.test(text)) {
    return 'video'
  }

  if (/(voice|audio|speech|transcription|call|realtime|real time|narration|tts|stt|dubbing)/.test(text)) {
    return 'voice'
  }

  if (/(music|song|track|beat|soundtrack|instrumental)/.test(text)) {
    return 'music'
  }

  if (/(document|pdf|contract|invoice|ocr|legal|paper|report|spreadsheet|slide|docx)/.test(text)) {
    return 'document'
  }

  return 'general'
}

export function analyzePrompt(prompt, requestedCategory) {
  const cleanPrompt = String(prompt || '').trim()
  const category =
    requestedCategory && requestedCategory !== 'auto'
      ? normalizeCategory(requestedCategory)
      : detectCategory(cleanPrompt)

  const weights = { ...defaultWeights }
  const signals = []
  const lowered = cleanPrompt.toLowerCase()
  const requestedMetrics = new Set()

  for (const rule of signalRules) {
    if (!rule.pattern.test(lowered)) {
      continue
    }

    signals.push({ id: rule.id, label: rule.label })

    for (const [key, delta] of Object.entries(rule.weights)) {
      weights[key] = (weights[key] || 0) + delta
      if (delta > 0) {
        requestedMetrics.add(key)
      }
    }
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
      if (!requestedMetrics.has(key)) {
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
  }
}

export function categoryFit(modelCategory, targetCategory) {
  if (modelCategory === targetCategory) {
    return 1
  }

  if (modelCategory === 'general' && ['code', 'document'].includes(targetCategory)) {
    return 0.72
  }

  if (targetCategory === 'general' && ['code', 'document', 'voice'].includes(modelCategory)) {
    return 0.58
  }

  return 0.16
}

export function isCompatible(model, targetCategory) {
  // Exact match is always compatible
  if (model.category === targetCategory) return true

  // For code queries: only code + general models pass (never image/video/voice/music)
  if (targetCategory === 'code') {
    return model.category === 'general'
  }

  // For document queries: code + general models can also help
  if (targetCategory === 'document') {
    return model.category === 'general' || model.category === 'code'
  }

  // For general queries: include coding/document/voice-capable models
  if (targetCategory === 'general') {
    return ['general', 'code', 'document', 'voice'].includes(model.category)
  }

  // For image/video/voice/music: only exact match (already handled above)
  return false
}

export function weightedAdditiveScore(model, targetCategory, weights) {
  const weightSum = Object.values(weights).reduce((sum, w) => sum + w, 0)
  
  if (weightSum <= 0) return MIN_SCORE * 100

  const weightedSum = Object.entries(weights).reduce((sum, [key, weight]) => {
    const metric = model.metrics?.[key] ?? MIN_SCORE
    return sum + (weight * Math.max(metric, MIN_SCORE))
  }, 0)

  const metricScore = weightedSum / weightSum
  const fit = categoryFit(model.category, targetCategory)
  const confidence = model.confidence ?? 0.52

  const fitFactor = Math.pow(fit, 1.5)
  const confidenceFactor = 0.85 + 0.15 * confidence
  const scaled = metricScore * fitFactor * confidenceFactor * 100

  return Math.round(Math.max(1, Math.min(99, scaled)))
}

export function buildReasons(model, analysis) {
  const metrics = Object.entries(model.metrics || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => name)

  const reasons = []

  if (categoryFit(model.category, analysis.targetCategory) >= 0.95) {
    reasons.push(`Matches ${analysis.targetCategory} work`)
  }

  if (metrics.includes('affordability')) {
    reasons.push('Strong cost fit')
  }

  if (metrics.includes('speed')) {
    reasons.push('Good latency profile')
  }

  if (metrics.includes('privacy')) {
    reasons.push('Better privacy posture')
  }

  if (metrics.includes('context')) {
    reasons.push('Useful long-context capacity')
  }

  if (model.source && model.lastVerified) {
    reasons.push(`Verified by ${model.source}`)
  }

  return reasons.slice(0, 4)
}

export function recommendModels(models, request) {
  const analysis = analyzePrompt(request.prompt, request.category)
  
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
    : undefined

  const recommendations = models
    .filter((model) => isCompatible(model, analysis.targetCategory))
    .filter((model) => !openOnly || model.access !== 'API')
    .filter((model) => {
      if (maxPrice === undefined) {
        return true
      }

      const inputPrice = model.pricing?.inputPerMillion
      return typeof inputPrice !== 'number' || inputPrice <= maxPrice
    })
    .map((model) => ({
      ...model,
      fit: categoryFit(model.category, analysis.targetCategory),
      score: weightedAdditiveScore(model, analysis.targetCategory, analysis.weights),
      reasons: buildReasons(model, analysis),
    }))
    .sort((a, b) => b.score - a.score)

  return {
    analysis,
    recommendations: recommendations.slice(0, limit),
    totalMatches: recommendations.length,
  }
}

