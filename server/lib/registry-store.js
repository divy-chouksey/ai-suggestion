import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(__dirname, '..')
const dataDir = path.join(serverRoot, 'data')
const seedPath = path.join(dataDir, 'model-registry.seed.json')
const registryPath = path.join(dataDir, 'model-registry.json')
const historyPath = path.join(dataDir, 'sync-history.json')

const metricKeys = ['quality', 'affordability', 'speed', 'context', 'privacy', 'availability']

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

export function normalizeModel(model) {
  const id = slug(model.id || `${model.provider}-${model.name}`)
  const metrics = {}

  for (const key of metricKeys) {
    metrics[key] = clamp(model.metrics?.[key])
  }

  return {
    id,
    name: String(model.name || id),
    provider: String(model.provider || 'Unknown provider'),
    category: String(model.category || 'general'),
    access: String(model.access || 'API'),
    modalities: Array.isArray(model.modalities) ? model.modalities.map(String) : ['text'],
    bestFor: String(model.bestFor || 'General AI model workflows.'),
    source: String(model.source || 'Unknown source'),
    sourceUrl: String(model.sourceUrl || ''),
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

export async function readRegistry() {
  await ensureDataDir()

  try {
    const registry = await readJson(registryPath)
    return {
      ...registry,
      models: (registry.models || []).map(normalizeModel),
    }
  } catch {
    const seed = await readJson(seedPath)
    const registry = {
      version: seed.version || 1,
      lastUpdated: seed.lastUpdated || new Date().toISOString(),
      models: (seed.models || []).map(normalizeModel),
    }
    await writeRegistry(registry.models, { reason: 'initialized from seed registry' })
    return registry
  }
}

export async function writeRegistry(models, metadata = {}) {
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

export async function upsertModels(incomingModels, metadata = {}) {
  const registry = await readRegistry()
  const before = registry.models.length
  const models = mergeModels(registry.models, incomingModels)
  const next = await writeRegistry(models, metadata)

  return {
    registry: next,
    before,
    after: models.length,
    added: Math.max(0, models.length - before),
    updated: incomingModels.length,
  }
}

export async function appendSyncHistory(entry) {
  await ensureDataDir()

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
}

export async function readSyncHistory() {
  try {
    return await readJson(historyPath)
  } catch {
    return []
  }
}
