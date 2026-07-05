import { describe, it, expect } from 'vitest'
import { checkRateLimit } from '../lib/rate-limiter.js'
import { recommendModels } from '../lib/scoring.js'

describe('API Rate Limiter', () => {
  it('allows requests within limit and blocks when exceeded', () => {
    const ip = '192.168.1.1'
    const route = '/api/recommendations'
    const limits = {
      '/api/recommendations': { maxRequests: 5, windowMs: 1000 }
    }

    // First 5 requests should pass
    for (let i = 0; i < 5; i++) {
      const res = checkRateLimit(ip, route, limits)
      expect(res.limited).toBe(false)
      expect(res.remaining).toBe(4 - i)
    }

    // 6th request should be rate limited
    const resBlocked = checkRateLimit(ip, route, limits)
    expect(resBlocked.limited).toBe(true)
    expect(resBlocked.remaining).toBe(0)
    expect(resBlocked.resetMs).toBeGreaterThan(0)
  })

  it('separates rate limits by IP address', () => {
    const route = '/api/recommendations'
    const limits = {
      '/api/recommendations': { maxRequests: 2, windowMs: 1000 }
    }

    // IP 1 uses up its limit
    checkRateLimit('1.1.1.1', route, limits)
    checkRateLimit('1.1.1.1', route, limits)
    expect(checkRateLimit('1.1.1.1', route, limits).limited).toBe(true)

    // IP 2 should still be allowed
    const resIp2 = checkRateLimit('2.2.2.2', route, limits)
    expect(resIp2.limited).toBe(false)
  })
})

describe('API Input Validation via recommendModels', () => {
  const mockRegistry = [
    {
      id: 'm1',
      name: 'Model 1',
      provider: 'openai',
      category: 'general',
      access: 'API',
      metrics: { quality: 0.8, affordability: 0.8, speed: 0.8, context: 0.8, privacy: 0.8, availability: 0.8 }
    }
  ]

  it('handles empty or custom weights correctly', async () => {
    const res = await recommendModels(mockRegistry, {
      prompt: 'test prompt',
      weights: { quality: 2.0, speed: 1.5 }
    })
    expect(res.analysis.isCustomized).toBe(true)
    expect(res.analysis.weights.quality).toBe(2.0)
    expect(res.analysis.weights.speed).toBe(1.5)
  })

  it('applies structured filters validation', async () => {
    const res = await recommendModels(mockRegistry, {
      prompt: 'test prompt',
      filters: {
        latency: 'realtime',
        privacy: 'self-host'
      }
    })
    // No compatible self-host model in registry, so recommendations should be empty
    expect(res.recommendations.length).toBe(0)
  })
})
