import { appendSyncHistory, upsertModels } from './registry-store.js'

const openRouterUrl = 'https://openrouter.ai/api/v1/models'
const huggingFaceBaseUrl = 'https://huggingface.co/api/models'

function clamp(value, fallback = 0.5) {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) {
    return fallback
  }

  return Math.max(0.01, Math.min(1, numeric))
}

function normalizeId(prefix, value) {
  return `${prefix}-${String(value || 'model')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)}`
}

function detectCategoryFromText(value, modalities = []) {
  const rawText = `${value} ${modalities.join(' ')}`.toLowerCase()

  // ── Step 1: Check for explicit coding models by name FIRST (highest signal) ──
  if (/(codestral|starcoder|deepseek-coder|qwen.*coder|codegemma|codeqwen|codegeex|wizard-coder|wizardcoder|code-llama|codellama|phind-code|phind.*code|opencodeinterpreter|opencoderplus)/.test(rawText)) {
    return 'code'
  }

  // ── Step 2: Remove terms that contain 'code'/'coder' as a SUBSTRING but are NOT code models ──
  const cleanedText = rawText
    .replace(/auto-?encoder\w*/g, '')
    .replace(/\bencoder\w*/g, '')
    .replace(/\bdecoder\w*/g, '')
    .replace(/vocoder\w*/g, '')
    .replace(/\bencode\b/g, '')
    .replace(/\bdecode\b/g, '')
    .replace(/unicode/g, '')
    .replace(/barcode/g, '')
    .replace(/qrcode/g, '')

  // Only match 'code'/'coder' as a whole word or in known compound coding terms
  if (/\bcode\b|\bcoder\b|\bcoding\b|\bprogramm/.test(cleanedText)) {
    return 'code'
  }

  // ── Step 3: Known general-purpose LLM families — guard against wrong classification ──
  // These should be 'general' unless the MODEL NAME/ID specifically says it's a media model
  const isKnownLLM = /(\bgpt\b|\bclaude\b|\bgemini\b|\bllama\b|\bgrok\b|\bmistral\b|\bmixtral\b|\bqwen\b|\bdeepseek\b|\bgemma\b|\bphi\b|\bnova\b|\bjamba\b|\baion\b|\bolmo\b|\bcommand\b|\bcohere\b|\bglm\b|\byi\b)/.test(rawText)
  if (isKnownLLM) {
    // Only re-classify if explicitly a media generation model
    if (/\btext-to-image\b|\bimage-generation\b/.test(rawText)) return 'image'
    if (/\btext-to-video\b|\bvideo-generation\b/.test(rawText)) return 'video'
    if (/\b(tts|stt|text-to-speech)\b/.test(rawText)) return 'voice'
    return 'general'
  }

  // ── Step 4: Dedicated media model families ──
  if (/(image-to-video|\brunway\b|\bsora\b|\bveo\b|\bluma\b|kling|pika|wan.*video)/.test(rawText)) return 'video'
  if (/(text-to-image|\bflux\b|stable-diffusion|\bsdxl\b|\bmidjourney\b|dall-?e|imagen|\bimgen\b)/.test(rawText)) return 'image'

  // ── Step 5: Audio / voice / TTS models ──
  if (/(\btts\b|\bstt\b|whisper|\bspeech\b|\bvoice\b|text-to-speech|automatic-speech-recognition|\bdubbing\b|\bnarrat)/.test(rawText)) return 'voice'

  // ── Step 6: Music generation ──
  if (/(music|\bsong\b|text-to-audio|audio-generation|\bsuno\b|\budio\b)/.test(rawText)) return 'music'

  // ── Step 7: Document / retrieval models ──
  if (/(embedding|\brerank\b|\bocr\b|sentence-similarity|\bretrieval\b)/.test(rawText)) return 'document'

  // ── Step 8: vision/image as fallback for non-LLM image models ──
  if (/\bimage\b|\bvision\b/.test(rawText)) return 'image'

  // ── Step 9: video as fallback ──
  if (/\bvideo\b/.test(rawText)) return 'video'

  return 'general'
}

function normalizeContext(contextLength) {
  const context = Number(contextLength || 0)

  if (!Number.isFinite(context) || context <= 0) {
    return 0.48
  }

  return clamp(Math.log10(context) / 6)
}

function priceToAffordability(inputPerMillion, outputPerMillion) {
  const blended = Number(inputPerMillion || 0) * 0.45 + Number(outputPerMillion || 0) * 0.55

  if (!Number.isFinite(blended) || blended <= 0) {
    return 0.9
  }

  return clamp(1 - Math.log10(blended + 1) / 2.1, 0.48)
}

