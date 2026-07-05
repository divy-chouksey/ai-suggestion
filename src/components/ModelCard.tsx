import type { RecommendedModel, ModelCategory } from '../types'
import { categoryLabels, getProviderLogo } from '../lib/constants'
import { percentage, formatPricing, formatContext } from '../lib/scoring'

type ModelCardProps = {
  model: RecommendedModel
  index: number
  onCompareToggle?: (modelId: string) => void
  isComparing?: boolean
}

export function ModelCard({ model, index, onCompareToggle, isComparing }: ModelCardProps) {
  const logo = getProviderLogo(model.provider)

  return (
    <article className="model-card" style={{ transitionDelay: `${index * 80}ms` }}>
      <div className="card-topline">
        <div className="card-topline-left">
          {logo && (
            <img
              className="provider-logo"
              src={logo}
              alt=""
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}
          <span className="rank">0{index + 1}</span>
        </div>
        <div className="card-topline-right">
          {onCompareToggle && (
            <button
              className={`compare-toggle ${isComparing ? 'comparing' : ''}`}
              type="button"
              onClick={() => onCompareToggle(model.id)}
              title={isComparing ? 'Remove from comparison' : 'Add to comparison'}
              aria-label={isComparing ? 'Remove from comparison' : 'Compare this model'}
            >
              {isComparing ? 'x' : '+'} Compare
            </button>
          )}
          <span className={`category-badge ${model.category}`}>
            {categoryLabels[model.category as ModelCategory]}
          </span>
        </div>
      </div>

      <h3>
        {model.sourceUrl ? (
          <a href={model.sourceUrl} target="_blank" rel="noopener noreferrer" className="model-source-link" title="Open model site">
            {model.name}
            <svg className="external-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        ) : (
          model.name
        )}
      </h3>
      <p>{model.bestFor}</p>

      {model.reasons && model.reasons.length > 0 && (
        <ul className="reasons-list">
          {model.reasons.map((reason, idx) => (
            <li key={idx}>- {reason}</li>
          ))}
        </ul>
      )}

      <div className="card-specs">
        <div>
          <small>Context</small>
          <strong>{formatContext(model.contextLength)}</strong>
        </div>
        <div>
          <small>Pricing</small>
          <strong>{formatPricing(model)}</strong>
        </div>
      </div>

      <div className="score-row">
        <strong>{model.score}</strong>
        <span>Weighted additive score</span>
      </div>

      <div className="meter-list">
        {Object.entries(model.metrics).map(([metric, value]) => (
          <div className="meter" key={metric}>
            <span>{metric}</span>
            <div>
              <i style={{ width: percentage(value) }} />
            </div>
            <b>{percentage(value)}</b>
          </div>
        ))}
      </div>

      <footer>
        <span>{model.provider}</span>
        <span>{model.access}</span>
      </footer>
    </article>
  )
}
