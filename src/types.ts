export type TradeAction = 'BUY' | 'SELL'

export interface TradeRecord {
  id: string
  symbol: string
  action: TradeAction
  quantity: number
  price: number
  tradedAt: string
  note?: string
  createdAt: number
}

export interface LongTermHolding {
  id: string
  symbol: string
  quantity: number
  averageCost: number
  startedAt: string
  thesis?: string
  createdAt: number
}

export interface FeeSettings {
  brokerFeeRate: number
  brokerDiscount: number
  minBrokerFee: number
  sellTaxRate: number
}

export interface QuoteData {
  symbol: string
  price: number
  currency: string
  fetchedAt: string
  displayName?: string
}

export interface PositionSummary {
  symbol: string
  quantity: number
  averageCost: number
  costBasis: number
  marketValue: number | null
  unrealizedPnl: number | null
  realizedPnl: number
}

export interface PortfolioSummary {
  positions: PositionSummary[]
  investedCapital: number
  marketValue: number | null
  realizedPnl: number
  unrealizedPnl: number | null
  totalPnl: number | null
  totalBuyCost: number
  totalSellProceeds: number
  overallReturnRate: number | null
}

export type FlowSignalLevel =
  | 'HEAVY_BUY'
  | 'HEAVY_SELL'
  | 'NEUTRAL'
  | 'NO_DATA'

export interface InstitutionalFlowThresholds {
  foreignLots: number
  institutionalLots: number
}

export interface InstitutionalFlowEntry {
  symbol: string
  tradeDate: string
  foreignNetLots: number | null
  institutionalNetLots: number | null
  foreignSignal: FlowSignalLevel
  institutionalSignal: FlowSignalLevel
  warningText: string
}

export type SettlementWarningLevel = 'ALERT' | 'WATCH' | 'INFO'

export interface TPlus2Warning {
  settlementDate: string
  payable: number
  receivable: number
  netCashImpact: number
  level: SettlementWarningLevel
  warningText: string
}

export interface TPlus2Summary {
  warnings: TPlus2Warning[]
  totalPayable: number
  totalReceivable: number
  netCashImpact: number
}
