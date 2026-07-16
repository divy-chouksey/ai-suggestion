import { describe, it, expect } from 'vitest'
import {
  detectCategory,
  analyzePrompt,
  categoryFit,
  capabilityFit,
  sourceTrustFactor,
  isCompatible,
  weightedAdditiveScore,
  recommendModels,
} from '../scoring.js'

describe('detectCategory', () => {
  it('detects code category correctly', () => {
    expect(detectCategory('Write a python script to parse logs')).toBe('code')
    expect(detectCategory('Help me debug this react component')).toBe('code')
    expect(detectCategory('Database migration SQL')).toBe('code')
  })

  it('detects image category correctly', () => {
    expect(detectCategory('Create a high quality logo for my startup')).toBe('image')
    expect(detectCategory('Product photography for an ecommerce visual campaign')).toBe('image')
  })

  it('detects video category correctly', () => {
    expect(detectCategory('Cinematic clip of a dog running on beach')).toBe('video')
    expect(detectCategory('social ad shorts reel storyboard')).toBe('video')
  })

  it('detects voice category correctly', () => {
    expect(detectCategory('Text to speech narration for audiobook')).toBe('voice')
    expect(detectCategory('Realtime voice call transcription whisper')).toBe('voice')
  })

  it('detects music category correctly', () => {
    expect(detectCategory('Background track for video game with synth beats')).toBe('music')
    expect(detectCategory('generate a song')).toBe('music')
  })

  it('detects document category correctly', () => {
    expect(detectCategory('Summarize this legal pdf contract')).toBe('document')
    expect(detectCategory('Extract invoice data spreadsheet slides')).toBe('document')
  })

  it('defaults to general', () => {
    expect(detectCategory('What is the capital of France?')).toBe('general')
    expect(detectCategory('')).toBe('general')
  })
})

describe('analyzePrompt & Negations', () => {
  it('applies default weights when no signals present', () => {
    const analysis = analyzePrompt('simple general query', 'auto')
    expect(analysis.weights.quality).toBeCloseTo(1.25)
    expect(analysis.weights.speed).toBeCloseTo(0.7)
  })

  it('adjusts weights for budget sensitive signal', () => {
    const analysis = analyzePrompt('cheap and affordable customer support assistant', 'auto')
    expect(analysis.signals.some((s) => s.id === 'budgetSensitive')).toBe(true)
    expect(analysis.weights.affordability).toBeGreaterThan(0.75)
  })

  it('handles negations correctly', () => {
    const analysis = analyzePrompt('Write code. I do not care about speed or latency.', 'auto')
    expect(analysis.negatedMetrics).toContain('speed')
    expect(analysis.weights.speed).toBeLessThan(0.2)
  })

  it('extracts constraints correctly', () => {
    const analysis = analyzePrompt('Write code under $2 per million and at least 32k context', 'auto')
    expect(analysis.constraints.maxPrice).toBe(2)
    expect(analysis.constraints.minContext).toBe(32000)
  })

  it('handles edge cases', () => {
    const emptyAnalysis = analyzePrompt('', 'auto')
    expect(emptyAnalysis.targetCategory).toBe('general')
    expect(emptyAnalysis.prompt).toBe('')

    const longPrompt = 'a'.repeat(1000)
    const longAnalysis = analyzePrompt(longPrompt, 'auto')
    expect(longAnalysis.prompt).toBe(longPrompt)
  })
})

describe('categoryFit & weightedAdditiveScore', () => {
  it('calculates category fit correctly', () => {
    expect(categoryFit('code', 'code')).toBe(1)
    expect(categoryFit('general', 'code')).toBe(0.72)
    expect(categoryFit('image', 'code')).toBe(0.16)
  })

  it('calculates score with modified formula (fit^1.3, confidence)', () => {
    const model = {
      id: 'test',
      metrics: {
        quality: 0.9,
        affordability: 0.8,
        speed: 0.7,
        context: 0.6,
        privacy: 0.5,
        availability: 0.8,
      },
      confidence: 0.8,
      category: 'code',
    }
    const weights = {
      quality: 1,
      affordability: 1,
      speed: 1,
      context: 1,
      privacy: 1,
      availability: 1,
    }
    // Expected metricScore = (0.9+0.8+0.7+0.6+0.5+0.8)/6 = 0.7166
    // Fit factor = 1^1.3 = 1
    // Confidence factor = 0.65 + 0.35 * 0.8 = 0.93
    // Score = 0.7166 * 1 * 0.93 * 100 = 66.6 -> 67
    const score = weightedAdditiveScore(model, 'code', weights)
    expect(score).toBe(67)
  })

  it('applies non-compensatory penalty for quality floor', () => {
    const lowQualityModel = {
      id: 'low-q',
      metrics: {
        quality: 0.5, // Below 0.7
        affordability: 0.9,
        speed: 0.9,
        context: 0.9,
        privacy: 0.9,
        availability: 0.9,
      },
      confidence: 1.0,
      category: 'general',
    }
    const weights = {
      quality: 2.0, // High quality weight
      affordability: 0.5,
      speed: 0.5,
      context: 0.5,
      privacy: 0.5,
      availability: 0.5,
    }
    const scoreNormal = weightedAdditiveScore(lowQualityModel, 'general', weights, false)
    const scoreWithPenalty = weightedAdditiveScore(lowQualityModel, 'general', weights, true)
    expect(scoreWithPenalty).toBeLessThan(scoreNormal)
  })
})

