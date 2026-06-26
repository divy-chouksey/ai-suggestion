import { useEffect, useState, useCallback, useRef } from 'react'
import './App.css'

type ModelCategory =
  | 'general'
  | 'code'
  | 'image'
  | 'video'
  | 'voice'
  | 'music'
  | 'document'

type ModelProfile = {
  id: string
  name: string
  provider: string
  category: ModelCategory
  access: 'API' | 'Open source' | 'Hosted open model'
  modalities: string[]
  bestFor: string
  source: string
  sourceUrl?: string
  lastVerified?: string
  confidence?: number
  pricing?: {
    unit: string
    inputPerMillion: number
    outputPerMillion: number
  }
  contextLength?: number
  metrics: {
    quality: number
    affordability: number
    speed: number
    context: number
    privacy: number
    availability: number
  }
}

type RecommendedModel = ModelProfile & {
  fit: number
  score: number
  reasons?: string[]
}

type WeightKey = keyof ModelProfile['metrics']

type SyncLog = {
  timestamp: string
  sources: string[]
  results: Array<{ source: string; ok: boolean; count?: number; error?: string }>
  added: number
  updated: number
  modelCount: number
}

const MIN_SCORE = 0.08

const quickPrompts = [
  'Best cheap model for customer support chat',
  'Private coding assistant for our internal repo',
  'Long PDF contract analysis with high accuracy',
  'Generate product images for an ecommerce campaign',
  'Fast realtime voice agent for appointments',
  'Video model for short social ads',
]

const categoryLabels: Record<ModelCategory, string> = {
  general: 'General',
  code: 'Code',
  image: 'Image',
  video: 'Video',
  voice: 'Voice',
  music: 'Music',
  document: 'Document',
}

const defaultWeights: Record<WeightKey, number> = {
  quality: 1.25,
  affordability: 0.75,
  speed: 0.7,
  context: 0.65,
  privacy: 0.55,
  availability: 0.6,
}

// Provider logo URLs
const providerLogos: Record<string, string> = {
  'openai': 'https://cdn.worldvectorlogo.com/logos/openai-2.svg',
  'anthropic': 'https://upload.wikimedia.org/wikipedia/commons/7/78/Anthropic_logo.svg',
  'google': 'https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690b6.svg',
  'deepseek': 'https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/dark/deepseek-color.png',
  'hugging face': 'https://huggingface.co/front/assets/huggingface_logo-noborder.svg',
  'stability': 'https://images.crunchbase.com/image/upload/c_pad,h_40,w_40,f_auto,q_auto:eco,dpr_1/v1669768198/hrrh5csxlojrdsdz5tpy.png',
  'runway': 'https://upload.wikimedia.org/wikipedia/commons/7/7b/Runway_AI_logo.png',
  'elevenlabs': 'https://images.crunchbase.com/image/upload/c_pad,h_40,w_40,f_auto,q_auto:eco,dpr_1/rclwq0gxrpsxvfhbnsga.png',
  'cohere': 'https://images.crunchbase.com/image/upload/c_pad,h_40,w_40,f_auto,q_auto:eco,dpr_1/v1488397626/bwwxusmuigk2dcuphzij.png',
  'suno': 'https://images.crunchbase.com/image/upload/c_pad,h_40,w_40,f_auto,q_auto:eco,dpr_1/dydac0rgixm20dw2lgbm.png',
  'mistral': 'https://upload.wikimedia.org/wikipedia/commons/e/e6/Mistral_AI_logo_%282025%29.svg',
  'meta': 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Meta-Logo.png',
  'black forest': 'https://cdn.prod.website-files.com/66f383c1a1ba3e4fa0c61ed6/66f39fa17d3f2d0be3cc5d80_BFL_icon.svg',
}

function getProviderLogo(provider: string): string | null {
  const providerLower = provider.toLowerCase()
  for (const [key, url] of Object.entries(providerLogos)) {
    if (providerLower.includes(key)) return url
  }
  // Fallback: try first word
  const firstWord = providerLower.split(/[\s/]/)[0]
  if (providerLogos[firstWord]) return providerLogos[firstWord]
  return null
}

