/**
 * Model Compass API Server — overhauled
 *
 * Changes:
 *  - Middleware pattern: logRequest → rateLimit → cors → route
 *  - CORS restricted to configured origins
 *  - Rate limiting per IP
 *  - Input validation (weights, category, maxPrice, prompt)
 *  - Tighter body size limit for recommendation requests (10KB)
 *  - Request logging to stdout
 *  - Content-Security-Policy headers
 *  - In-memory registry cache with 60s TTL
 *  - recommendModels is now async (LLM parser support)
 */

import './lib/env.js'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRegistry, readSyncHistory } from './lib/registry-store.js'
import { recommendModels, categories } from './lib/scoring.js'
import { syncSources } from './lib/source-sync.js'
import { checkRateLimit } from './lib/rate-limiter.js'
import { getFullBenchmark } from './lib/benchmarks.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist')
const port = Number(process.env.API_PORT || process.env.PORT || 8787)

// ── CORS configuration ──
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173').split(',').map(s => s.trim())
const isDev = process.env.NODE_ENV !== 'production'

// ── In-memory registry cache ──
let registryCache = null
let registryCacheTimestamp = 0
const REGISTRY_CACHE_TTL = 60_000 // 60 seconds

async function getCachedRegistry() {
  const now = Date.now()
  if (registryCache && (now - registryCacheTimestamp) < REGISTRY_CACHE_TTL) {
    return registryCache
  }
  registryCache = await readRegistry()
  registryCacheTimestamp = now
  return registryCache
}

function invalidateRegistryCache() {
  registryCache = null
  registryCacheTimestamp = 0
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

// ── Response helpers ──

function getCorsHeaders(origin) {
  const allowed = isDev || ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')
  return {
    'access-control-allow-origin': allowed ? (origin || '*') : ALLOWED_ORIGINS[0],
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
}

function getSecurityHeaders() {
  return {
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
  }
}

function sendJson(response, statusCode, payload, origin) {
  const body = JSON.stringify(payload, null, 2)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...getCorsHeaders(origin),
  })
  response.end(body)
}

function sendNoContent(response, origin) {
  response.writeHead(204, {
    ...getCorsHeaders(origin),
  })
  response.end()
}

async function readJsonBody(request, maxSize = 10240) {
  let body = ''

  for await (const chunk of request) {
    body += chunk
    if (body.length > maxSize) {
      throw new Error(`Request body too large (max ${Math.round(maxSize / 1024)}KB)`)
    }
  }

  if (!body.trim()) {
    return {}
  }

  return JSON.parse(body)
}

// ── Input validation ──

function sanitizePrompt(prompt) {
  if (typeof prompt !== 'string') return ''
  // Strip HTML tags, limit length
  return prompt.replace(/<[^>]*>/g, '').trim().slice(0, 500)
}

function validateWeights(weights) {
  if (!weights || typeof weights !== 'object') return null

  const validated = {}
  const validKeys = ['quality', 'affordability', 'speed', 'context', 'privacy', 'availability']

  for (const [key, val] of Object.entries(weights)) {
    if (!validKeys.includes(key)) continue
    const num = Number(val)
    if (!Number.isFinite(num)) continue
    if (num < 0.05 || num > 3.0) {
      throw new Error(`Weight '${key}' must be between 0.05 and 3.0 (got ${num})`)
    }
    validated[key] = num
  }

  return Object.keys(validated).length > 0 ? validated : null
}

function validateCategory(category) {
  if (!category || category === 'auto') return 'auto'
  if (!categories.includes(category)) {
    throw new Error(`Invalid category '${category}'. Must be one of: ${categories.join(', ')}`)
  }
  return category
}

function validateMaxPrice(value) {
  if (value === undefined || value === null || value === '') return undefined
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) {
    throw new Error('maxInputPricePerMillion must be a positive number')
  }
  return num
}

