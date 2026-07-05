import type { WeightKey, PromptAnalysis } from '../types'
import { defaultWeights } from '../lib/constants'

type ScoringPanelProps = {
  analysis: PromptAnalysis | null
  customWeights: Record<WeightKey, number> | null
  onWeightChange: (key: WeightKey, val: number) => void
  onReset: () => void
}

export function ScoringPanel({ analysis, customWeights, onWeightChange, onReset }: ScoringPanelProps) {
  const displayedWeights = (customWeights || analysis?.weights || defaultWeights) as Record<WeightKey, number>

  return (
    <aside className="system-panel" id="scoring" aria-label="Scoring weights">
      <div className="section-kicker">Scoring engine</div>
      <div className="weights-header-row">
        <h2>Scoring weights</h2>
        {customWeights ? (
          <button className="reset-weights-btn" type="button" onClick={onReset}>
            Reset to Auto
          </button>
        ) : (
          <span className="auto-weights-badge">Prompt Auto-tuned</span>
        )}
      </div>
      <p>
        Scores represent a weighted average across quality, cost, speed, context, privacy, and availability, tailored dynamically to the prompt.
      </p>

      <div className="weight-stack">
        {Object.entries(displayedWeights).map(([metric, weight]) => (
          <div className="weight-row-interactive" key={metric}>
            <div className="weight-row-label">
              <span>{metric}</span>
              <strong>{weight.toFixed(2)}</strong>
            </div>
            <input
              type="range"
              min="0.05"
              max="3.00"
              step="0.05"
              value={weight}
              onChange={(e) => onWeightChange(metric as WeightKey, parseFloat(e.target.value))}
            />
          </div>
        ))}
      </div>

      <div className="formula-card">
        <span>Score</span>
        <code>
          [ Sum(w * M) / Sum(w) ] x Fit^1.3 x (0.65 + 0.35 x Conf)
        </code>
      </div>
    </aside>
  )
}