function estimateOpenRouterQuality(modelId, contextScore) {
  const text = modelId.toLowerCase()
  let score = 0.66 + contextScore * 0.12

  // Tier-1 flagship models
  if (/(gpt-5|claude-3-7|claude-3-5|claude-sonnet|claude-opus|gemini-2|o3|o4|deepseek-r1|deepseek-v3|grok-3|llama-4|codestral)/.test(text)) {
    score += 0.2
  }

  // Tier-2 strong models
  if (/(gpt-4o|claude-3|gemini-1\.5|llama-3|deepseek-v2|qwen.*coder|qwen2\.5|starcoder2|mistral-large|command-r)/.test(text)) {
    score += 0.12
  }

  // Reasoning/coding specialists — always high quality signal
  if (/(reasoning|r1|r2|thinking|coder|coding|codestral|starcoder)/.test(text)) {
    score += 0.06
  }

  // Smaller/cheaper variants
  if (/(mini|nano|small|flash|haiku|lite|\b8b\b|\b7b\b|\b3b\b|\b1b\b)/.test(text)) {
    score -= 0.08
  }

  // Preview/experimental penalty
  if (/(free|preview|beta|experimental)/.test(text)) {
    score -= 0.03
  }

  return clamp(score)
}

function estimateOpenRouterSpeed(modelId) {
  const text = modelId.toLowerCase()
  let score = 0.66

  if (/(flash|mini|haiku|small|fast|turbo|lite|8b|7b|3b)/.test(text)) {
    score += 0.2
  }

  if (/(opus|pro|reasoning|thinking|r1|o3)/.test(text)) {
    score -= 0.1
  }

  return clamp(score)
}

function openRouterBestFor(category, name) {
  const label = name.replace(/\s+/g, ' ').trim()

  if (category === 'code') {
    return `${label} is suited for coding, debugging, refactors, and software agent workflows.`
  }

  if (category === 'document') {
    return `${label} is useful for long-context document analysis, extraction, and RAG workflows.`
  }

  if (category === 'image') {
    return `${label} supports visual tasks such as image understanding or generation depending on provider support.`
  }

  return `${label} is a general-purpose API model for chat, reasoning, summarization, and tool-using workflows.`
}

function mapOpenRouterModel(model) {
  const modalities = [
    ...(model.architecture?.input_modalities || []),
    ...(model.architecture?.output_modalities || []),
  ]
  const category = detectCategoryFromText(`${model.id} ${model.name} ${model.description || ''}`, modalities)
  const contextScore = normalizeContext(model.context_length)
  const inputPerMillion = Number(model.pricing?.prompt || 0) * 1000000
  const outputPerMillion = Number(model.pricing?.completion || 0) * 1000000
  const affordability = priceToAffordability(inputPerMillion, outputPerMillion)
  const provider = String(model.id || '').split('/')[0] || 'OpenRouter'

  return {
    id: normalizeId('openrouter', model.id || model.name),
    name: model.name || model.id,
    provider,
    category,
    access: 'API',
    modalities: modalities.length ? [...new Set(modalities)] : ['text'],
    bestFor: openRouterBestFor(category, model.name || model.id),
    source: 'OpenRouter',
    sourceUrl: model.id ? `https://openrouter.ai/${model.id}` : openRouterUrl,
    lastVerified: new Date().toISOString(),
    confidence: 0.72,
    pricing: {
      unit: 'USD per 1M tokens',
      inputPerMillion,
      outputPerMillion,
    },
    contextLength: Number(model.context_length || 0),
    metrics: {
      quality: estimateOpenRouterQuality(`${model.id} ${model.name}`, contextScore),
      affordability,
      speed: estimateOpenRouterSpeed(`${model.id} ${model.name}`),
      context: contextScore,
      privacy: 0.42,
      availability: 0.82,
    },
  }
}

const huggingFaceTasks = [
  'text-generation',
  'text2text-generation',
  'text-to-image',
  'image-to-video',
  'automatic-speech-recognition',
  'text-to-speech',
  'text-to-audio',
  'sentence-similarity',
]

