/**
 * LLM-based prompt understanding module
 * 
 * Supports two providers:
 *   - Gemini (GEMINI_API_KEY) — preferred, free tier available
 *   - OpenAI (OPENAI_API_KEY) — fallback
 * 
 * Extracts structured ParsedIntent from natural language prompts.
 * Falls back to regex when no API key is configured.
 */

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

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
  // Try to find JSON in the response
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

/**
 * Call Gemini API for structured intent extraction.
 */
async function callGemini(prompt, apiKey) {
  const url = `${GEMINI_URL}?key=${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: `User prompt: "${prompt}"` }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 500,
        responseMimeType: 'application/json',
      },
    }),
  })

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    throw new Error(`Gemini API error ${response.status}: ${err.slice(0, 200)}`)
  }

  const data = await response.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Empty Gemini response')

  return parseResponseJson(text)
}

/**
 * Call OpenAI API for structured intent extraction.
 */
async function callOpenAI(prompt, apiKey) {
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `User prompt: "${prompt}"` },
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    throw new Error(`OpenAI API error ${response.status}: ${err.slice(0, 200)}`)
  }

  const data = await response.json()
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error('Empty OpenAI response')

  return parseResponseJson(text)
}

/**
 * Parse a user prompt using an LLM for structured intent extraction.
 * 
 * Priority: Gemini (if GEMINI_API_KEY set) → OpenAI (if OPENAI_API_KEY set) → null
 * 
 * @param {string} prompt - The user's natural language prompt
 * @returns {Promise<object|null>} ParsedIntent or null if no LLM available
 */
export async function parsePromptWithLLM(prompt) {
  const geminiKey = process.env.GEMINI_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  // Try Gemini first (free tier available)
  if (geminiKey) {
    try {
      const result = await callGemini(prompt, geminiKey)
      if (result) {
        return { ...result, parserUsed: 'gemini' }
      }
    } catch (err) {
      console.warn('[llm-parser] Gemini failed, trying fallback:', err.message)
    }
  }

  // Try OpenAI as fallback
  if (openaiKey) {
    try {
      const result = await callOpenAI(prompt, openaiKey)
      if (result) {
        return { ...result, parserUsed: 'openai' }
      }
    } catch (err) {
      console.warn('[llm-parser] OpenAI failed:', err.message)
    }
  }

  // No LLM available
  return null
}

/**
 * Check if any LLM API key is configured.
 */
export function isLLMAvailable() {
  return !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY)
}
