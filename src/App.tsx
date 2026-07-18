import { useEffect, useState, useCallback } from 'react'
import './App.css'
import type { ModelCategory } from './types'
import { detectCategory } from './lib/scoring'
import { useRecommendations } from './hooks/useRecommendations'
import { useSync } from './hooks/useSync'
import { SearchBar } from './components/SearchBar'
import { ModelCard } from './components/ModelCard'
import { InsightPanel } from './components/InsightPanel'
import { ScoringPanel } from './components/ScoringPanel'
import { FilterStrip } from './components/FilterStrip'
import { SyncHistoryPanel } from './components/SyncHistoryPanel'
import { AdvancedFilters } from './components/AdvancedFilters'
import { CostCalculator } from './components/CostCalculator'
import { ModelComparison } from './components/ModelComparison'

function App() {
  const rec = useRecommendations()
  const sync = useSync(rec.refreshResults)

  // Comparison mode state
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set())
  const [showComparison, setShowComparison] = useState(false)
  const [showScoring, setShowScoring] = useState(false)

  // Initialize Vanta.js topology background
  useEffect(() => {
    let vantaEffect: any = null
    const initVanta = () => {
      if (typeof window !== 'undefined' && (window as any).VANTA?.TOPOLOGY) {
        vantaEffect = (window as any).VANTA.TOPOLOGY({
          el: ".motion-field",
          mouseControls: true,
          touchControls: true,
          gyroControls: false,
          minHeight: 200.00,
          minWidth: 200.00,
          scale: 1.00,
          scaleMobile: 1.00,
          color: 0x4e8596,
          backgroundColor: 0x0
        })
      }
    }

    initVanta()

    // Safety timeout in case the CDN script is still finishing loading/parsing
    const timeout = setTimeout(() => {
      if (!vantaEffect) initVanta()
    }, 500)

    return () => {
      if (vantaEffect) vantaEffect.destroy()
      clearTimeout(timeout)
    }
  }, [])

  const handleCompareToggle = useCallback((modelId: string) => {
    setCompareIds((prev) => {
      const next = new Set(prev)
      if (next.has(modelId)) {
        next.delete(modelId)
      } else if (next.size < 4) {
        next.add(modelId)
      }
      return next
    })
  }, [])

  // Auto-show comparison when 2+ models are selected
  useEffect(() => {
    setShowComparison(compareIds.size >= 2)
  }, [compareIds])

  const compareModels = rec.recommendations.filter((m) => compareIds.has(m.id))

  // Scroll reveal intersection observer for recommended model cards
  useEffect(() => {
    if (rec.recommendations.length === 0) return
    const timer = setTimeout(() => {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible')
              observer.unobserve(entry.target)
            }
          })
        },
        { threshold: 0.05, rootMargin: '0px 0px -40px 0px' }
      )
      const cards = document.querySelectorAll('.model-card')
      cards.forEach((card) => observer.observe(card))
      return () => { cards.forEach((card) => observer.unobserve(card)) }
    }, 100)
    return () => clearTimeout(timer)
  }, [rec.recommendations])

  const handleQuickPrompt = (item: string) => {
    rec.setPrompt(item)
    setTimeout(() => {
      rec.setHasSubmitted(true)
      rec.fetchRecs(item, rec.activeCategory, rec.openOnly, rec.maxPrice, rec.customWeights, rec.advancedFilters)
    }, 100)
  }

  const targetCategory = (rec.analysis?.targetCategory || (rec.activeCategory === 'auto' ? detectCategory(rec.prompt) : rec.activeCategory)) as ModelCategory
  const winner = rec.recommendations.length > 0 ? rec.recommendations[0] : null

  // Merge registry stats from sync history
  useEffect(() => {
    if (sync.syncHistory.length > 0) {
      const latest = sync.syncHistory[0]
      rec.setRegistryStats((prev) => ({
        ...prev,
        modelCount: latest.modelCount || prev.modelCount,
        lastUpdated: latest.timestamp || prev.lastUpdated,
      }))
    }
  }, [sync.syncHistory])

  return (
    <main className={`app-shell ${rec.hasSubmitted ? 'revealed' : ''}`}>
      <div className="motion-field" aria-hidden="true" />

      <header className={`topbar ${rec.hasSubmitted ? 'topbar-compact' : ''}`}>
        <a className="brand" href="/" aria-label="Model Compass home">
          <img className="brand-logo-img" src="/brand-logo.png" alt="" />
          <span>
            <strong>Model Compass</strong>
            <small>Dynamic AI model advisor</small>
          </span>
        </a>
        <nav className={`topbar-actions ${rec.hasSubmitted ? '' : 'topbar-actions-hidden'}`} aria-label="Primary">
          <a href="#registry">Registry</a>
          <a href="#scoring">Scoring</a>
          <button
            className={`ghost-button sync-btn ${sync.syncing ? 'syncing' : ''}`}
            type="button"
            disabled={sync.syncing}
            onClick={sync.triggerSync}
          >
            {sync.syncing ? 'Syncing...' : 'Sync registry'}
          </button>
        </nav>
      </header>

      {/* Sync Status Toast */}
      {sync.syncStatus && (
        <div className="sync-status-bar" role="status">
          <span className="pulse-indicator"></span>
          <p>{sync.syncStatus}</p>
        </div>
      )}

      {/* Fallback Warning */}
      {rec.isFallback && rec.hasSubmitted && (
        <div className="fallback-warning-bar" role="alert">
          <p>
            <strong>Local Fallback Mode:</strong> Backend server is offline or unreachable. Calculations are running inside the browser.
          </p>
        </div>
      )}

      {rec.parserUsed === 'regex' && rec.hasSubmitted && (
        <div className="fallback-warning-bar" role="status">
          <p>
            <strong>Limited understanding:</strong> Configure a Cohere API key for richer prompt parsing.
          </p>
        </div>
      )}

      {/* Search / Hero */}
      <SearchBar
        prompt={rec.prompt}
        setPrompt={rec.setPrompt}
        loading={rec.loading}
        hasSubmitted={rec.hasSubmitted}
        onSubmit={rec.handleSubmit}
        onQuickPrompt={handleQuickPrompt}
        inputRef={rec.inputRef}
      />

      {/* Results */}
      <div className={`results-reveal ${rec.hasSubmitted ? 'results-visible' : ''}`}>
        <FilterStrip
          activeCategory={rec.activeCategory}
          onCategoryChange={rec.setActiveCategory}
          openOnly={rec.openOnly}
          onOpenOnlyChange={rec.setOpenOnly}
          maxPrice={rec.maxPrice}
          onMaxPriceChange={rec.setMaxPrice}
        />

        {/* Advanced Filters */}
        <section className="workspace">
          <AdvancedFilters filters={rec.advancedFilters} onChange={rec.setAdvancedFilters} />
        </section>

        <section className="results-layout">
          <InsightPanel winner={winner} targetCategory={targetCategory} parserUsed={rec.parserUsed} />

          <section className="results-stack" aria-labelledby="results-title">
            <div className="section-heading">
              <div>
                <div className="section-kicker">Ranked range</div>
                <h2 id="results-title">Recommended models</h2>
              </div>
              <div className="registry-info-pills">
                {rec.registryStats.modelCount > 0 && (
                  <span className="registry-pill count-pill">
                    Registry: {rec.registryStats.modelCount} models
                  </span>
                )}
                <span className="registry-pill">{rec.recommendations.length} matches</span>
                {compareIds.size > 0 && (
                  <span className="registry-pill compare-pill">
                    {compareIds.size} comparing
                  </span>
                )}
              </div>
            </div>

            {rec.error && <div className="error-alert" role="alert">{rec.error}</div>}

            {rec.recommendations.length > 0 ? (
              <>
                <CostCalculator models={rec.recommendations} />
                <div className="model-grid">
                  {rec.recommendations.map((model, index) => (
                    <ModelCard
                      key={model.id}
                      model={model}
                      index={index}
                      onCompareToggle={handleCompareToggle}
                      isComparing={compareIds.has(model.id)}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-results-card">
                <p>No models match the current filter parameters. Tweak filters or search query.</p>
              </div>
            )}

            {/* Strategy Templates Section */}
            {rec.strategies && rec.strategies.length > 0 && (
              <div className="strategy-section">
                <div className="strategy-section-header">
                  <div className="section-kicker">Suggested architecture</div>
                  <h3>Strategy Templates</h3>
                  <p className="strategy-subtitle">
                    These are architectural patterns, not individual models. Combine the suggested components for a complete solution.
                  </p>
                </div>
                <div className="strategy-grid">
                  {rec.strategies.map((strategy) => (
                    <article className="strategy-card" key={strategy.id}>
                      <div className="strategy-card-header">
                        <span className="strategy-badge">Strategy</span>
                        <h4>{strategy.name}</h4>
                      </div>
                      <p className="strategy-description">{strategy.description}</p>
                      <div className="strategy-components">
                        <small>Recommended components</small>
                        <ul>
                          {strategy.recommendedComponents.map((comp, idx) => (
                            <li key={idx}>{comp}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="strategy-providers">
                        <small>Example providers</small>
                        <div className="strategy-provider-tags">
                          {strategy.exampleProviders.map((provider, idx) => (
                            <span key={idx} className="strategy-provider-tag">{provider}</span>
                          ))}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>
        </section>

        <SyncHistoryPanel
          syncHistory={sync.syncHistory}
          registryStats={rec.registryStats}
        />
      </div>

      {/* Floating Scoring Weights Toggle Button */}
      {rec.hasSubmitted && (
        <button
          className="scoring-float-btn"
          type="button"
          onClick={() => setShowScoring(true)}
          title="Tune scoring weights"
          aria-label="Tune scoring weights"
        >
          <svg className="sliders-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="21" x2="4" y2="14"></line>
            <line x1="4" y1="10" x2="4" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12" y2="3"></line>
            <line x1="20" y1="21" x2="20" y2="16"></line>
            <line x1="20" y1="12" x2="20" y2="3"></line>
            <line x1="1" y1="14" x2="7" y2="14"></line>
            <line x1="9" y1="8" x2="15" y2="8"></line>
            <line x1="17" y1="16" x2="23" y2="16"></line>
          </svg>
          <span className="float-btn-text">Tune Weights</span>
        </button>
      )}

      {/* Scoring weights drawer overlay */}
      {showScoring && (
        <div className="scoring-overlay" onClick={() => setShowScoring(false)}>
          <div className="scoring-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="scoring-drawer-header">
              <h3>Configuration</h3>
              <button
                className="scoring-close-btn"
                type="button"
                onClick={() => setShowScoring(false)}
                aria-label="Close weights panel"
              >
                ✕ Close
              </button>
            </div>
            <div className="scoring-drawer-content">
              <ScoringPanel
                analysis={rec.analysis}
                customWeights={rec.customWeights}
                onWeightChange={rec.handleWeightChange}
                onReset={rec.resetWeights}
              />
            </div>
          </div>
        </div>
      )}

      {/* Comparison Overlay */}
      {showComparison && compareModels.length >= 2 && (
        <ModelComparison
          models={compareModels}
          onRemove={(id) => handleCompareToggle(id)}
          onClose={() => {
            setCompareIds(new Set())
            setShowComparison(false)
          }}
        />
      )}
    </main>
  )
}

export default App