// Fallback seed data in case API server is unreachable
const localModelRegistry: ModelProfile[] = [
  {
    id: 'frontier-generalist',
    name: 'Frontier Generalist API',
    provider: 'OpenAI / Anthropic / Google class',
    category: 'general',
    access: 'API',
    modalities: ['text', 'vision', 'tools'],
    bestFor: 'High stakes reasoning, planning, rich conversation, and mixed knowledge work.',
    source: 'Seed registry',
    sourceUrl: 'https://openrouter.ai/api/v1/models',
    lastVerified: '2026-06-26T00:00:00.000Z',
    confidence: 0.76,
    pricing: {
      unit: 'estimated',
      inputPerMillion: 5,
      outputPerMillion: 15,
    },
    contextLength: 200000,
    metrics: {
      quality: 0.94,
      affordability: 0.46,
      speed: 0.62,
      context: 0.88,
      privacy: 0.54,
      availability: 0.9,
    },
  },
  {
    id: 'fast-generalist',
    name: 'Fast Generalist API',
    provider: 'OpenRouter multi-provider route',
    category: 'general',
    access: 'API',
    modalities: ['text', 'tools'],
    bestFor: 'Customer support, summarization, research triage, and high volume chat.',
    source: 'Seed registry',
    sourceUrl: 'https://openrouter.ai/api/v1/models',
    lastVerified: '2026-06-26T00:00:00.000Z',
    confidence: 0.78,
    pricing: {
      unit: 'estimated',
      inputPerMillion: 0.25,
      outputPerMillion: 1.0,
    },
    contextLength: 128000,
    metrics: {
      quality: 0.76,
      affordability: 0.86,
      speed: 0.92,
      context: 0.7,
      privacy: 0.5,
      availability: 0.88,
    },
  },
  {
    id: 'code-specialist',
    name: 'Code Specialist Model',
    provider: 'OpenAI / Anthropic / DeepSeek class',
    category: 'code',
    access: 'API',
    modalities: ['text', 'code', 'tools'],
    bestFor: 'Repository edits, debugging, test generation, migrations, and code review.',
    source: 'Seed registry',
    sourceUrl: 'https://openrouter.ai/api/v1/models',
    lastVerified: '2026-06-26T00:00:00.000Z',
    confidence: 0.74,
    pricing: {
      unit: 'estimated',
      inputPerMillion: 2.0,
      outputPerMillion: 8.0,
    },
    contextLength: 200000,
    metrics: {
      quality: 0.9,
      affordability: 0.58,
      speed: 0.68,
      context: 0.84,
      privacy: 0.48,
      availability: 0.82,
    },
  },
  {
    id: 'open-code',
    name: 'Open Code Model',
    provider: 'Hugging Face ecosystem',
    category: 'code',
    access: 'Open source',
    modalities: ['text', 'code'],
    bestFor: 'Self-hosted developer tools, internal code search, and private repos.',
    source: 'Seed registry',
    sourceUrl: 'https://huggingface.co/models',
    lastVerified: '2026-06-26T00:00:00.000Z',
    confidence: 0.7,
    pricing: {
      unit: 'infrastructure',
      inputPerMillion: 0,
      outputPerMillion: 0,
    },
    contextLength: 64000,
    metrics: {
      quality: 0.72,
      affordability: 0.93,
      speed: 0.66,
      context: 0.62,
      privacy: 0.92,
      availability: 0.74,
    },
  },
  {
    id: 'image-creator',
    name: 'Image Generation Studio',
    provider: 'OpenAI / Stability / Black Forest class',
    category: 'image',
    access: 'API',
    modalities: ['image', 'editing'],
    bestFor: 'Product imagery, campaigns, concept art, editing, and style exploration.',
    source: 'Seed registry',
    sourceUrl: 'https://huggingface.co/models?pipeline_tag=text-to-image',
    lastVerified: '2026-06-26T00:00:00.000Z',
    confidence: 0.68,
    pricing: {
      unit: 'estimated',
      inputPerMillion: 0,
      outputPerMillion: 0,
    },
    contextLength: 8000,
    metrics: {
      quality: 0.88,
      affordability: 0.6,
      speed: 0.72,
      context: 0.42,
      privacy: 0.48,
      availability: 0.8,
    },
  },
  {
    id: 'video-creator',
    name: 'Video Generation Model',
    provider: 'Runway / Google / OpenAI class',
    category: 'video',
    access: 'API',
    modalities: ['video', 'image'],
    bestFor: 'Short cinematic clips, ads, storyboards, product shots, and motion tests.',
    source: 'Seed registry',
    sourceUrl: 'https://huggingface.co/models?pipeline_tag=image-to-video',
    lastVerified: '2026-06-26T00:00:00.000Z',
    confidence: 0.58,
    pricing: {
      unit: 'estimated',
      inputPerMillion: 0,
      outputPerMillion: 0,
    },
    contextLength: 8000,
    metrics: {
      quality: 0.84,
      affordability: 0.34,
      speed: 0.32,
      context: 0.36,
      privacy: 0.42,
      availability: 0.58,
    },
  },
  {
    id: 'voice-agent',
    name: 'Realtime Voice Stack',
    provider: 'OpenAI / ElevenLabs / Deepgram class',
    category: 'voice',
    access: 'API',
    modalities: ['audio', 'speech', 'text'],
    bestFor: 'Voice agents, narration, transcription, dubbing, and conversational audio.',
    source: 'Seed registry',
    sourceUrl: 'https://huggingface.co/models?pipeline_tag=automatic-speech-recognition',
    lastVerified: '2026-06-26T00:00:00.000Z',
    confidence: 0.66,
    pricing: {
      unit: 'estimated',
      inputPerMillion: 0,
      outputPerMillion: 0,
    },
    contextLength: 16000,
    metrics: {
      quality: 0.83,
      affordability: 0.64,
      speed: 0.88,
      context: 0.5,
      privacy: 0.5,
      availability: 0.76,
    },
  },
  {
    id: 'music-generator',
    name: 'Music Generation Model',
    provider: 'Suno / Udio class',
    category: 'music',
    access: 'API',
    modalities: ['audio', 'music'],
    bestFor: 'Song sketches, background tracks, sonic branding, and creative ideation.',
    source: 'Seed registry',
    sourceUrl: 'https://huggingface.co/models?pipeline_tag=text-to-audio',
    lastVerified: '2026-06-26T00:00:00.000Z',
    confidence: 0.52,
    pricing: {
      unit: 'estimated',
      inputPerMillion: 0,
      outputPerMillion: 0,
    },
    contextLength: 8000,
    metrics: {
      quality: 0.8,
      affordability: 0.52,
      speed: 0.56,
      context: 0.28,
      privacy: 0.38,
      availability: 0.62,
    },
  },
  {
    id: 'document-intelligence',
    name: 'Document Intelligence Model',
    provider: 'Google / OpenAI / Mistral class',
    category: 'document',
    access: 'API',
    modalities: ['text', 'vision', 'ocr'],
    bestFor: 'Long PDFs, OCR, extraction, compliance checks, and document Q&A.',
    source: 'Seed registry',
    sourceUrl: 'https://openrouter.ai/api/v1/models',
    lastVerified: '2026-06-26T00:00:00.000Z',
    confidence: 0.7,
    pricing: {
      unit: 'estimated',
      inputPerMillion: 1.25,
      outputPerMillion: 5.0,
    },
    contextLength: 1000000,
    metrics: {
      quality: 0.86,
      affordability: 0.62,
      speed: 0.7,
      context: 0.94,
      privacy: 0.56,
      availability: 0.78,
    },
  },
  {
    id: 'private-open-general',
    name: 'Private Open Generalist',
    provider: 'Hugging Face / local inference',
    category: 'general',
    access: 'Open source',
    modalities: ['text'],
    bestFor: 'Private workflows, internal copilots, offline use, and custom fine-tuning.',
    source: 'Seed registry',
    sourceUrl: 'https://huggingface.co/models',
    lastVerified: '2026-06-26T00:00:00.000Z',
    confidence: 0.68,
    pricing: {
      unit: 'infrastructure',
      inputPerMillion: 0,
      outputPerMillion: 0,
    },
    contextLength: 32000,
    metrics: {
      quality: 0.68,
      affordability: 0.9,
      speed: 0.58,
      context: 0.58,
      privacy: 0.98,
      availability: 0.7,
    },
  },
  {
    id: 'embedding-rerank-stack',
    name: 'Embedding + Rerank Stack',
    provider: 'Cohere / Jina / OpenAI class',
    category: 'document',
    access: 'API',
    modalities: ['embedding', 'rerank', 'text'],
    bestFor: 'Search, RAG retrieval, semantic clustering, deduplication, and document matching.',
    source: 'Seed registry',
    sourceUrl: 'https://huggingface.co/models?pipeline_tag=sentence-similarity',
    lastVerified: '2026-06-26T00:00:00.000Z',
    confidence: 0.64,
    pricing: {
      unit: 'estimated',
      inputPerMillion: 0.1,
      outputPerMillion: 0,
    },
    contextLength: 8192,
    metrics: {
      quality: 0.78,
      affordability: 0.88,
      speed: 0.9,
      context: 0.46,
      privacy: 0.58,
      availability: 0.82,
    },
  },
]

