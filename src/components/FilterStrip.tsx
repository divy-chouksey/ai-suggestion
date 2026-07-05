import type { ModelCategory } from '../types'
import { categoryLabels } from '../lib/constants'

type FilterStripProps = {
  activeCategory: ModelCategory | 'auto'
  onCategoryChange: (v: ModelCategory | 'auto') => void
  openOnly: boolean
  onOpenOnlyChange: (v: boolean) => void
  maxPrice: string
  onMaxPriceChange: (v: string) => void
}

export function FilterStrip({
  activeCategory,
  onCategoryChange,
  openOnly,
  onOpenOnlyChange,
  maxPrice,
  onMaxPriceChange,
}: FilterStripProps) {
  return (
    <section className="workspace">
      <section className="advisor-panel" aria-labelledby="advisor-title">
        <div className="control-row" aria-label="Model filters">
          <label className="select-wrap">
            <span>Mode</span>
            <select
              value={activeCategory}
              onChange={(event) =>
                onCategoryChange(event.target.value as ModelCategory | 'auto')
              }
            >
              <option value="auto">Auto detect</option>
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="switch">
            <input
              checked={openOnly}
              onChange={(event) => onOpenOnlyChange(event.target.checked)}
              type="checkbox"
            />
            <span>Open models only</span>
          </label>

          <label className="price-filter">
            <span>Max input cost ($/1M tokens)</span>
            <input
              type="number"
              min="0"
              step="0.1"
              placeholder="Unlimited"
              value={maxPrice}
              onChange={(e) => onMaxPriceChange(e.target.value)}
            />
          </label>
        </div>
      </section>
    </section>
  )
}
