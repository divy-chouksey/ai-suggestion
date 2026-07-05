import { useState } from 'react'
import type { AdvancedFilters as AdvancedFiltersType, LatencyRequirement, PrivacyLevel, ContextNeed } from '../types'

type AdvancedFiltersProps = {
  filters: AdvancedFiltersType
  onChange: (filters: AdvancedFiltersType) => void
}

const useCaseOptions = [
  'Customer Support',
  'Code Assistant',
  'Content Generation',
  'Data Analysis',
  'RAG Pipeline',
  'Research',
  'Creative Writing',
  'Translation',
]

const budgetSteps = [
  { label: 'Free', value: 0 },
  { label: '$0.5', value: 0.5 },
  { label: '$2', value: 2 },
  { label: '$5', value: 5 },
  { label: '$15', value: 15 },
  { label: '$50', value: 50 },
  { label: 'Any', value: -1 },
]

const latencyOptions: Array<{ label: string; value: LatencyRequirement }> = [
  { label: 'Realtime (<500ms)', value: 'realtime' },
  { label: 'Fast (<2s)', value: 'fast' },
  { label: 'Standard', value: 'standard' },
  { label: "Don't care", value: 'any' },
]

const privacyOptions: Array<{ label: string; value: PrivacyLevel }> = [
  { label: 'Cloud OK', value: 'cloud-ok' },
  { label: 'No training on data', value: 'no-training' },
  { label: 'Must self-host', value: 'self-host' },
  { label: 'Air-gapped', value: 'air-gapped' },
]

const contextOptions: Array<{ label: string; value: ContextNeed }> = [
  { label: 'Short (<8k)', value: 'short' },
  { label: 'Medium (32k)', value: 'medium' },
  { label: 'Large (128k+)', value: 'large' },
  { label: 'Massive (1M+)', value: 'massive' },
]

const modalityOptions = ['text', 'code', 'vision', 'audio', 'video', 'tools']

export function AdvancedFilters({ filters, onChange }: AdvancedFiltersProps) {
  const [expanded, setExpanded] = useState(false)

  const update = (patch: Partial<AdvancedFiltersType>) => {
    onChange({ ...filters, ...patch })
  }

  const activeCount = [
    filters.useCase,
    filters.budget !== undefined && filters.budget >= 0 ? filters.budget : undefined,
    filters.latency && filters.latency !== 'any' ? filters.latency : undefined,
    filters.privacy && filters.privacy !== 'cloud-ok' ? filters.privacy : undefined,
    filters.contextNeed,
    filters.modalities?.length ? filters.modalities : undefined,
  ].filter(Boolean).length

  return (
    <div className="advanced-filters-wrapper">
      <button
        className={`advanced-filters-toggle ${expanded ? 'expanded' : ''}`}
        type="button"
        onClick={() => setExpanded(!expanded)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="filter-icon">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        Advanced filters
        {activeCount > 0 && <span className="filter-count">{activeCount}</span>}
        <svg className={`chevron ${expanded ? 'rotated' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="advanced-filters-panel">
          {/* Use Case */}
          <div className="filter-group">
            <label className="filter-label">Use case</label>
            <div className="chip-row">
              {useCaseOptions.map((uc) => (
                <button
                  key={uc}
                  type="button"
                  className={`filter-chip ${filters.useCase === uc ? 'active' : ''}`}
                  onClick={() => update({ useCase: filters.useCase === uc ? undefined : uc })}
                >
                  {uc}
                </button>
              ))}
            </div>
          </div>

          {/* Budget */}
          <div className="filter-group">
            <label className="filter-label">Budget (per 1M tokens)</label>
            <div className="chip-row">
              {budgetSteps.map((step) => (
                <button
                  key={step.label}
                  type="button"
                  className={`filter-chip ${filters.budget === step.value ? 'active' : ''}`}
                  onClick={() => update({ budget: filters.budget === step.value ? undefined : step.value })}
                >
                  {step.label}
                </button>
              ))}
            </div>
          </div>

          {/* Latency */}
          <div className="filter-group">
            <label className="filter-label">Latency requirement</label>
            <div className="chip-row">
              {latencyOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`filter-chip ${filters.latency === opt.value ? 'active' : ''}`}
                  onClick={() => update({ latency: filters.latency === opt.value ? undefined : opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Privacy */}
          <div className="filter-group">
            <label className="filter-label">Privacy level</label>
            <div className="chip-row">
              {privacyOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`filter-chip ${filters.privacy === opt.value ? 'active' : ''}`}
                  onClick={() => update({ privacy: filters.privacy === opt.value ? undefined : opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Context */}
          <div className="filter-group">
            <label className="filter-label">Context window need</label>
            <div className="chip-row">
              {contextOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`filter-chip ${filters.contextNeed === opt.value ? 'active' : ''}`}
                  onClick={() => update({ contextNeed: filters.contextNeed === opt.value ? undefined : opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Modalities */}
          <div className="filter-group">
            <label className="filter-label">Required modalities</label>
            <div className="chip-row">
              {modalityOptions.map((mod) => {
                const isActive = filters.modalities?.includes(mod)
                return (
                  <button
                    key={mod}
                    type="button"
                    className={`filter-chip ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      const current = filters.modalities || []
                      const next = isActive
                        ? current.filter((m) => m !== mod)
                        : [...current, mod]
                      update({ modalities: next.length > 0 ? next : undefined })
                    }}
                  >
                    {mod}
                  </button>
                )
              })}
            </div>
          </div>

          {activeCount > 0 && (
            <button
              className="clear-filters-btn"
              type="button"
              onClick={() => onChange({})}
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  )
}
