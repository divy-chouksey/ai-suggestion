import { useState, useCallback, useEffect, useRef } from 'react'
import type { RecommendedModel, WeightKey, ModelCategory, PromptAnalysis, AdvancedFilters, StrategyTemplate } from '../types'
import * as api from '../api/client'
import { getLocalRecommendations } from '../lib/scoring'
import { defaultWeights } from '../lib/constants'

export function useRecommendations() {
  const [prompt, setPrompt] = useState('')
  const [activeCategory, setActiveCategory] = useState<ModelCategory | 'auto'>('auto')
  const [openOnly, setOpenOnly] = useState(false)
  const [maxPrice, setMaxPrice] = useState<string>('')
  const [customWeights, setCustomWeights] = useState<Record<WeightKey, number> | null>(null)
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>({})
  const [hasSubmitted, setHasSubmitted] = useState(false)

  const [recommendations, setRecommendations] = useState<RecommendedModel[]>([])
  const [analysis, setAnalysis] = useState<PromptAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFallback, setIsFallback] = useState(false)
  const [registryStats, setRegistryStats] = useState({
    modelCount: 0,
    lastUpdated: '',
  })
  const [parserUsed, setParserUsed] = useState<string>('regex')
  const [strategies, setStrategies] = useState<StrategyTemplate[]>([])

  const inputRef = useRef<HTMLInputElement>(null)

  const fetchRecs = useCallback(
    async (
      currentPrompt: string,
      currentCategory: ModelCategory | 'auto',
      currentOpenOnly: boolean,
      currentMaxPrice: string,
      currentWeights: Record<WeightKey, number> | null,
      currentFilters?: AdvancedFilters
    ) => {
      setLoading(true)
      setError(null)
      try {
        const data = await api.fetchRecommendations(
          currentPrompt,
          currentCategory,
          currentOpenOnly,
          currentMaxPrice,
          currentWeights,
          currentFilters
        )
        setRecommendations(data.recommendations || [])
        setAnalysis(data.analysis || null)
        setStrategies(data.strategies || [])
        setIsFallback(false)
        setParserUsed(data.parserUsed || 'regex')
        if (data.registry) {
          setRegistryStats({
            modelCount: data.registry.modelCount,
            lastUpdated: data.registry.lastUpdated,
          })
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.warn('API error, falling back to local computation:', message)
        const fallbackData = getLocalRecommendations(
          currentPrompt,
          currentCategory,
          currentOpenOnly,
          currentMaxPrice,
          currentWeights
        )
        setRecommendations(fallbackData.recommendations)
        setAnalysis(fallbackData.analysis)
        setStrategies(fallbackData.strategies || [])
        setIsFallback(true)
        setParserUsed('regex')
      } finally {
        setLoading(false)
      }
    },
    []
  )

  // Debounced effect for recommendation retrieval — only after submission
  useEffect(() => {
    if (!hasSubmitted) return
    const timer = setTimeout(() => {
      if (prompt.trim().length >= 3) {
        fetchRecs(prompt, activeCategory, openOnly, maxPrice, customWeights, advancedFilters)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [prompt, activeCategory, openOnly, maxPrice, customWeights, advancedFilters, fetchRecs, hasSubmitted])

  const handleSubmit = useCallback(() => {
    if (prompt.trim().length < 3) return
    setHasSubmitted(true)
    fetchRecs(prompt, activeCategory, openOnly, maxPrice, customWeights, advancedFilters)
  }, [prompt, activeCategory, openOnly, maxPrice, customWeights, advancedFilters, fetchRecs])

  const handleWeightChange = useCallback(
    (key: WeightKey, val: number) => {
      const base = customWeights || analysis?.weights || defaultWeights
      setCustomWeights({ ...base, [key]: val })
    },
    [customWeights, analysis]
  )

  const resetWeights = useCallback(() => {
    setCustomWeights(null)
  }, [])

  const refreshResults = useCallback(() => {
    if (hasSubmitted && prompt.trim().length >= 3) {
      fetchRecs(prompt, activeCategory, openOnly, maxPrice, customWeights, advancedFilters)
    }
  }, [hasSubmitted, prompt, activeCategory, openOnly, maxPrice, customWeights, advancedFilters, fetchRecs])

  return {
    // State
    prompt,
    activeCategory,
    openOnly,
    maxPrice,
    customWeights,
    advancedFilters,
    hasSubmitted,
    recommendations,
    analysis,
    loading,
    error,
    isFallback,
    registryStats,
    parserUsed,
    strategies,
    inputRef,

    // Setters
    setPrompt,
    setActiveCategory,
    setOpenOnly,
    setMaxPrice,
    setCustomWeights,
    setAdvancedFilters,
    setHasSubmitted,
    setRegistryStats,

    // Actions
    handleSubmit,
    handleWeightChange,
    resetWeights,
    refreshResults,
    fetchRecs,
  }
}
