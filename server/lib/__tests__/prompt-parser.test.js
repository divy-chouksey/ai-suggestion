import { describe, it, expect } from 'vitest'
import { analyzePrompt } from '../scoring.js'

describe('Constraint and Negation Parser tests', () => {
  it('extracts maximum price correctly', () => {
    const analysis = analyzePrompt('I need a model under $1.50 per million tokens', 'auto')
    expect(analysis.constraints.maxPrice).toBe(1.5)
  })

  it('extracts minimum context window correctly', () => {
    const analysis1 = analyzePrompt('context window of at least 128k', 'auto')
    expect(analysis1.constraints.minContext).toBe(128000)

    const analysis2 = analyzePrompt('minimum 32000 tokens context', 'auto')
    expect(analysis2.constraints.minContext).toBe(32000)
  })

  it('detects self-hosting requirements', () => {
    const analysis = analyzePrompt('We require a self-hosted model for internal use', 'auto')
    expect(analysis.constraints.mustSelfHost).toBe(true)
  })

  it('detects model exclusions', () => {
    const analysis = analyzePrompt('Recommend some models but not gpt-4o and exclude claude-3-opus', 'auto')
    expect(analysis.constraints.excludeModels).toContain('gpt-4o')
    expect(analysis.constraints.excludeModels).toContain('claude-3-opus')
  })

  it('detects provider exclusions', () => {
    const analysis = analyzePrompt('avoid openai models and no google please', 'auto')
    expect(analysis.constraints.excludeProviders).toContain('openai')
    expect(analysis.constraints.excludeProviders).toContain('google')
  })

  it('handles combination of multiple constraints', () => {
    const analysis = analyzePrompt('Write code. Must self-host. Under $0.50 budget. Avoid meta provider.', 'auto')
    expect(analysis.targetCategory).toBe('code')
    expect(analysis.constraints.mustSelfHost).toBe(true)
    expect(analysis.constraints.maxPrice).toBe(0.5)
    expect(analysis.constraints.excludeProviders).toContain('meta')
  })

  it('handles negations correctly by reducing weight', () => {
    const normalAnalysis = analyzePrompt('Write code', 'auto')
    const negatedAnalysis = analyzePrompt('Write code but speed is not important', 'auto')

    expect(negatedAnalysis.negatedMetrics).toContain('speed')
    expect(negatedAnalysis.weights.speed).toBeLessThan(normalAnalysis.weights.speed)
  })
})
