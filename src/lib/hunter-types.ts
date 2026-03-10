/**
 * Hunter — shared client-safe types.
 *
 * Imported by both the Hunter page (client component) and the resource
 * handlers (server-only). Keeping them here avoids re-declaring the
 * same shapes in multiple files and prevents accidental server-only
 * imports in client components.
 */

export type PipelineRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type HunterRecommendation = 'BID_HIGH' | 'BID_MEDIUM' | 'BID_LOW' | 'NO_BID' | 'ERROR'

export type PipelineRun = {
  id: string
  source_id: string
  province: string
  municipality: string | null
  status: PipelineRunStatus
  started_at: number | null
  completed_at: number | null
  total_listings: number
  evaluated: number
  bid_high: number
  bid_medium: number
  bid_low: number
  no_bid: number
  error_count: number
  report_md?: string | null
  csv_path?: string | null
  triggered_by: string
  created_at: number
  available_cash?: number
  source_url?: string | null
  discovery_query?: string | null
  source_name?: string | null
}

export type HunterProperty = {
  id: string
  run_id: string
  address: string
  municipality: string | null
  province: string
  property_key: string | null
  source_url: string | null
  minimum_bid: number | null
  assessed_value: number | null
  estimated_value: number | null
  recommended_bid: number | null
  score: number | null
  recommendation: HunterRecommendation | null
  rationale: string | null
  risks: string   // JSON string: string[]
  opportunities: string  // JSON string: string[]
  details?: string | null  // JSON string: PropertyDetails
  created_at: number
}

/** Full analysis blob stored in hunter_properties.details JSON column */
export type PropertyDetails = {
  propertyId?: string
  pid?: string
  additionalPids?: string[]
  address: string
  municipality?: string
  province?: string

  // Assessment & financials
  assessmentValue?: number | null
  minimumBid?: number
  hstApplicable?: boolean
  totalMinimumBid?: number
  recommendedBidAmount?: number
  recommendedBidPercentage?: number
  estimatedRehab?: number
  totalInvestment?: number

  // Property characteristics
  propertyType?: string
  lotSizeSqFt?: number | null
  lotSizeAcres?: number | null
  lotSizeRaw?: string
  waterfront?: boolean
  roadAccess?: boolean
  zoning?: string
  ownerNames?: string[]
  structuresPresent?: boolean
  structureDescription?: string
  easements?: string[]
  encumbrances?: string[]

  // Market analysis
  arv?: number
  arvConfidence?: 'high' | 'medium' | 'low'
  medianComparablePrice?: number

  // Location
  closestAirport?: string
  distanceToAirportKm?: number
  googleMapsLink?: string
  lat?: number
  lng?: number
  postalCode?: string

  // Competition
  competitionLevel?: string
  competitionSellThrough?: number
  competitionMedianMultiplier?: number
  competitionP75Multiplier?: number
  competitionRepeatBuyers?: number
  competitionRepeatBuyerNames?: string[]
  competitionYearsAnalyzed?: number[]
  competitionSummary?: string

  // Classification
  investmentTier?: string
  investmentTierLabel?: string
  killSwitchTriggered?: boolean
  killSwitchReason?: string
  redeemable?: string

  // Scoring
  score?: number
  scoreBreakdown?: ScoreFactor[]
  rankScore?: number
  recommendation?: string

  // Cash flow
  monthlyRentLow?: number | null
  monthlyRentHigh?: number | null
  annualCashFlowLow?: number | null
  annualCashFlowHigh?: number | null
  cashOnCashReturn?: string

  // Narratives
  keyStrengths?: string
  keyRisks?: string
  rentalIncomePotential?: string
  appreciationPotential?: string
  mustDoBeforeBid?: string
  dealSummary?: string
  notes?: string

  // Links & files
  propertyListingLinks?: string
  pdfPath?: string
  sourceUrl?: string
  publicRecordUrl?: string
}

export type ScoreFactor = {
  factor: string
  points: number
  maxPoints: number
  note: string
}

/** Standard list response shape from /api/store/[resource] */
export type ListResponse<T> = {
  items: T[]
  total: number
  limit: number
  offset: number
}
