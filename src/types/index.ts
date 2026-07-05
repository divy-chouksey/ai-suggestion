// ─── Core Model Types ───

export type ModelCategory =
  | 'general'
  | 'code'
  | 'image'
  | 'video'
  | 'voice'
  | 'music'
  | 'document'

export type ModelProfile = {
  id: string
  name: string
  provider: string
  category: ModelCategory
  access: 'API' | 'Open source' | 'Hosted open model'
  modalities: string[]
  bestFor: string
  source: string
  sourceUrl?: string
  benchmarkSources?: string[]
  lastVerified?: string
  confidence?: number
  pricing?: {
    unit: string
    inputPerMillion: number
    outputPerMillion: number
  }
  contextLength?: number
  metrics: {
    quality: number
    affordability: number
    speed: number
    context: number
    privacy: number
    availability: number
  }
}

export type RecommendedModel = ModelProfile & {
  fit: number
  score: number
  reasons?: string[]
}

export type WeightKey = keyof ModelProfile['metrics']

export type SyncLog = {
  timestamp: string
  sources: string[]
  results: Array<{ source: string; ok: boolean; count?: number; error?: string }>
  added: number
  updated: number
  modelCount: number
}

export type SignalRule = {
  id: string
  label: string
  pattern: RegExp
  weights: Partial<Record<WeightKey, number>>
}

// ─── Prompt Analysis Types ───

export type PromptAnalysis = {
  prompt: string
  targetCategory: ModelCategory
  weights: Record<WeightKey, number>
  signals: Array<{ id: string; label: string }>
  isCustomized?: boolean
}

export type ParsedIntent = {
  category: ModelCategory | 'auto'
  priorities: WeightKey[]
  constraints: {
    maxPrice?: number
    minContext?: number
    mustSelfHost?: boolean
  }
  excludeProviders: string[]
  excludeModels: string[]
  negations: WeightKey[]
  useCaseSummary: string
  parserUsed: 'gemini' | 'openai' | 'regex'
}

// ─── Advanced Filter Types ───

export type LatencyRequirement = 'realtime' | 'fast' | 'standard' | 'any'
export type PrivacyLevel = 'cloud-ok' | 'no-training' | 'self-host' | 'air-gapped'
export type ContextNeed = 'short' | 'medium' | 'large' | 'massive'

export type AdvancedFilters = {
  useCase?: string
  budget?: number
  latency?: LatencyRequirement
  privacy?: PrivacyLevel
  contextNeed?: ContextNeed
  modalities?: string[]
}

// ─── Recommendation Request/Response ───

export type RecommendationRequest = {
  prompt: string
  category?: ModelCategory | 'auto'
  openOnly?: boolean
  maxInputPricePerMillion?: number
  weights?: Partial<Record<WeightKey, number>>
  filters?: AdvancedFilters
}

export type RecommendationResponse = {
  analysis: PromptAnalysis
  recommendations: RecommendedModel[]
  totalMatches: number
  parserUsed?: string
  registry?: {
    modelCount: number
    lastUpdated: string
  }
}
