import type { WeightKey, ModelCategory, RecommendationResponse, AdvancedFilters } from '../types'

const API_BASE = '/api'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function fetchRecommendations(
  prompt: string,
  category: ModelCategory | 'auto',
  openOnly: boolean,
  maxPrice: string,
  weights: Record<WeightKey, number> | null,
  filters?: AdvancedFilters
): Promise<RecommendationResponse> {
  const payload: Record<string, unknown> = {
    prompt,
    category,
    openOnly,
  }
  if (maxPrice.trim() !== '') {
    payload.maxInputPricePerMillion = Number(maxPrice)
  }
  if (weights) {
    payload.weights = weights
  }
  if (filters) {
    payload.filters = filters
  }

  const res = await fetch(`${API_BASE}/recommendations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}))
    throw new ApiError(
      errData.error || `Server responded with status ${res.status}`,
      res.status
    )
  }

  return res.json()
}

export async function fetchSyncHistory(): Promise<{
  sources: string[]
  history: Array<Record<string, unknown>>
}> {
  const res = await fetch(`${API_BASE}/sources`)
  if (!res.ok) {
    throw new ApiError(`Failed to fetch sync history`, res.status)
  }
  return res.json()
}

export async function triggerSync(limit = 120): Promise<{
  ok: boolean
  added: number
  updated: number
  error?: string
}> {
  const res = await fetch(`${API_BASE}/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ limit }),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new ApiError(data.error || 'Sync failed', res.status)
  }
  return data
}