// Explicit top coding models to inject after HF sync — ensures they always exist in the registry
const CURATED_CODING_MODELS = [
  {
    id: 'curated-claude-3-7-sonnet',
    name: 'Claude 3.7 Sonnet',
    provider: 'Anthropic',
    category: 'code',
    access: 'API',
    modalities: ['text', 'code', 'vision', 'tools'],
    bestFor: 'Best-in-class coding, complex reasoning, agentic software workflows, and code review. Excels at large repository understanding and multi-file edits.',
    source: 'Curated',
    sourceUrl: 'https://openrouter.ai/anthropic/claude-3.7-sonnet',
    lastVerified: new Date().toISOString(),
    confidence: 0.97,
    pricing: { unit: 'USD per 1M tokens', inputPerMillion: 3, outputPerMillion: 15 },
    contextLength: 200000,
    metrics: { quality: 0.97, affordability: 0.56, speed: 0.64, context: 0.93, privacy: 0.48, availability: 0.95 },
  },
  {
    id: 'curated-claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    category: 'code',
    access: 'API',
    modalities: ['text', 'code', 'vision', 'tools'],
    bestFor: 'Top-tier code generation, debugging, test writing, and agentic software engineering tasks. Fast and highly capable.',
    source: 'Curated',
    sourceUrl: 'https://openrouter.ai/anthropic/claude-3.5-sonnet',
    lastVerified: new Date().toISOString(),
    confidence: 0.96,
    pricing: { unit: 'USD per 1M tokens', inputPerMillion: 3, outputPerMillion: 15 },
    contextLength: 200000,
    metrics: { quality: 0.96, affordability: 0.56, speed: 0.72, context: 0.93, privacy: 0.48, availability: 0.96 },
  },
  {
    id: 'curated-gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    category: 'code',
    access: 'API',
    modalities: ['text', 'code', 'vision', 'tools'],
    bestFor: 'Excellent all-around coding model. Strong at writing, reviewing, and explaining code across all major languages with multimodal input.',
    source: 'Curated',
    sourceUrl: 'https://openrouter.ai/openai/gpt-4o',
    lastVerified: new Date().toISOString(),
    confidence: 0.95,
    pricing: { unit: 'USD per 1M tokens', inputPerMillion: 2.5, outputPerMillion: 10 },
    contextLength: 128000,
    metrics: { quality: 0.95, affordability: 0.52, speed: 0.78, context: 0.88, privacy: 0.45, availability: 0.98 },
  },
  {
    id: 'curated-deepseek-v3',
    name: 'DeepSeek V3',
    provider: 'DeepSeek',
    category: 'code',
    access: 'API',
    modalities: ['text', 'code', 'tools'],
    bestFor: 'Outstanding coding and reasoning at extremely low cost. Competitive with GPT-4o on most coding benchmarks, fraction of the price.',
    source: 'Curated',
    sourceUrl: 'https://openrouter.ai/deepseek/deepseek-chat-v3-0324',
    lastVerified: new Date().toISOString(),
    confidence: 0.94,
    pricing: { unit: 'USD per 1M tokens', inputPerMillion: 0.27, outputPerMillion: 1.1 },
    contextLength: 128000,
    metrics: { quality: 0.93, affordability: 0.93, speed: 0.80, context: 0.88, privacy: 0.42, availability: 0.88 },
  },
  {
    id: 'curated-deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'DeepSeek',
    category: 'code',
    access: 'API',
    modalities: ['text', 'code', 'tools'],
    bestFor: 'State-of-the-art reasoning model for complex algorithmic problems, competitive programming, mathematical proofs, and hard code generation.',
    source: 'Curated',
    sourceUrl: 'https://openrouter.ai/deepseek/deepseek-r1',
    lastVerified: new Date().toISOString(),
    confidence: 0.94,
    pricing: { unit: 'USD per 1M tokens', inputPerMillion: 0.55, outputPerMillion: 2.19 },
    contextLength: 128000,
    metrics: { quality: 0.96, affordability: 0.88, speed: 0.55, context: 0.88, privacy: 0.42, availability: 0.85 },
  },
  {
    id: 'curated-gemini-2-5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'Google',
    category: 'code',
    access: 'API',
    modalities: ['text', 'code', 'vision', 'tools'],
    bestFor: 'Google flagship model with exceptional 1M context. Excellent for large codebase analysis, multi-file generation, and agentic coding tasks.',
    source: 'Curated',
    sourceUrl: 'https://openrouter.ai/google/gemini-2.5-pro-preview',
    lastVerified: new Date().toISOString(),
    confidence: 0.95,
    pricing: { unit: 'USD per 1M tokens', inputPerMillion: 1.25, outputPerMillion: 10 },
    contextLength: 1000000,
    metrics: { quality: 0.96, affordability: 0.72, speed: 0.70, context: 1.0, privacy: 0.45, availability: 0.92 },
  },
  {
    id: 'curated-gemini-2-5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    category: 'code',
    access: 'API',
    modalities: ['text', 'code', 'vision', 'tools'],
    bestFor: 'Fast and affordable code generation with huge context window. Great for iterative coding, auto-completion, and inline code assistance.',
    source: 'Curated',
    sourceUrl: 'https://openrouter.ai/google/gemini-2.5-flash-preview',
    lastVerified: new Date().toISOString(),
    confidence: 0.92,
    pricing: { unit: 'USD per 1M tokens', inputPerMillion: 0.15, outputPerMillion: 0.6 },
    contextLength: 1000000,
    metrics: { quality: 0.90, affordability: 0.93, speed: 0.90, context: 1.0, privacy: 0.45, availability: 0.95 },
  },
  {
    id: 'curated-codestral-2501',
    name: 'Codestral 25.01',
    provider: 'Mistral',
    category: 'code',
    access: 'API',
    modalities: ['text', 'code', 'tools'],
    bestFor: 'Purpose-built coding model by Mistral. Specialized in code completion, generation, and multi-language support. Excellent IDE integration.',
    source: 'Curated',
    sourceUrl: 'https://openrouter.ai/mistralai/codestral-2501',
    lastVerified: new Date().toISOString(),
    confidence: 0.93,
    pricing: { unit: 'USD per 1M tokens', inputPerMillion: 0.3, outputPerMillion: 0.9 },
    contextLength: 256000,
    metrics: { quality: 0.92, affordability: 0.90, speed: 0.85, context: 0.94, privacy: 0.48, availability: 0.90 },
  },
  {
    id: 'curated-qwen2-5-coder-32b',
    name: 'Qwen2.5 Coder 32B Instruct',
    provider: 'Qwen',
    category: 'code',
    access: 'API',
    modalities: ['text', 'code', 'tools'],
    bestFor: 'Strong open-weight coding model from Alibaba. Competitive on HumanEval and SWE-bench. Excellent for code generation, completion, and debugging.',
    source: 'Curated',
    sourceUrl: 'https://openrouter.ai/qwen/qwen-2.5-coder-32b-instruct',
    lastVerified: new Date().toISOString(),
    confidence: 0.90,
    pricing: { unit: 'USD per 1M tokens', inputPerMillion: 0.07, outputPerMillion: 0.16 },
    contextLength: 131072,
    metrics: { quality: 0.89, affordability: 0.97, speed: 0.80, context: 0.88, privacy: 0.42, availability: 0.85 },
  },
  {
    id: 'curated-starcoder2-15b',
    name: 'StarCoder2 15B',
    provider: 'Hugging Face / BigCode',
    category: 'code',
    access: 'Open source',
    modalities: ['text', 'code'],
    bestFor: 'Open-source code generation model trained on 600+ programming languages. Self-hostable, private, and strong at code completion and synthesis.',
    source: 'Curated',
    sourceUrl: 'https://huggingface.co/bigcode/starcoder2-15b',
    lastVerified: new Date().toISOString(),
    confidence: 0.87,
    pricing: { unit: 'infrastructure', inputPerMillion: 0, outputPerMillion: 0 },
    contextLength: 16384,
    metrics: { quality: 0.82, affordability: 0.95, speed: 0.75, context: 0.72, privacy: 0.96, availability: 0.80 },
  },
  {
    id: 'curated-codellama-70b',
    name: 'Code Llama 70B',
    provider: 'Meta',
    category: 'code',
    access: 'Open source',
    modalities: ['text', 'code'],
    bestFor: 'Meta open-source code specialist. Strong at code generation, infilling, and instruction-following for software development tasks.',
    source: 'Curated',
    sourceUrl: 'https://openrouter.ai/meta-llama/codellama-70b-instruct',
    lastVerified: new Date().toISOString(),
    confidence: 0.85,
    pricing: { unit: 'USD per 1M tokens', inputPerMillion: 0.5, outputPerMillion: 1.5 },
    contextLength: 100000,
    metrics: { quality: 0.84, affordability: 0.88, speed: 0.70, context: 0.83, privacy: 0.90, availability: 0.82 },
  },
  {
    id: 'curated-gpt-4o-mini',
    name: 'GPT-4o mini',
    provider: 'OpenAI',
    category: 'code',
    access: 'API',
    modalities: ['text', 'code', 'vision', 'tools'],
    bestFor: 'Cost-efficient OpenAI coding model. Best choice for high-volume code generation, pair programming, and lighter coding tasks.',
    source: 'Curated',
    sourceUrl: 'https://openrouter.ai/openai/gpt-4o-mini',
    lastVerified: new Date().toISOString(),
    confidence: 0.90,
    pricing: { unit: 'USD per 1M tokens', inputPerMillion: 0.15, outputPerMillion: 0.6 },
    contextLength: 128000,
    metrics: { quality: 0.84, affordability: 0.93, speed: 0.92, context: 0.88, privacy: 0.45, availability: 0.98 },
  },
]

