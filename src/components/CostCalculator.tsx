import { useState, useMemo } from 'react'
import type { RecommendedModel } from '../types'

type CostCalculatorProps = {
  models: RecommendedModel[]
}

export function CostCalculator({ models }: CostCalculatorProps) {
  const [tokensPerDay, setTokensPerDay] = useState(100000)
  const [inputRatio, setInputRatio] = useState(70) // % of tokens that are input
  const [daysPerMonth, setDaysPerMonth] = useState(22)
  const [expanded, setExpanded] = useState(false)

  const costs = useMemo(() => {
    const inputTokens = tokensPerDay * (inputRatio / 100) * daysPerMonth
    const outputTokens = tokensPerDay * ((100 - inputRatio) / 100) * daysPerMonth

    return models
      .filter((m) => m.pricing && m.access === 'API' && m.pricing.unit !== 'infrastructure')
      .map((m) => {
        const inputCost = (inputTokens / 1_000_000) * (m.pricing?.inputPerMillion ?? 0)
        const outputCost = (outputTokens / 1_000_000) * (m.pricing?.outputPerMillion ?? 0)
        return {
          id: m.id,
          name: m.name,
          provider: m.provider,
          monthlyCost: inputCost + outputCost,
          score: m.score,
        }
      })
      .sort((a, b) => a.monthlyCost - b.monthlyCost)
      .slice(0, 8)
  }, [models, tokensPerDay, inputRatio, daysPerMonth])

  const maxCost = Math.max(...costs.map((c) => c.monthlyCost), 1)

  if (models.length === 0) return null

  return (
    <div className="cost-calculator-wrapper">
      <button
        className={`cost-calculator-toggle ${expanded ? 'expanded' : ''}`}
        type="button"
        onClick={() => setExpanded(!expanded)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="calc-icon">
          <rect x="4" y="2" width="16" height="20" rx="2" />
          <line x1="8" y1="6" x2="16" y2="6" />
          <line x1="8" y1="10" x2="10" y2="10" />
          <line x1="12" y1="10" x2="14" y2="10" />
          <line x1="8" y1="14" x2="10" y2="14" />
          <line x1="12" y1="14" x2="14" y2="14" />
          <line x1="8" y1="18" x2="14" y2="18" />
        </svg>
        Estimate my cost
        <svg className={`chevron ${expanded ? 'rotated' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="cost-calculator-panel">
          <div className="cost-inputs">
            <label className="cost-input-group">
              <span>Tokens per day</span>
              <input
                type="number"
                min="1000"
                step="10000"
                value={tokensPerDay}
                onChange={(e) => setTokensPerDay(Math.max(1000, Number(e.target.value)))}
              />
            </label>
            <label className="cost-input-group">
              <span>Input ratio (%)</span>
              <input
                type="range"
                min="10"
                max="90"
                value={inputRatio}
                onChange={(e) => setInputRatio(Number(e.target.value))}
              />
              <small>{inputRatio}% input / {100 - inputRatio}% output</small>
            </label>
            <label className="cost-input-group">
              <span>Days per month</span>
              <input
                type="number"
                min="1"
                max="31"
                value={daysPerMonth}
                onChange={(e) => setDaysPerMonth(Math.max(1, Math.min(31, Number(e.target.value))))}
              />
            </label>
          </div>

          {costs.length > 0 ? (
            <div className="cost-chart">
              {costs.map((c) => (
                <div className="cost-bar-row" key={c.id}>
                  <div className="cost-bar-label">
                    <strong>{c.name}</strong>
                    <small>{c.provider}</small>
                  </div>
                  <div className="cost-bar-track">
                    <div
                      className="cost-bar-fill"
                      style={{ width: `${Math.max(2, (c.monthlyCost / maxCost) * 100)}%` }}
                    />
                  </div>
                  <div className="cost-bar-value">
                    ${c.monthlyCost < 0.01 ? '<0.01' : c.monthlyCost.toFixed(2)}
                    <small>/mo</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="cost-no-data">No API-priced models in current results.</p>
          )}
        </div>
      )}
    </div>
  )
}
