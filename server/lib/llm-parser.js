/**
 * LLM-based prompt understanding module
 *
 * Uses Cohere (COHERE_API_KEY) for structured intent extraction.
 * Falls back to regex when no API key is configured or the call fails.
 */

const COHERE_URL = 'https://api.cohere.ai/v2/chat'
const DEFAULT_COHERE_MODEL = 'command-r7b-12-2024'

const SYSTEM_PROMPT = `You are a structured data extraction assistant for an AI model recommendation engine.
Given a user's natural language description of what they need an AI model for, extract the following:

1. **category**: One of: general, code, image, video, voice, music, document
2. **priorities**: Array of metric priorities from: quality, affordability, speed, context, privacy, availability
3. **constraints**: Object with optional fields:
   - maxPrice: number (max USD per million tokens)
   - minContext: number (minimum context window in tokens)
   - mustSelfHost: boolean (requires self-hosting)
4. **excludeProviders**: Array of provider names to exclude (e.g., ["openai"])
5. **excludeModels**: Array of specific model names to exclude
6. **negations**: Array of metrics the user explicitly said they DON'T care about
7. **useCaseSummary**: One-sentence summary of the use case

Respond with ONLY valid JSON matching this exact schema:
{
  "category": "string",
  "priorities": ["string"],
  "constraints": { "maxPrice": null, "minContext": null, "mustSelfHost": false },
  "excludeProviders": [],
  "excludeModels": [],
  "negations": [],
  "useCaseSummary": "string"
}`

const VALID_CATEGORIES = ['general', 'code', 'image', 'video', 'voice', 'music', 'document']
const VALID_METRICS = ['quality', 'affordability', 'speed', 'context', 'privacy', 'availability']

/**
 * Parse LLM response JSON, with lenient extraction.
 */
function parseResponseJson(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return sanitizeParsedIntent(parsed)
  } catch {
    return null
  }
}

/**
 * Validate and sanitize parsed intent to ensure type safety.
 */
function sanitizeParsedIntent(raw) {
  const category = VALID_CATEGORIES.includes(raw.category) ? raw.category : 'general'
  const priorities = Array.isArray(raw.priorities)
    ? raw.priorities.filter(p => VALID_METRICS.includes(p))
    : []
  const negations = Array.isArray(raw.negations)
    ? raw.negations.filter(n => VALID_METRICS.includes(n))
    : []
  const excludeProviders = Array.isArray(raw.excludeProviders)
    ? raw.excludeProviders.map(String).slice(0, 10)
    : []
  const excludeModels = Array.isArray(raw.excludeModels)
    ? raw.excludeModels.map(String).slice(0, 10)
    : []

  const constraints = {}
  if (raw.constraints && typeof raw.constraints === 'object') {
    if (typeof raw.constraints.maxPrice === 'number' && raw.constraints.maxPrice > 0) {
      constraints.maxPrice = raw.constraints.maxPrice
    }
    if (typeof raw.constraints.minContext === 'number' && raw.constraints.minContext > 0) {
      constraints.minContext = raw.constraints.minContext
    }
    if (raw.constraints.mustSelfHost === true) {
      constraints.mustSelfHost = true
    }
  }

  return {
    category,
    priorities,
    constraints,
    excludeProviders,
    excludeModels,
    negations,
    useCaseSummary: typeof raw.useCaseSummary === 'string' ? raw.useCaseSummary.slice(0, 200) : '',
  }
}

function extractCohereText(data) {
  const content = data.message?.content
  if (Array.isArray(content)) {
    const textPart = content.find(part => part?.type === 'text' && typeof part.text === 'string')
    if (textPart) return textPart.text
  }

  if (typeof data.text === 'string') return data.text
  return null
}

/**
 * Call Cohere Chat API for structured intent extraction.
 */
async function callCohere(prompt, apiKey) {
  const model = process.env.COHERE_MODEL || DEFAULT_COHERE_MODEL

  const response = await fetch(COHERE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Generate a JSON object for this user prompt: "${prompt}"`,
        },
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    throw new Error(`Cohere API error ${response.status}: ${err.slice(0, 200)}`)
  }

  const data = await response.json()
  const text = extractCohereText(data)
  if (!text) throw new Error('Empty Cohere response')

  return parseResponseJson(text)
}

/**
 * Parse a user prompt using Cohere for structured intent extraction.
 *
 * @param {string} prompt - The user's natural language prompt
 * @returns {Promise<object|null>} ParsedIntent or null if Cohere is unavailable
 */
export async function parsePromptWithLLM(prompt) {
  const cohereKey = process.env.COHERE_API_KEY

  if (!cohereKey) {
    return null
  }

  try {
    const result = await callCohere(prompt, cohereKey)
    if (result) {
      return { ...result, parserUsed: 'cohere' }
    }
  } catch (err) {
    console.warn('[llm-parser] Cohere failed:', err.message)
  }

  return null
}

/**
 * Check if the Cohere API key is configured.
 */
export function isLLMAvailable() {
  return !!process.env.COHERE_API_KEY
}