function estimateHuggingFaceQuality(model) {
  const popularity = Number(model.downloads || 0) + Number(model.likes || 0) * 20
  return clamp(0.48 + Math.log10(popularity + 1) / 8, 0.52)
}

function estimateHuggingFaceAvailability(model) {
  const downloads = Number(model.downloads || 0)
  const likes = Number(model.likes || 0)
  return clamp(0.48 + Math.log10(downloads + likes * 10 + 1) / 9, 0.58)
}

function mapHuggingFaceModel(model) {
  const tags = Array.isArray(model.tags) ? model.tags : []
  const category = detectCategoryFromText(`${model.id} ${model.pipeline_tag || ''}`, tags)
  const provider = String(model.id || '').split('/')[0] || 'Hugging Face'
  const contextBoost = tags.some((tag) => /long-context|128k|32k|64k|1m/i.test(tag)) ? 0.12 : 0

  return {
    id: normalizeId('hf', model.id),
    name: model.id || model.modelId,
    provider,
    category,
    access: model.gated ? 'Hosted open model' : 'Open source',
    modalities: tags.slice(0, 8).map(String),
    bestFor: `${model.id || 'This open model'} can be evaluated for ${category} workflows, self-hosting, or custom deployment.`,
    source: 'Hugging Face',
    sourceUrl: `https://huggingface.co/${model.id}`,
    lastVerified: new Date().toISOString(),
    confidence: 0.6,
    pricing: {
      unit: 'infrastructure',
      inputPerMillion: 0,
      outputPerMillion: 0,
    },
    contextLength: 0,
    metrics: {
      quality: estimateHuggingFaceQuality(model),
      affordability: 0.9,
      speed: 0.58,
      context: clamp(0.48 + contextBoost),
      privacy: 0.92,
      availability: estimateHuggingFaceAvailability(model),
    },
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'model-compass-local-dev/1.0',
    },
  })

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }

  return response.json()
}

