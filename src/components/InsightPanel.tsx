import type { RecommendedModel, ModelCategory } from '../types'
import { categoryLabels, getProviderLogo } from '../lib/constants'
import { formatPricing, formatContext } from '../lib/scoring'

type InsightPanelProps = {
  winner: RecommendedModel | null
  targetCategory: ModelCategory
  parserUsed?: string
}

export function InsightPanel({ winner, targetCategory, parserUsed }: InsightPanelProps) {
  return (
    <aside className="insight-panel" aria-label="Top recommendation">
      <div className="pulse-line" />
      <div className="section-kicker">Best current fit</div>
      {winner ? (
        <>
          <div className="winner-header">
            {(() => {
              const logo = getProviderLogo(winner.provider)
              return logo ? (
                <img
                  className="provider-logo-large"
                  src={logo}
                  alt=""
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              ) : null
            })()}
            <h2>
              {winner.sourceUrl ? (
                <a href={winner.sourceUrl} target="_blank" rel="noopener noreferrer" className="model-source-link" title="Open model site">
                  {winner.name}
                  <svg className="external-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>
                </a>
              ) : (
                winner.name
              )}
            </h2>
          </div>
          <p>{winner.bestFor}</p>

          <div className="score-orbit" aria-label={`Recommendation score ${winner.score}`}>
            <span>{winner.score}</span>
            <small>fit score</small>
          </div>

          <dl className="signal-list">
            <div>
              <dt>Detected mode</dt>
              <dd>{categoryLabels[targetCategory]}</dd>
            </div>
            <div>
              <dt>Cost profile</dt>
              <dd>{formatPricing(winner)}</dd>
            </div>
            <div>
              <dt>Context limit</dt>
              <dd>{formatContext(winner.contextLength)}</dd>
            </div>
            <div>
              <dt>Access Model</dt>
              <dd>{winner.access}</dd>
            </div>
            <div>
              <dt>Verification Source</dt>
              <dd>{winner.source}</dd>
            </div>
            {parserUsed && parserUsed !== 'regex' && (
              <div>
                <dt>Understanding</dt>
                <dd className="parser-badge">✦ Cohere</dd>
              </div>
            )}
          </dl>
        </>
      ) : (
        <div className="no-winner-msg">
          <p>No matching models. Try broadening your prompt or adjusting price/access filters.</p>
        </div>
      )}
    </aside>
  )
}