// ── Request logger ──
function logRequest(method, pathname, statusCode, durationMs) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${method} ${pathname} → ${statusCode} (${durationMs}ms)`)
}

// ── Route handlers ──

function filterModels(models, url) {
  const category = url.searchParams.get('category')
  const access = url.searchParams.get('access')
  const query = url.searchParams.get('q')?.toLowerCase()

  return models.filter((model) => {
    if (category && category !== 'all' && model.category !== category) return false
    if (access && access !== 'all' && model.access !== access) return false
    if (!query) return true
    return [model.name, model.provider, model.bestFor, model.category, model.access]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })
}

async function handleApi(request, response, url, origin) {
  if (request.method === 'OPTIONS') {
    sendNoContent(response, origin)
    return
  }

  // ── Health ──
  if (url.pathname === '/api/health' && request.method === 'GET') {
    const registry = await getCachedRegistry()
    sendJson(response, 200, {
      ok: true,
      service: 'model-compass-api',
      modelCount: registry.models.length,
      lastUpdated: registry.lastUpdated,
    }, origin)
    return
  }

  // ── Models listing ──
  if (url.pathname === '/api/models' && request.method === 'GET') {
    const registry = await getCachedRegistry()
    const models = filterModels(registry.models, url)
    sendJson(response, 200, {
      models,
      count: models.length,
      registry: {
        modelCount: registry.models.length,
        lastUpdated: registry.lastUpdated,
      },
    }, origin)
    return
  }

  // ── Registry Diagnostics ──
  if (url.pathname === '/api/registry/diagnostics' && request.method === 'GET') {
    const registry = await getCachedRegistry()
    const models = registry.models

    const nameProviderMap = new Map()
    const duplicates = []
    for (const m of models) {
      const key = `${m.name.toLowerCase()}|${m.provider.toLowerCase()}`
      if (nameProviderMap.has(key)) {
        duplicates.push({
          key,
          models: [nameProviderMap.get(key), m.id]
        })
      } else {
        nameProviderMap.set(key, m.id)
      }
    }

    const brokenOrUnverifiedLinks = models
      .filter((m) => m.linkStatus === 'broken' || m.linkStatus === 'unverified')
      .map((m) => ({ id: m.id, name: m.name, sourceUrl: m.sourceUrl, linkStatus: m.linkStatus }))

    const staleOrMissingBenchmarks = models
      .filter((m) => !m.benchmarkSources || m.benchmarkSources.length === 0)
      .map((m) => ({ id: m.id, name: m.name }))

    const placeholders = models
      .filter((m) => m.recordType === 'strategy_template' || m.recordType === 'placeholder')
      .map((m) => ({ id: m.id, name: m.name, recordType: m.recordType }))

    const lowConfidence = models
      .filter((m) => m.confidence < 0.65)
      .map((m) => ({ id: m.id, name: m.name, confidence: m.confidence }))

    sendJson(response, 200, {
      diagnostics: {
        duplicateGroups: duplicates,
        brokenOrUnverifiedLinks,
        staleOrMissingBenchmarks,
        placeholderRecords: placeholders,
        lowConfidenceClassifications: lowConfidence,
      }
    }, origin)
    return
  }

  // ── Model Detail ──
  if (url.pathname.startsWith('/api/models/') && request.method === 'GET') {
    const id = url.pathname.slice('/api/models/'.length)
    const registry = await getCachedRegistry()
    const model = registry.models.find((m) => m.id === id)
    if (!model) {
      sendJson(response, 404, { error: `Model with ID '${id}' not found.` }, origin)
      return
    }
    const benchmark = getFullBenchmark(`${model.id} ${model.name}`)
    sendJson(response, 200, {
      model,
      benchmark: benchmark || null,
      endpoints: [
        {
          id: `${model.id}-endpoint`,
          canonicalModelId: model.id,
          provider: model.provider,
          routeModelId: model.id,
          endpointType: model.access === 'API' ? 'first_party' : 'self_hosted',
          sourceUrl: model.sourceUrl,
          pricing: model.pricing,
          contextLength: model.contextLength,
          availability: 'available',
        }
      ]
    }, origin)
    return
  }

  // ── Recommendations (10KB body limit) ──
  if (url.pathname === '/api/recommendations' && request.method === 'POST') {
    const body = await readJsonBody(request, 10240)
    const registry = await getCachedRegistry()

    // Sanitize and validate input
    const prompt = sanitizePrompt(body.prompt)
    if (prompt.length < 3) {
      sendJson(response, 400, {
        error: 'Prompt must describe the model requirement (min 3 characters).',
      }, origin)
      return
    }

    let validatedWeights
    let validatedCategory
    let validatedMaxPrice

    try {
      validatedWeights = validateWeights(body.weights)
      validatedCategory = validateCategory(body.category)
      validatedMaxPrice = validateMaxPrice(body.maxInputPricePerMillion)
    } catch (err) {
      sendJson(response, 400, { error: err.message }, origin)
      return
    }

    const result = await recommendModels(registry.models, {
      prompt,
      category: validatedCategory,
      weights: validatedWeights,
      openOnly: Boolean(body.openOnly),
      maxInputPricePerMillion: validatedMaxPrice,
      limit: body.limit,
      filters: body.filters || {},
      excludeProviders: body.excludeProviders,
      excludeModels: body.excludeModels,
    })

    sendJson(response, 200, {
      ...result,
      registry: {
        modelCount: registry.models.length,
        lastUpdated: registry.lastUpdated,
      },
    }, origin)
    return
  }

  // ── Sync (1MB body limit) ──
  if (url.pathname === '/api/sync' && request.method === 'POST') {
    const body = await readJsonBody(request, 1024 * 1024)
    invalidateRegistryCache()
    const result = await syncSources({
      sources: body.sources,
      limit: body.limit,
    })
    sendJson(response, result.ok ? 200 : 502, result, origin)
    return
  }

  // ── Sources / sync history ──
  if (url.pathname === '/api/sources' && request.method === 'GET') {
    const history = await readSyncHistory()
    sendJson(response, 200, {
      sources: ['openrouter', 'huggingface'],
      history,
    }, origin)
    return
  }

  sendJson(response, 404, {
    error: `No API route for ${request.method} ${url.pathname}`,
  }, origin)
}

// ── Static file serving ──

async function serveStatic(request, response, url) {
  const requestedPath = decodeURIComponent(url.pathname)
  const normalizedPath = requestedPath === '/' ? '/index.html' : requestedPath
  const filePath = path.normalize(path.join(distDir, normalizedPath))
  const safePath = filePath.startsWith(distDir) ? filePath : path.join(distDir, 'index.html')

  try {
    const file = await stat(safePath)

    if (!file.isFile()) {
      throw new Error('Not a file')
    }

    const extension = path.extname(safePath)
    response.writeHead(200, {
      'content-type': mimeTypes[extension] || 'application/octet-stream',
      ...getSecurityHeaders(),
    })
    createReadStream(safePath).pipe(response)
  } catch {
    const fallbackPath = path.join(distDir, 'index.html')

    try {
      await stat(fallbackPath)
      response.writeHead(200, {
        'content-type': mimeTypes['.html'],
        ...getSecurityHeaders(),
      })
      createReadStream(fallbackPath).pipe(response)
    } catch {
      response.writeHead(404, {
        'content-type': 'text/plain; charset=utf-8',
      })
      response.end('Frontend build not found. Run npm run build first, or use npm run dev for Vite.')
    }
  }
}

// ── Server with middleware ──

const server = http.createServer(async (request, response) => {
  const startTime = Date.now()
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
  const origin = request.headers.origin || ''
  const clientIp = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket.remoteAddress || '127.0.0.1'

  try {
    if (url.pathname.startsWith('/api/')) {
      // ── Rate limiting ──
      const rateResult = checkRateLimit(clientIp, url.pathname)
      if (rateResult.limited) {
        response.writeHead(429, {
          'content-type': 'application/json; charset=utf-8',
          'retry-after': String(Math.ceil(rateResult.resetMs / 1000)),
          ...getCorsHeaders(origin),
        })
        response.end(JSON.stringify({
          error: 'Too many requests. Please try again later.',
          retryAfterMs: rateResult.resetMs,
        }))
        logRequest(request.method, url.pathname, 429, Date.now() - startTime)
        return
      }

      await handleApi(request, response, url, origin)
      logRequest(request.method, url.pathname, response.statusCode, Date.now() - startTime)
      return
    }

    await serveStatic(request, response, url)
  } catch (error) {
    const statusCode = error.message?.includes('too large') ? 413 : 500
    sendJson(response, statusCode, {
      error: error instanceof Error ? error.message : 'Unexpected server error',
    }, origin)
    logRequest(request.method, url.pathname, statusCode, Date.now() - startTime)
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Model Compass API listening on http://127.0.0.1:${port}`)
  console.log(`CORS origins: ${isDev ? 'development mode (permissive)' : ALLOWED_ORIGINS.join(', ')}`)
})