export async function fetchOpenRouterModels(limit = 120) {
  const payload = await fetchJson(openRouterUrl)
  return (payload.data || []).slice(0, limit).map(mapOpenRouterModel)
}

export async function fetchHuggingFaceModels(limit = 70) {
  const perTaskLimit = Math.max(4, Math.ceil(limit / huggingFaceTasks.length))
  const allModels = []

  for (const task of huggingFaceTasks) {
    const params = new URLSearchParams({
      filter: task,
      sort: 'downloads',
      direction: '-1',
      limit: String(perTaskLimit),
    })

    const payload = await fetchJson(`${huggingFaceBaseUrl}?${params.toString()}`)
    allModels.push(...payload.map(mapHuggingFaceModel))
  }

  const deduped = new Map()

  for (const model of allModels) {
    deduped.set(model.id, model)
  }

  return [...deduped.values()].slice(0, limit)
}

export async function syncSources(options = {}) {
  const sources = Array.isArray(options.sources) && options.sources.length
    ? options.sources
    : ['openrouter', 'huggingface']
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 120
  const results = []
  const models = []

  for (const source of sources) {
    try {
      const fetched =
        source === 'huggingface'
          ? await fetchHuggingFaceModels(Math.min(limit, 90))
          : await fetchOpenRouterModels(limit)

      models.push(...fetched)
      results.push({
        source,
        ok: true,
        count: fetched.length,
      })
    } catch (error) {
      results.push({
        source,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Always inject curated high-quality coding models so they are never missing
  models.push(...CURATED_CODING_MODELS)

  const writeResult = models.length
    ? await upsertModels(models, { reason: 'source sync', sources })
    : undefined

  await appendSyncHistory({
    sources,
    results,
    added: writeResult?.added || 0,
    updated: writeResult?.updated || 0,
    modelCount: writeResult?.after,
  })

  return {
    ok: results.some((result) => result.ok),
    results,
    added: writeResult?.added || 0,
    updated: writeResult?.updated || 0,
    modelCount: writeResult?.after,
  }
}

