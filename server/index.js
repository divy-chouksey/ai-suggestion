import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRegistry, readSyncHistory } from './lib/registry-store.js'
import { recommendModels } from './lib/scoring.js'
import { syncSources } from './lib/source-sync.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist')
const port = Number(process.env.API_PORT || process.env.PORT || 8787)

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

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  response.end(body)
}

function sendNoContent(response) {
  response.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  response.end()
}

async function readJsonBody(request) {
  let body = ''

  for await (const chunk of request) {
    body += chunk

    if (body.length > 1024 * 1024) {
      throw new Error('Request body is too large')
    }
  }

  if (!body.trim()) {
    return {}
  }

  return JSON.parse(body)
}

function filterModels(models, url) {
  const category = url.searchParams.get('category')
  const access = url.searchParams.get('access')
  const query = url.searchParams.get('q')?.toLowerCase()

  return models.filter((model) => {
    if (category && category !== 'all' && model.category !== category) {
      return false
    }

    if (access && access !== 'all' && model.access !== access) {
      return false
    }

    if (!query) {
      return true
    }

    return [model.name, model.provider, model.bestFor, model.category, model.access]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })
}

async function handleApi(request, response, url) {
  if (request.method === 'OPTIONS') {
    sendNoContent(response)
    return
  }

  if (url.pathname === '/api/health' && request.method === 'GET') {
    const registry = await readRegistry()
    sendJson(response, 200, {
      ok: true,
      service: 'model-compass-api',
      modelCount: registry.models.length,
      lastUpdated: registry.lastUpdated,
    })
    return
  }

  if (url.pathname === '/api/models' && request.method === 'GET') {
    const registry = await readRegistry()
    const models = filterModels(registry.models, url)
    sendJson(response, 200, {
      models,
      count: models.length,
      registry: {
        modelCount: registry.models.length,
        lastUpdated: registry.lastUpdated,
      },
    })
    return
  }

  if (url.pathname === '/api/recommendations' && request.method === 'POST') {
    const body = await readJsonBody(request)
    const registry = await readRegistry()

    if (!body.prompt || String(body.prompt).trim().length < 3) {
      sendJson(response, 400, {
        error: 'Prompt must describe the model requirement.',
      })
      return
    }

    const result = recommendModels(registry.models, body)
    sendJson(response, 200, {
      ...result,
      registry: {
        modelCount: registry.models.length,
        lastUpdated: registry.lastUpdated,
      },
    })
    return
  }

  if (url.pathname === '/api/sync' && request.method === 'POST') {
    const body = await readJsonBody(request)
    const result = await syncSources({
      sources: body.sources,
      limit: body.limit,
    })
    sendJson(response, result.ok ? 200 : 502, result)
    return
  }

  if (url.pathname === '/api/sources' && request.method === 'GET') {
    const history = await readSyncHistory()
    sendJson(response, 200, {
      sources: ['openrouter', 'huggingface'],
      history,
    })
    return
  }

  sendJson(response, 404, {
    error: `No API route for ${request.method} ${url.pathname}`,
  })
}

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
    })
    createReadStream(safePath).pipe(response)
  } catch {
    const fallbackPath = path.join(distDir, 'index.html')

    try {
      await stat(fallbackPath)
      response.writeHead(200, {
        'content-type': mimeTypes['.html'],
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

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url)
      return
    }

    await serveStatic(request, response, url)
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Unexpected server error',
    })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Model Compass API listening on http://127.0.0.1:${port}`)
})
