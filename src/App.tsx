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
          <span className="brand-mark">MC</span>
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
            <strong>Limited understanding:</strong> Configure a Gemini or OpenAI API key for richer prompt parsing.
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
          </section>

          <ScoringPanel
            analysis={rec.analysis}
            customWeights={rec.customWeights}
            onWeightChange={rec.handleWeightChange}
            onReset={rec.resetWeights}
          />
        </section>

        <SyncHistoryPanel
          syncHistory={sync.syncHistory}
          registryStats={rec.registryStats}
        />
      </div>

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
