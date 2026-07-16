// ─── Core Model Types ───

export type ModelCategory =
  | 'general'
  | 'code'
  | 'image'
  | 'video'
  | 'voice'
  | 'music'
  | 'document'

export type ModelUseCase =
  | ModelCategory
  | 'agent'
  | 'rag'
  | 'vision'
  | 'image_generation'
  | 'video_generation'
  | 'speech_to_text'
  | 'text_to_speech'
  | 'music_generation'
  | 'embedding'
  | 'reranking'

export type ModelRecordType =
  | 'api_model'
  | 'open_weight_model'
  | 'hosted_open_model'
  | 'hf_repo'
  | 'model_family'
  | 'strategy_template'

export type SourceAuthority = 'first_party' | 'aggregator' | 'benchmark' | 'curated' | 'seed' | 'heuristic'
export type LinkStatus = 'verified' | 'unverified' | 'catalog' | 'broken'

export type ModelProfile = {
  id: string
  name: string
  provider: string
  category: ModelCategory
  primaryUseCases?: ModelUseCase[]
  secondaryUseCases?: ModelUseCase[]
  recordType?: ModelRecordType
  sourceAuthority?: SourceAuthority
  linkStatus?: LinkStatus
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
  sourceTrust?: number
  reasons?: string[]
  warnings?: string[]
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
  parserUsed: 'gemini' | 'openai' | 'cohere' | 'regex'
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

export type StrategyTemplate = {
  id: string
  name: string
  useCase: ModelUseCase
  description: string
  recommendedComponents: string[]
  exampleProviders: string[]
}

export type RecommendationResponse = {
  analysis: PromptAnalysis
  recommendations: RecommendedModel[]
  strategies?: StrategyTemplate[]
  totalMatches: number
  parserUsed?: string
  registry?: {
    modelCount: number
    lastUpdated: string
  }
}