describe('Golden Test Set (30+ Prompts)', () => {
  const dummyModels = [
    {
      id: 'g-1',
      name: 'GPT-4o Class',
      provider: 'OpenAI',
      category: 'general',
      access: 'API',
      metrics: { quality: 0.95, affordability: 0.5, speed: 0.8, context: 0.88, privacy: 0.45, availability: 0.95 },
      pricing: { inputPerMillion: 2.5 },
      contextLength: 128000,
    },
    {
      id: 'c-1',
      name: 'Claude Sonnet Coder',
      provider: 'Anthropic',
      category: 'code',
      access: 'API',
      metrics: { quality: 0.97, affordability: 0.4, speed: 0.7, context: 0.93, privacy: 0.48, availability: 0.92 },
      pricing: { inputPerMillion: 3.0 },
      contextLength: 200000,
    },
    {
      id: 'o-1',
      name: 'Llama Open weights',
      provider: 'Meta',
      category: 'general',
      access: 'Open source',
      metrics: { quality: 0.8, affordability: 0.95, speed: 0.6, context: 0.7, privacy: 0.92, availability: 0.85 },
      pricing: { inputPerMillion: 0 },
      contextLength: 32000,
    },
    {
      id: 'i-1',
      name: 'Flux Studio',
      provider: 'Black Forest',
      category: 'image',
      access: 'API',
      metrics: { quality: 0.9, affordability: 0.6, speed: 0.7, context: 0.2, privacy: 0.45, availability: 0.8 },
      pricing: { inputPerMillion: 0 },
      contextLength: 8000,
    },
    {
      id: 'doc-1',
      name: 'Doc Reader Pro',
      provider: 'Google',
      category: 'document',
      access: 'API',
      metrics: { quality: 0.86, affordability: 0.7, speed: 0.6, context: 0.96, privacy: 0.5, availability: 0.85 },
      pricing: { inputPerMillion: 1.25 },
      contextLength: 1000000,
    },
  ]

  const goldenPrompts = [
    { text: 'python code for sorting', cat: 'code' },
    { text: 'debug react typescript loop', cat: 'code' },
    { text: 'writing a compiler in rust', cat: 'code' },
    { text: 'sql database query optimization', cat: 'code' },
    { text: 'javascript pull request review', cat: 'code' },
    { text: 'generate high-res logo designs', cat: 'image' },
    { text: 'photo of ecommerce product visual', cat: 'image' },
    { text: 'digital poster illustration', cat: 'image' },
    { text: 'ecommerce banner graphic', cat: 'image' },
    { text: 'artistic thumbnail visual', cat: 'image' },
    { text: 'commercial social ad short clip', cat: 'video' },
    { text: 'storyboard motion generator', cat: 'video' },
    { text: 'cinematic video of mountains', cat: 'video' },
    { text: 'short cinematic ad film', cat: 'video' },
    { text: 'realtime voice translation speech', cat: 'voice' },
    { text: 'narrate audiobook using text to speech', cat: 'voice' },
    { text: 'automatic speech recognition client call', cat: 'voice' },
    { text: 'voice agents live appointment book', cat: 'voice' },
    { text: 'lofi music beat background track', cat: 'music' },
    { text: 'generate full music soundtrack', cat: 'music' },
    { text: 'synth song instrumentals', cat: 'music' },
    { text: 'summarize 100 page pdf contract', cat: 'document' },
    { text: 'extract invoice data spreadsheet slides', cat: 'document' },
    { text: 'legal document compliance check', cat: 'document' },
    { text: 'financial spreadsheet ocr parsing', cat: 'document' },
    { text: 'long paper compliance check', cat: 'document' },
    { text: 'medical diagnostic support reasoning', cat: 'general' },
    { text: 'chat bot for general topics', cat: 'general' },
    { text: 'explain relativity theory', cat: 'general' },
    { text: 'help me write an essay', cat: 'general' },
    { text: 'customer support agent', cat: 'general' },
  ]

  goldenPrompts.forEach(({ text, cat }) => {
    it(`golden prompt: "${text}" detects category "${cat}"`, async () => {
      const res = await recommendModels(dummyModels, { prompt: text })
      expect(res.analysis.targetCategory).toBe(cat)
    })
  })
})

