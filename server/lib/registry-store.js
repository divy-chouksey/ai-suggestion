import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(__dirname, '..')
const dataDir = path.join(serverRoot, 'data')
const seedPath = path.join(dataDir, 'model-registry.seed.json')
const registryPath = path.join(dataDir, 'model-registry.json')
const historyPath = path.join(dataDir, 'sync-history.json')
const lockPath = path.join(dataDir, 'registry.lock')
const strategyPath = path.join(dataDir, 'strategy-templates.json')
const overridesPath = path.join(dataDir, 'model-overrides.json')

const metricKeys = ['quality', 'affordability', 'speed', 'context', 'privacy', 'availability']
const categories = ['general', 'code', 'image', 'video', 'voice', 'music', 'document']
const useCases = [
  ...categories,
  'agent',
  'rag',
  'vision',
  'image_generation',
  'video_generation',
  'speech_to_text',
  'text_to_speech',
  'music_generation',
  'embedding',
  'reranking',
]
const recordTypes = ['api_model', 'open_weight_model', 'hosted_open_model', 'hf_repo', 'model_family', 'strategy_template']
const sourceAuthorities = ['first_party', 'aggregator', 'benchmark', 'curated', 'seed', 'heuristic']
const linkStatuses = ['verified', 'unverified', 'catalog', 'broken']
const strategyTemplateIds = new Set(['voice-agent', 'embedding-rerank-stack'])

function clamp(value, fallback = 0.5) {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) {
    return fallback
  }

  return Math.max(0.01, Math.min(1, numeric))
}

