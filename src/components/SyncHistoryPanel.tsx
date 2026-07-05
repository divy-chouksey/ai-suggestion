import type { SyncLog } from '../types'

type SyncHistoryPanelProps = {
  syncHistory: SyncLog[]
  registryStats: { modelCount: number; lastUpdated: string }
}

export function SyncHistoryPanel({ syncHistory, registryStats }: SyncHistoryPanelProps) {
  return (
    <section className="registry-section" id="registry" aria-labelledby="registry-title">
      <div>
        <div className="section-kicker">Data backbone</div>
        <h2 id="registry-title">Model registry designed for constant change.</h2>

        {registryStats.lastUpdated && (
          <p className="last-updated-text">
            Last registry update check: {new Date(registryStats.lastUpdated).toLocaleString()}
          </p>
        )}

        {syncHistory.length > 0 && (
          <div className="sync-history-panel">
            <h3>Synchronization Logs</h3>
            <div className="sync-logs-list">
              {syncHistory.map((log, index) => {
                const hasErrors = log.results.some((r) => !r.ok)
                return (
                  <div className="sync-log-entry" key={index}>
                    <div className="log-time">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      {' - '}
                      {new Date(log.timestamp).toLocaleDateString()}
                    </div>
                    <div className="log-status">
                      {hasErrors ? (
                        <span className="status-badge error">Errors</span>
                      ) : (
                        <span className="status-badge success">Success</span>
                      )}
                    </div>
                    <div className="log-summary">
                      Added: <strong>{log.added}</strong>, Updated: <strong>{log.updated}</strong>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="pipeline-grid">
        {[
          ['01', 'OpenRouter', 'Pricing, context windows, providers, and API availability.'],
          ['02', 'Hugging Face', 'Open model metadata, tasks, licenses, likes, and downloads.'],
          ['03', 'Benchmarks', 'Arena, Artificial Analysis, provider evals, and manual review.'],
          ['04', 'Snapshots', 'Daily diffs, confidence labels, source URLs, and stale-data alerts.'],
        ].map(([step, title, copy]) => (
          <article className="pipeline-card" key={step}>
            <span>{step}</span>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
