import { quickPrompts } from '../lib/constants'

type SearchBarProps = {
  prompt: string
  setPrompt: (v: string) => void
  loading: boolean
  hasSubmitted: boolean
  onSubmit: () => void
  onQuickPrompt: (prompt: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
}

export function SearchBar({
  prompt,
  setPrompt,
  loading,
  hasSubmitted,
  onSubmit,
  onQuickPrompt,
  inputRef,
}: SearchBarProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <section className={`hero-section ${hasSubmitted ? 'hero-collapsed' : ''}`}>
      <div className="hero-inner">
        {!hasSubmitted && (
          <div className="hero-headline">
            <div className="section-kicker">AI Model Advisor</div>
            <h1>Find the model mix that actually fits the job.</h1>
          </div>
        )}

        <div className={`search-container ${hasSubmitted ? 'search-compact' : ''}`}>
          <div className="search-box">
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              className="search-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you need an AI model for..."
              spellCheck={true}
              aria-label="Describe your AI model requirement"
            />
            {loading && <div className="search-spinner"><div className="spinner"></div></div>}
            <button
              className="search-submit"
              type="button"
              onClick={onSubmit}
              disabled={prompt.trim().length < 3}
              aria-label="Search"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        </div>

        {!hasSubmitted && (
          <div className="quick-prompts-row">
            {quickPrompts.map((item) => (
              <button
                className="quick-chip"
                key={item}
                type="button"
                onClick={() => onQuickPrompt(item)}
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