describe('Registry Redesign: Strategy Templates & Source Trust', () => {
  const strategyModel = {
    id: 'voice-agent',
    name: 'Realtime Voice Stack',
    provider: 'OpenAI / ElevenLabs / Deepgram class',
    category: 'voice',
    recordType: 'strategy_template',
    sourceAuthority: 'seed',
    linkStatus: 'catalog',
    primaryUseCases: ['voice'],
    secondaryUseCases: ['speech_to_text', 'text_to_speech'],
    access: 'API',
    metrics: { quality: 0.83, affordability: 0.64, speed: 0.88, context: 0.5, privacy: 0.5, availability: 0.76 },
    pricing: { inputPerMillion: 0 },
    contextLength: 16000,
  }

  const realModel = {
    id: 'real-voice-model',
    name: 'Deepgram Nova-2',
    provider: 'Deepgram',
    category: 'voice',
    recordType: 'api_model',
    sourceAuthority: 'first_party',
    linkStatus: 'verified',
    primaryUseCases: ['voice', 'speech_to_text'],
    secondaryUseCases: [],
    access: 'API',
    metrics: { quality: 0.85, affordability: 0.72, speed: 0.92, context: 0.4, privacy: 0.5, availability: 0.9 },
    pricing: { inputPerMillion: 0 },
    contextLength: 0,
  }

  const codeModel = {
    id: 'code-primary',
    name: 'Claude Code',
    provider: 'Anthropic',
    category: 'code',
    recordType: 'api_model',
    sourceAuthority: 'first_party',
    linkStatus: 'verified',
    primaryUseCases: ['code'],
    secondaryUseCases: ['general', 'agent', 'document'],
    access: 'API',
    metrics: { quality: 0.97, affordability: 0.5, speed: 0.7, context: 0.93, privacy: 0.48, availability: 0.92 },
    pricing: { inputPerMillion: 3 },
    contextLength: 200000,
  }

  const catalogModel = {
    id: 'catalog-model',
    name: 'Generic Catalog Entry',
    provider: 'SomeProvider',
    category: 'general',
    recordType: 'api_model',
    sourceAuthority: 'aggregator',
    linkStatus: 'catalog',
    primaryUseCases: ['general'],
    secondaryUseCases: [],
    access: 'API',
    metrics: { quality: 0.7, affordability: 0.6, speed: 0.6, context: 0.6, privacy: 0.5, availability: 0.7 },
    pricing: { inputPerMillion: 1 },
    contextLength: 128000,
  }

  it('does not recommend strategy templates', async () => {
    const res = await recommendModels([strategyModel, realModel], { prompt: 'voice transcription agent' })
    const ids = res.recommendations.map((r) => r.id)
    expect(ids).not.toContain('voice-agent')
    expect(ids).toContain('real-voice-model')
  })

  it('uses secondary use cases for capability fit', () => {
    // codeModel has secondary use case 'document'
    const fit = capabilityFit(codeModel, 'document')
    expect(fit).toBe(0.82)
  })

  it('returns 1.0 for primary use case match', () => {
    const fit = capabilityFit(codeModel, 'code')
    expect(fit).toBe(1)
  })

  it('applies source trust to lower confidence source records', () => {
    const firstPartyTrust = sourceTrustFactor({
      recordType: 'api_model',
      sourceAuthority: 'first_party',
      linkStatus: 'verified',
    })
    const aggregatorTrust = sourceTrustFactor({
      recordType: 'hf_repo',
      sourceAuthority: 'aggregator',
      linkStatus: 'unverified',
    })
    expect(firstPartyTrust).toBe(1)
    expect(aggregatorTrust).toBeLessThan(firstPartyTrust)
  })

  it('returns 0 trust for strategy templates', () => {
    const trust = sourceTrustFactor(strategyModel)
    expect(trust).toBe(0)
  })

  it('isCompatible returns false for strategy templates', () => {
    expect(isCompatible(strategyModel, 'voice')).toBe(false)
  })

  it('adds warning for catalog links', async () => {
    const res = await recommendModels([catalogModel], { prompt: 'general assistant chatbot' })
    const rec = res.recommendations.find((r) => r.id === 'catalog-model')
    expect(rec).toBeDefined()
    expect(rec.warnings).toBeDefined()
    expect(rec.warnings.length).toBeGreaterThan(0)
    expect(rec.warnings[0]).toContain('catalog')
  })

  it('returns strategies array in response', async () => {
    const res = await recommendModels([realModel], { prompt: 'voice agent live call' })
    expect(res.strategies).toBeDefined()
    expect(Array.isArray(res.strategies)).toBe(true)
  })
})