type SignalRule = {
  id: string
  label: string
  pattern: RegExp
  weights: Partial<Record<WeightKey, number>>
}

const signalRules: SignalRule[] = [
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

// Fallback helper functions for client-side evaluation
function detectCategory(promptText: string): ModelCategory {
  const text = promptText.toLowerCase()
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

function analyzePrompt(promptText: string, requestedCategory: ModelCategory | 'auto') {
  const cleanPrompt = String(promptText || '').trim()
  const category =
    requestedCategory && requestedCategory !== 'auto'
      ? requestedCategory
      : detectCategory(cleanPrompt)

  const weights = { ...defaultWeights }
  const signals: Array<{ id: string; label: string }> = []
  const lowered = cleanPrompt.toLowerCase()
  const requestedMetrics = new Set<WeightKey>()

  for (const rule of signalRules) {
    if (!rule.pattern.test(lowered)) {
      continue
    }

    signals.push({ id: rule.id, label: rule.label })

    for (const [key, delta] of Object.entries(rule.weights)) {
      const wKey = key as WeightKey
      weights[wKey] = (weights[wKey] || 0) + (delta || 0)
      if (delta && delta > 0) {
        requestedMetrics.add(wKey)
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

function categoryFit(modelCategory: ModelCategory, targetCategory: ModelCategory) {
  if (modelCategory === targetCategory) return 1
  if (modelCategory === 'general' && ['code', 'document'].includes(targetCategory)) return 0.72
  if (targetCategory === 'general' && ['code', 'document', 'voice'].includes(modelCategory)) return 0.58
  return 0.16
}

function getLocalRecommendations(
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

  const maxPriceNum = maxPrice ? Number(maxPrice) : null

  const filtered = localModelRegistry
    .filter((model) => !openOnly || model.access !== 'API')
    .filter((model) => {
      if (maxPriceNum === null || isNaN(maxPriceNum)) return true
      const price = model.pricing?.inputPerMillion
      return typeof price !== 'number' || price <= maxPriceNum
    })
    .filter((model) => {
      if (analysis.targetCategory === 'general') {
        return ['general', 'code', 'document', 'voice'].includes(model.category)
      }
      if (model.category === analysis.targetCategory) return true
      return model.category === 'general' && ['code', 'document'].includes(analysis.targetCategory)
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

      const fit = categoryFit(model.category, analysis.targetCategory)
      const confidence = model.confidence ?? 0.52

      const fitFactor = Math.pow(fit, 1.5)
      const confidenceFactor = 0.85 + 0.15 * confidence
      const scaled = metricScore * fitFactor * confidenceFactor * 100
      const score = Math.round(Math.max(1, Math.min(99, scaled)))

      const modelMetrics = Object.entries(model.metrics)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([name]) => name)

      const reasons = []
      if (categoryFit(model.category, analysis.targetCategory) >= 0.95) {
        reasons.push(`Matches ${analysis.targetCategory} work`)
      }
      if (modelMetrics.includes('affordability')) reasons.push('Strong cost fit')
      if (modelMetrics.includes('speed')) reasons.push('Good latency profile')
      if (modelMetrics.includes('privacy')) reasons.push('Better privacy posture')
      if (modelMetrics.includes('context')) reasons.push('Useful long-context capacity')
      if (model.source) reasons.push(`Verified by ${model.source}`)

      return {
        ...model,
        fit: categoryFit(model.category, analysis.targetCategory),
        score,
        reasons: reasons.slice(0, 4),
      }
    })
    .sort((a, b) => b.score - a.score)

  return {
    analysis,
    recommendations: filtered.slice(0, 8),
    totalMatches: filtered.length,
  }
}

function percentage(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatPricing(model: RecommendedModel) {
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

function formatContext(contextLength: number | undefined) {
  if (!contextLength) return 'Unknown'
  if (contextLength >= 1000000) {
    return `${(contextLength / 1000000).toFixed(1)}M tokens`
  }
  if (contextLength >= 1000) {
    return `${Math.round(contextLength / 1000)}k tokens`
  }
  return `${contextLength} tokens`
}

function App() {
  const [prompt, setPrompt] = useState('')
  const [activeCategory, setActiveCategory] = useState<ModelCategory | 'auto'>('auto')
  const [openOnly, setOpenOnly] = useState(false)
  const [maxPrice, setMaxPrice] = useState<string>('')
  const [customWeights, setCustomWeights] = useState<Record<WeightKey, number> | null>(null)

  // Whether user has submitted a prompt (controls reveal)
  const [hasSubmitted, setHasSubmitted] = useState(false)

  // API Integration States
  const [recommendations, setRecommendations] = useState<RecommendedModel[]>([])
  const [analysis, setAnalysis] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFallback, setIsFallback] = useState(false)

  // Syncing states
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState('')
  const [syncHistory, setSyncHistory] = useState<SyncLog[]>([])
  const [registryStats, setRegistryStats] = useState({
    modelCount: 0,
    lastUpdated: '',
  })

  const inputRef = useRef<HTMLInputElement>(null)

  // Core API Fetch Function
  const fetchRecommendations = useCallback(
    async (
      currentPrompt: string,
      currentCategory: string,
      currentOpenOnly: boolean,
      currentMaxPrice: string,
      currentWeights: Record<WeightKey, number> | null
    ) => {
      setLoading(true)
      setError(null)
      try {
        const payload: any = {
          prompt: currentPrompt,
          category: currentCategory,
          openOnly: currentOpenOnly,
        }
        if (currentMaxPrice.trim() !== '') {
          payload.maxInputPricePerMillion = Number(currentMaxPrice)
        }
        if (currentWeights) {
          payload.weights = currentWeights
        }

        const res = await fetch('/api/recommendations', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        })

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          throw new Error(errData.error || `Server responded with status ${res.status}`)
        }

        const data = await res.json()
        setRecommendations(data.recommendations || [])
        setAnalysis(data.analysis || null)
        setIsFallback(false)
        if (data.registry) {
          setRegistryStats({
            modelCount: data.registry.modelCount,
            lastUpdated: data.registry.lastUpdated,
          })
        }
      } catch (err: any) {
        console.warn('API error, falling back to local computation:', err.message)
        // Fall back to local evaluation
        const fallbackData = getLocalRecommendations(
          currentPrompt,
          currentCategory as ModelCategory | 'auto',
          currentOpenOnly,
          currentMaxPrice,
          currentWeights
        )
        setRecommendations(fallbackData.recommendations)
        setAnalysis(fallbackData.analysis)
        setIsFallback(true)
      } finally {
        setLoading(false)
      }
    },
    []
  )

  // Fetch Sync History
  const fetchSyncHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/sources')
      if (res.ok) {
        const data = await res.json()
        setSyncHistory(data.history || [])
        if (data.history && data.history.length > 0) {
          setRegistryStats((prev) => ({
            ...prev,
            modelCount: data.history[0].modelCount || prev.modelCount,
            lastUpdated: data.history[0].timestamp || prev.lastUpdated,
          }))
        }
      }
    } catch (err) {
      console.warn('Failed to load sync history:', err)
    }
  }, [])

  // Sync Registry Trigger
  const triggerSync = async () => {
    if (syncing) return
    setSyncing(true)
    setSyncStatus('Connecting to API and syncing OpenRouter & Hugging Face registries...')
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ limit: 120 }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setSyncStatus(`Sync finished! Added ${data.added} models, updated ${data.updated} models.`)
        fetchSyncHistory()
        fetchRecommendations(prompt, activeCategory, openOnly, maxPrice, customWeights)
      } else {
        setSyncStatus(`Sync failed: ${data.error || 'Server error'}`)
      }
    } catch (err: any) {
      setSyncStatus(`Sync error: ${err.message || 'Server unreachable'}`)
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncStatus(''), 7000)
    }
  }

  // Load sync history on mount
  useEffect(() => {
    fetchSyncHistory()
  }, [fetchSyncHistory])

  // Debounced effect for recommendation retrieval — only after submission
  useEffect(() => {
    if (!hasSubmitted) return
    const timer = setTimeout(() => {
      if (prompt.trim().length >= 3) {
        fetchRecommendations(prompt, activeCategory, openOnly, maxPrice, customWeights)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [prompt, activeCategory, openOnly, maxPrice, customWeights, fetchRecommendations, hasSubmitted])

  // Scroll reveal intersection observer for recommended model cards
  useEffect(() => {
    if (recommendations.length === 0) return

    const timer = setTimeout(() => {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible')
              observer.unobserve(entry.target)
            }
          })
        },
        {
          threshold: 0.05,
          rootMargin: '0px 0px -40px 0px',
        }
      )

      const cards = document.querySelectorAll('.model-card')
      cards.forEach((card) => observer.observe(card))

      return () => {
        cards.forEach((card) => observer.unobserve(card))
      }
    }, 100)

    return () => clearTimeout(timer)
  }, [recommendations])

  // Handle prompt submission
  const handleSubmit = () => {
    if (prompt.trim().length < 3) return
    setHasSubmitted(true)
    fetchRecommendations(prompt, activeCategory, openOnly, maxPrice, customWeights)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Handle manual weight slider modification
  const handleWeightChange = (key: WeightKey, val: number) => {
    const base = customWeights || analysis?.weights || defaultWeights
    setCustomWeights({
      ...base,
      [key]: val,
    })
  }

  const resetWeights = () => {
    setCustomWeights(null)
  }

  const targetCategory = (analysis?.targetCategory || (activeCategory === 'auto' ? detectCategory(prompt) : activeCategory)) as ModelCategory
  const displayedWeights = (customWeights || analysis?.weights || defaultWeights) as Record<WeightKey, number>
  const winner = recommendations.length > 0 ? recommendations[0] : null

  return (
    <main className={`app-shell ${hasSubmitted ? 'revealed' : ''}`}>
      <div className="motion-field" aria-hidden="true" />

      <header className={`topbar ${hasSubmitted ? 'topbar-compact' : ''}`}>
        <a className="brand" href="/" aria-label="Model Compass home">
          <span className="brand-mark">MC</span>
          <span>
            <strong>Model Compass</strong>
            <small>Dynamic AI model advisor</small>
          </span>
        </a>
        <nav className={`topbar-actions ${hasSubmitted ? '' : 'topbar-actions-hidden'}`} aria-label="Primary">
          <a href="#registry">Registry</a>
          <a href="#scoring">Scoring</a>
          <button
            className={`ghost-button sync-btn ${syncing ? 'syncing' : ''}`}
            type="button"
            disabled={syncing}
            onClick={triggerSync}
          >
            {syncing ? 'Syncing...' : 'Sync registry'}
          </button>
        </nav>
      </header>

      {/* Sync Status Toast/Bar */}
      {syncStatus && (
        <div className="sync-status-bar" role="status">
          <span className="pulse-indicator"></span>
          <p>{syncStatus}</p>
        </div>
      )}

      {/* Fallback Warning */}
      {isFallback && hasSubmitted && (
        <div className="fallback-warning-bar" role="alert">
          <p>
            <strong>Local Fallback Mode:</strong> Backend server is offline or unreachable. Calculations are running inside the browser.
          </p>
        </div>
      )}

      {/* ═══════════ HERO / SEARCH SECTION ═══════════ */}
      <section className={`hero-section ${hasSubmitted ? 'hero-collapsed' : ''}`}>
        <div className="hero-inner">
          {!hasSubmitted && (
            <div className="hero-headline">
              <div className="section-kicker">AI Model Advisor</div>
              <h1>Find the model mix that actually fits the job.</h1>
            </div>
          )}

          <div className={`search-container ${hasSubmitted ? 'search-compact' : ''}`}>
            <div className="search-box">
              <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                className="search-input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe what you need an AI model for..."
                spellCheck={true}
                aria-label="Describe your AI model requirement"
              />
              {loading && <div className="search-spinner"><div className="spinner"></div></div>}
              <button
                className="search-submit"
                type="button"
                onClick={handleSubmit}
                disabled={prompt.trim().length < 3}
                aria-label="Search"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            </div>
          </div>

          {!hasSubmitted && (
            <div className="quick-prompts-row">
              {quickPrompts.map((item) => (
                <button
                  className="quick-chip"
                  key={item}
                  type="button"
                  onClick={() => {
                    setPrompt(item)
                    // Auto submit on chip click
                    setTimeout(() => {
                      setHasSubmitted(true)
                      fetchRecommendations(item, activeCategory, openOnly, maxPrice, customWeights)
                    }, 100)
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ═══════════ RESULTS (only visible after submit) ═══════════ */}
      <div className={`results-reveal ${hasSubmitted ? 'results-visible' : ''}`}>
        {/* Filter Strip */}
        <section className="workspace">
          <section className="advisor-panel" aria-labelledby="advisor-title">
            <div className="control-row" aria-label="Model filters">
              <label className="select-wrap">
                <span>Mode</span>
                <select
                  value={activeCategory}
                  onChange={(event) =>
                    setActiveCategory(event.target.value as ModelCategory | 'auto')
                  }
                >
                  <option value="auto">Auto detect</option>
                  {Object.entries(categoryLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="switch">
                <input
                  checked={openOnly}
                  onChange={(event) => setOpenOnly(event.target.checked)}
                  type="checkbox"
                />
                <span>Open models only</span>
              </label>

              <label className="price-filter">
                <span>Max input cost ($/1M tokens)</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="Unlimited"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                />
              </label>
            </div>
          </section>
        </section>

        <section className="results-layout">
          {/* Best Fit Sidebar */}
          <aside className="insight-panel" aria-label="Top recommendation">
            <div className="pulse-line" />
            <div className="section-kicker">Best current fit</div>
            {winner ? (
              <>
                <div className="winner-header">
                  {(() => {
                    const logo = getProviderLogo(winner.provider)
                    return logo ? (
                      <img className="provider-logo-large" src={logo} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    ) : null
                  })()}
                  <h2>
                    {winner.sourceUrl ? (
                      <a href={winner.sourceUrl} target="_blank" rel="noopener noreferrer" className="model-source-link" title="Open model site">
                        {winner.name}
                        <svg className="external-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                          <polyline points="15 3 21 3 21 9"></polyline>
                          <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                      </a>
                    ) : (
                      winner.name
                    )}
                  </h2>
                </div>
                <p>{winner.bestFor}</p>

                <div className="score-orbit" aria-label={`Recommendation score ${winner.score}`}>
                  <span>{winner.score}</span>
                  <small>fit score</small>
                </div>

                <dl className="signal-list">
                  <div>
                    <dt>Detected mode</dt>
                    <dd>{categoryLabels[targetCategory]}</dd>
                  </div>
                  <div>
                    <dt>Cost profile</dt>
                    <dd>{formatPricing(winner)}</dd>
                  </div>
                  <div>
                    <dt>Context limit</dt>
                    <dd>{formatContext(winner.contextLength)}</dd>
                  </div>
                  <div>
                    <dt>Access Model</dt>
                    <dd>{winner.access}</dd>
                  </div>
                  <div>
                    <dt>Verification Source</dt>
                    <dd>{winner.source}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <div className="no-winner-msg">
                <p>No matching models. Try broadening your prompt or adjusting price/access filters.</p>
              </div>
            )}
          </aside>

          <section className="results-stack" aria-labelledby="results-title">
            <div className="section-heading">
              <div>
                <div className="section-kicker">Ranked range</div>
                <h2 id="results-title">Recommended models</h2>
              </div>
              <div className="registry-info-pills">
                {registryStats.modelCount > 0 && (
                  <span className="registry-pill count-pill">
                    Registry: {registryStats.modelCount} models
                  </span>
                )}
                <span className="registry-pill">{recommendations.length} matches</span>
              </div>
            </div>

            {error && <div className="error-alert" role="alert">{error}</div>}

            {recommendations.length > 0 ? (
              <div className="model-grid">
                {recommendations.map((model, index) => (
                  <article className="model-card" key={model.id} style={{ transitionDelay: `${index * 80}ms` }}>
                    <div className="card-topline">
                      <div className="card-topline-left">
                        {(() => {
                          const logo = getProviderLogo(model.provider)
                          return logo ? (
                            <img className="provider-logo" src={logo} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          ) : null
                        })()}
                        <span className="rank">0{index + 1}</span>
                      </div>
                      <span className={`category-badge ${model.category}`}>
                        {categoryLabels[model.category]}
                      </span>
                    </div>

                    <h3>
                      {model.sourceUrl ? (
                        <a href={model.sourceUrl} target="_blank" rel="noopener noreferrer" className="model-source-link" title="Open model site">
                          {model.name}
                          <svg className="external-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                          </svg>
                        </a>
                      ) : (
                        model.name
                      )}
                    </h3>
                    <p>{model.bestFor}</p>

                    {model.reasons && model.reasons.length > 0 && (
                      <ul className="reasons-list">
                        {model.reasons.map((reason, idx) => (
                          <li key={idx}>✓ {reason}</li>
                        ))}
                      </ul>
                    )}

                    <div className="card-specs">
                      <div>
                        <small>Context</small>
                        <strong>{formatContext(model.contextLength)}</strong>
                      </div>
                      <div>
                        <small>Pricing</small>
                        <strong>{formatPricing(model)}</strong>
                      </div>
                    </div>

                    <div className="score-row">
                      <strong>{model.score}</strong>
                      <span>Weighted additive score</span>
                    </div>

                    <div className="meter-list">
                      {Object.entries(model.metrics).map(([metric, value]) => (
                        <div className="meter" key={metric}>
                          <span>{metric}</span>
                          <div>
                            <i style={{ width: percentage(value) }} />
                          </div>
                          <b>{percentage(value)}</b>
                        </div>
                      ))}
                    </div>

                    <footer>
                      <span>{model.provider}</span>
                      <span>{model.access}</span>
                    </footer>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-results-card">
                <p>No models match the current filter parameters. Tweak filters or search query.</p>
              </div>
            )}
          </section>

          <aside className="system-panel" id="scoring" aria-label="Scoring weights">
            <div className="section-kicker">Scoring engine</div>
            <div className="weights-header-row">
              <h2>Scoring weights</h2>
              {customWeights ? (
                <button className="reset-weights-btn" type="button" onClick={resetWeights}>
                  Reset to Auto
                </button>
              ) : (
                <span className="auto-weights-badge">Prompt Auto-tuned</span>
              )}
            </div>
            <p>
              Scores represent a weighted average across quality, cost, speed, context, privacy, and availability, tailored dynamically to the prompt.
            </p>

            <div className="weight-stack">
              {Object.entries(displayedWeights).map(([metric, weight]) => (
                <div className="weight-row-interactive" key={metric}>
                  <div className="weight-row-label">
                    <span>{metric}</span>
                    <strong>{weight.toFixed(2)}</strong>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="3.00"
                    step="0.05"
                    value={weight}
                    onChange={(e) => handleWeightChange(metric as WeightKey, parseFloat(e.target.value))}
                  />
                </div>
              ))}
            </div>

            <div className="formula-card">
              <span>Score</span>
              <code>
                [ Sum(w * M) / Sum(w) ] * Fit * Confidence
              </code>
            </div>
          </aside>
        </section>

        <section className="registry-section" id="registry" aria-labelledby="registry-title">
          <div>
            <div className="section-kicker">Data backbone</div>
            <h2 id="registry-title">Model registry designed for constant change.</h2>
            
            {registryStats.lastUpdated && (
              <p className="last-updated-text">
                Last registry update check: {new Date(registryStats.lastUpdated).toLocaleString()}
              </p>
            )}

            {/* Sync History Logs Panel */}
            {syncHistory.length > 0 && (
              <div className="sync-history-panel">
                <h3>Synchronization Logs</h3>
                <div className="sync-logs-list">
                  {syncHistory.map((log, index) => {
                    const hasErrors = log.results.some((r) => !r.ok)
                    return (
                      <div className="sync-log-entry" key={index}>
                        <div className="log-time">
                          {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          {' - '}
                          {new Date(log.timestamp).toLocaleDateString()}
                        </div>
                        <div className="log-status">
                          {hasErrors ? (
                            <span className="status-badge error">Errors</span>
                          ) : (
                            <span className="status-badge success">Success</span>
                          )}
                        </div>
                        <div className="log-summary">
                          Added: <strong>{log.added}</strong>, Updated: <strong>{log.updated}</strong>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="pipeline-grid">
            {[
              ['01', 'OpenRouter', 'Pricing, context windows, providers, and API availability.'],
              ['02', 'Hugging Face', 'Open model metadata, tasks, licenses, likes, and downloads.'],
              ['03', 'Benchmarks', 'Arena, Artificial Analysis, provider evals, and manual review.'],
              ['04', 'Snapshots', 'Daily diffs, confidence labels, source URLs, and stale-data alerts.'],
            ].map(([step, title, copy]) => (
              <article className="pipeline-card" key={step}>
                <span>{step}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
