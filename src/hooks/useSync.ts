import { useState, useCallback, useEffect } from 'react'
import type { SyncLog } from '../types'
import * as api from '../api/client'

export function useSync(onSyncComplete?: () => void) {
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState('')
  const [syncHistory, setSyncHistory] = useState<SyncLog[]>([])

  const fetchHistory = useCallback(async () => {
    try {
      const data = await api.fetchSyncHistory()
      setSyncHistory((data.history || []) as SyncLog[])
    } catch (err) {
      console.warn('Failed to load sync history:', err)
    }
  }, [])

  const triggerSync = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    setSyncStatus('Connecting to API and syncing OpenRouter & Hugging Face registries...')
    try {
      const data = await api.triggerSync(120)
      setSyncStatus(`Sync finished! Added ${data.added} models, updated ${data.updated} models.`)
      fetchHistory()
      onSyncComplete?.()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Server unreachable'
      setSyncStatus(`Sync error: ${message}`)
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncStatus(''), 7000)
    }
  }, [syncing, fetchHistory, onSyncComplete])

  // Load sync history on mount
  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  return {
    syncing,
    syncStatus,
    syncHistory,
    triggerSync,
    fetchHistory,
  }
}