function slug(value) {
  return String(value || 'model')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

function normalizeEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

function normalizeUseCases(values, fallback, options = {}) {
  const raw = Array.isArray(values) ? values : fallback
  const normalized = [...new Set(raw.map(String).filter((value) => useCases.includes(value)))]
  if (normalized.length) return normalized
  return options.allowEmpty ? [] : ['general']
}

function inferSecondaryUseCases(model, primaryUseCases) {
  const text = `${model.id || ''} ${model.name || ''} ${model.bestFor || ''} ${(model.modalities || []).join(' ')}`.toLowerCase()
  const secondary = new Set()
  const isFrontierGeneralist = /(claude|gpt-|gpt |gemini|deepseek|mistral|qwen|grok|llama|command-r|o3|o4)/.test(text)

  if (primaryUseCases.includes('general')) {
    if (/(code|coding|developer|repo|agent|tool)/.test(text)) secondary.add('code')
    if (/(document|pdf|ocr|rag|retrieval|context)/.test(text)) secondary.add('document')
    if (/(vision|image|visual)/.test(text)) secondary.add('vision')
    if (isFrontierGeneralist) {
      secondary.add('code')
      secondary.add('agent')
      secondary.add('document')
    }
  }
  if (/(agent|tool|function)/.test(text)) secondary.add('agent')
  if (/(rag|retrieval|embedding|rerank|search)/.test(text)) secondary.add('rag')
  if (/(tts|text-to-speech|speech synthesis|narration)/.test(text)) secondary.add('text_to_speech')
  if (/(stt|speech-to-text|transcription|whisper|asr)/.test(text)) secondary.add('speech_to_text')

  for (const primary of primaryUseCases) {
    secondary.delete(primary)
  }

  return [...secondary]
}

function inferRecordType(model, id) {
  if (strategyTemplateIds.has(id) || model.recordType === 'strategy_template') return 'strategy_template'
  if (recordTypes.includes(model.recordType)) return model.recordType

  const source = String(model.source || '').toLowerCase()
  const access = String(model.access || '').toLowerCase()
  const provider = String(model.provider || '').toLowerCase()

  if (source === 'hugging face') return access === 'open source' ? 'open_weight_model' : 'hf_repo'
  if (access === 'open source') return 'open_weight_model'
  if (access === 'hosted open model') return 'hosted_open_model'
  if (source === 'seed registry' && (provider.includes(' class') || provider.includes(' / '))) return 'model_family'
  return 'api_model'
}

function inferSourceAuthority(model) {
  if (sourceAuthorities.includes(model.sourceAuthority)) return model.sourceAuthority

  const source = String(model.source || '').toLowerCase()
  if (source.includes('openrouter') || source.includes('hugging face')) return 'aggregator'
  if (source.includes('curated')) return 'curated'
  if (source.includes('seed')) return 'seed'
  return 'heuristic'
}

function inferLinkStatus(model) {
  if (linkStatuses.includes(model.linkStatus)) return model.linkStatus

  const url = String(model.sourceUrl || '')
  if (!url) return 'unverified'
  if (url.includes('/api/') || url.includes('/models?') || url.endsWith('/models')) return 'catalog'
  if (url.startsWith('http')) return 'unverified'
  return 'unverified'
}

// Simple robust lock manager
async function withLock(fn) {
  await ensureDataDir()
  let acquired = false
  for (let i = 0; i < 20; i++) {
    try {
      await mkdir(lockPath)
      acquired = true
      break
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  if (!acquired) {
    throw new Error('Timeout acquiring write lock on registry')
  }
  try {
    return await fn()
  } finally {
    await rm(lockPath, { recursive: true, force: true }).catch(() => {})
  }
}

export function normalizeModel(model) {
  const id = slug(model.id || `${model.provider}-${model.name}`)
  const category = normalizeEnum(String(model.category || 'general'), categories, 'general')
  const primaryUseCases = normalizeUseCases(model.primaryUseCases, [category])
  const secondaryUseCases = normalizeUseCases(
    model.secondaryUseCases,
    inferSecondaryUseCases(model, primaryUseCases),
    { allowEmpty: true }
  ).filter((useCase) => !primaryUseCases.includes(useCase))
  const metrics = {}

  for (const key of metricKeys) {
    metrics[key] = clamp(model.metrics?.[key])
  }

  return {
    id,
    name: String(model.name || id),
    provider: String(model.provider || 'Unknown provider'),
    category,
    primaryUseCases,
    secondaryUseCases,
    recordType: inferRecordType(model, id),
    sourceAuthority: inferSourceAuthority(model),
    linkStatus: inferLinkStatus(model),
    access: String(model.access || 'API'),
    modalities: Array.isArray(model.modalities) ? model.modalities.map(String) : ['text'],
    bestFor: String(model.bestFor || 'General AI model workflows.'),
    source: String(model.source || 'Unknown source'),
    sourceUrl: String(model.sourceUrl || ''),
    benchmarkSources: Array.isArray(model.benchmarkSources) ? model.benchmarkSources.map(String).slice(0, 8) : [],
    lastVerified: String(model.lastVerified || new Date().toISOString()),
    confidence: clamp(model.confidence, 0.5),
    pricing: {
      unit: String(model.pricing?.unit || 'unknown'),
      inputPerMillion: Number(model.pricing?.inputPerMillion || 0),
      outputPerMillion: Number(model.pricing?.outputPerMillion || 0),
    },
    contextLength: Number(model.contextLength || 0),
    metrics,
  }
}

function mergeModels(existing, incoming) {
  const merged = new Map()

  for (const model of existing) {
    const normalized = normalizeModel(model)
    merged.set(normalized.id, normalized)
  }

  for (const model of incoming) {
    const normalized = normalizeModel(model)
    const current = merged.get(normalized.id)

    merged.set(normalized.id, {
      ...current,
      ...normalized,
      metrics: {
        ...current?.metrics,
        ...normalized.metrics,
      },
      pricing: {
        ...current?.pricing,
        ...normalized.pricing,
      },
      benchmarkSources: normalized.benchmarkSources.length
        ? normalized.benchmarkSources
        : (current?.benchmarkSources || []),
      primaryUseCases: normalized.primaryUseCases.length
        ? normalized.primaryUseCases
        : (current?.primaryUseCases || []),
      secondaryUseCases: normalized.secondaryUseCases.length
        ? normalized.secondaryUseCases
        : (current?.secondaryUseCases || []),
    })
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true })
}

export async function readStrategyTemplates() {
  try {
    const raw = await readFile(strategyPath, 'utf8')
    return JSON.parse(raw)
  } catch {
    const defaultStrategies = [
      {
        "id": "realtime-voice-agent",
        "name": "Realtime Voice Agent Stack",
        "useCase": "voice",
        "description": "Voice Agent = STT (Speech-to-Text) + LLM (Reasoning) + TTS (Text-to-Speech) + Streaming Transport. Designed for low-latency conversational audio applications.",
        "recommendedComponents": [
          "Deepgram Nova-2 (STT)",
          "GPT-4o or Claude 3.5 Sonnet (LLM)",
          "ElevenLabs Reader/Multilingual v2 (TTS)"
        ],
        "exampleProviders": [
          "Deepgram",
          "OpenAI",
          "ElevenLabs",
          "Gemini Live API"
        ]
      },
      {
        "id": "embedding-rerank-stack",
        "name": "Embedding & Reranking RAG Stack",
        "useCase": "document",
        "description": "RAG Stack = Vector Embeddings + Vector Database + Cross-Encoder Reranker + LLM. Best for semantic search and precise question-answering over large document catalogs.",
        "recommendedComponents": [
          "Cohere Embed v3 (Embeddings)",
          "Pinecone or pgvector (Database)",
          "Cohere Rerank v3 (Reranking)",
          "Claude 3.5 Sonnet (LLM)"
        ],
        "exampleProviders": [
          "Cohere",
          "Pinecone",
          "Anthropic",
          "Voyage AI"
        ]
      }
    ]
    try {
      await ensureDataDir()
      await writeFile(strategyPath, JSON.stringify(defaultStrategies, null, 2), 'utf8')
    } catch {}
    return defaultStrategies
  }
}

async function loadOverrides() {
  try {
    const raw = await readFile(overridesPath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export async function readRegistry() {
  await ensureDataDir()
  const overrides = await loadOverrides()

  try {
    const registry = await readJson(registryPath)
    const models = (registry.models || []).map((model) => {
      const normalized = normalizeModel(model)
      if (overrides[normalized.id]) {
        return normalizeModel({ ...normalized, ...overrides[normalized.id] })
      }
      return normalized
    })
    return {
      ...registry,
      models,
    }
  } catch {
    const seed = await readJson(seedPath)
    const models = (seed.models || []).map((model) => {
      const normalized = normalizeModel(model)
      if (overrides[normalized.id]) {
        return normalizeModel({ ...normalized, ...overrides[normalized.id] })
      }
      return normalized
    })
    const registry = {
      version: seed.version || 1,
      lastUpdated: seed.lastUpdated || new Date().toISOString(),
      models,
    }
    await _writeRegistry(registry.models, { reason: 'initialized from seed registry' })
    return registry
  }
}

async function _writeRegistry(models, metadata = {}) {
  await ensureDataDir()
  const registry = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    metadata,
    models: models.map(normalizeModel),
  }

  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
  return registry
}

export async function writeRegistry(models, metadata = {}) {
  return withLock(() => _writeRegistry(models, metadata))
}

export async function upsertModels(incomingModels, metadata = {}) {
  return withLock(async () => {
    const registry = await readRegistry()
    const before = registry.models.length

    let added = 0
    let updated = 0
    const existingIds = new Set(registry.models.map((m) => m.id))
    for (const model of incomingModels) {
      const normalized = normalizeModel(model)
      if (existingIds.has(normalized.id)) {
        updated++
      } else {
        added++
      }
    }

    const models = mergeModels(registry.models, incomingModels)
    const next = await _writeRegistry(models, metadata)

    return {
      registry: next,
      before,
      after: models.length,
      added,
      updated,
    }
  })
}

export async function appendSyncHistory(entry) {
  return withLock(async () => {
    let history = []

    try {
      history = await readJson(historyPath)
    } catch {
      history = []
    }

    const next = [
      {
        timestamp: new Date().toISOString(),
        ...entry,
      },
      ...history,
    ].slice(0, 50)

    await writeFile(historyPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return next
  })
}

export async function readSyncHistory() {
  try {
    return await readJson(historyPath)
  } catch {
    return []
  }
}
