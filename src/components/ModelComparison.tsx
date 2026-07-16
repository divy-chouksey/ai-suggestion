import { useMemo } from 'react'
import type { RecommendedModel } from '../types'
import { formatPricing, formatContext, percentage } from '../lib/scoring'
import { getProviderLogo } from '../lib/constants'

type ModelComparisonProps = {
  models: RecommendedModel[]
  onRemove: (modelId: string) => void
  onClose: () => void
}

const metricLabels: Record<string, string> = {
  quality: 'Quality',
  affordability: 'Affordability',
  speed: 'Speed',
  context: 'Context',
  privacy: 'Privacy',
  availability: 'Availability',
}

const metricKeys = Object.keys(metricLabels)

export function ModelComparison({ models, onRemove, onClose }: ModelComparisonProps) {
  // Determine best-per-metric
  const bestPerMetric = useMemo(() => {
    const bests: Record<string, string> = {}
    for (const key of metricKeys) {
      let bestId = ''
      let bestVal = -1
      for (const m of models) {
        const val = m.metrics[key as keyof typeof m.metrics] ?? 0
        if (val > bestVal) {
          bestVal = val
          bestId = m.id
        }
      }
      bests[key] = bestId
    }
    return bests
  }, [models])

  // Verdicts
  const verdicts = useMemo(() => {
    return models.map((m) => {
      const strengths: string[] = []
      const weaknesses: string[] = []
      for (const key of metricKeys) {
        const val = m.metrics[key as keyof typeof m.metrics] ?? 0
        if (bestPerMetric[key] === m.id) strengths.push(metricLabels[key])
        if (val < 0.5) weaknesses.push(metricLabels[key])
      }
      return { id: m.id, strengths, weaknesses }
    })
  }, [models, bestPerMetric])

  if (models.length < 2) return null

  return (
    <div className="comparison-overlay">
      <div className="comparison-panel">
        <div className="comparison-header">
          <h2>Model Comparison</h2>
          <button className="comparison-close" type="button" onClick={onClose}>x</button>
        </div>

        <div className="comparison-grid" style={{ gridTemplateColumns: `180px repeat(${models.length}, 1fr)` }}>
          {/* Header row */}
          <div className="comparison-cell comparison-label" />
          {models.map((m) => {
            const logo = getProviderLogo(m.provider)
            return (
              <div className="comparison-cell comparison-model-header" key={m.id}>
                {logo && <img className="comparison-logo" src={logo} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                <strong>{m.name}</strong>
                <small>{m.provider}</small>
                <button className="comparison-remove" type="button" onClick={() => onRemove(m.id)} title="Remove">x</button>
              </div>
            )
          })}

          {/* Score */}
          <div className="comparison-cell comparison-label">Score</div>
          {models.map((m) => (
            <div className="comparison-cell comparison-score" key={m.id}>
              <span className="comparison-score-value">{m.score}</span>
            </div>
          ))}

          {/* Metrics */}
          {metricKeys.map((key) => (
            <>
              <div className="comparison-cell comparison-label" key={`label-${key}`}>{metricLabels[key]}</div>
              {models.map((m) => {
                const val = m.metrics[key as keyof typeof m.metrics] ?? 0
                const isBest = bestPerMetric[key] === m.id
                return (
                  <div className={`comparison-cell ${isBest ? 'is-best' : ''}`} key={`${m.id}-${key}`}>
                    <div className="comparison-bar-wrap">
                      <div className="comparison-bar" style={{ width: percentage(val) }} />
                    </div>
                    <span>{percentage(val)}</span>
                  </div>
                )
              })}
            </>
          ))}

          {/* Pricing */}
          <div className="comparison-cell comparison-label">Pricing</div>
          {models.map((m) => (
            <div className="comparison-cell" key={`price-${m.id}`}>
              <small>{formatPricing(m)}</small>
            </div>
          ))}

          {/* Context */}
          <div className="comparison-cell comparison-label">Context</div>
          {models.map((m) => (
            <div className="comparison-cell" key={`ctx-${m.id}`}>
              <small>{formatContext(m.contextLength)}</small>
            </div>
          ))}

          {/* Access */}
          <div className="comparison-cell comparison-label">Access</div>
          {models.map((m) => (
            <div className="comparison-cell" key={`access-${m.id}`}>
              <small>{m.access}</small>
            </div>
          ))}

          {/* Strengths */}
          <div className="comparison-cell comparison-label">Strengths</div>
          {models.map((m) => {
            const v = verdicts.find((vv) => vv.id === m.id)
            return (
              <div className="comparison-cell comparison-verdict" key={`str-${m.id}`}>
                {v?.strengths.map((s) => <span key={s} className="verdict-tag strength">{s}</span>)}
              </div>
            )
          })}

          {/* Weaknesses */}
          <div className="comparison-cell comparison-label">Weaknesses</div>
          {models.map((m) => {
            const v = verdicts.find((vv) => vv.id === m.id)
            return (
              <div className="comparison-cell comparison-verdict" key={`wk-${m.id}`}>
                {v?.weaknesses.map((s) => <span key={s} className="verdict-tag weakness">{s}</span>)}
                {(!v?.weaknesses.length) && <span className="verdict-tag none">None notable</span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
