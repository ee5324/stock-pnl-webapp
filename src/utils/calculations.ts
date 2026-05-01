import type {
  FeeSettings,
  PortfolioSummary,
  PositionSummary,
  QuoteData,
  TPlus2Summary,
  TPlus2Warning,
  TradeAction,
  TradeRecord,
} from '../types'

interface CostAccumulator {
  quantity: number
  costBasis: number
  realizedPnl: number
  lifetimeBuyCost: number
}

export interface TradeChargeBreakdown {
  grossAmount: number
  brokerFee: number
  tax: number
  netCash: number
}

export interface TPlus2Thresholds {
  payableAlert: number
  netOutflowAlert: number
}

export interface CapitalDisciplineSummary {
  capitalLimit: number
  cashBalance: number
  openPositionValue: number
  accountEquity: number
  isOpenValueEstimated: boolean
  withdrawableProfit: number
  principalGap: number
  buyBudget: number
}

export type PriceTargetMode = 'PERCENT' | 'AMOUNT'

export interface ShortTermTargetInput {
  mode: PriceTargetMode
  value: number
}

export interface StopLossSuggestion {
  symbol: string
  quantity: number
  averageCost: number
  currentPrice: number | null
  stopLossPrice: number
  takeProfitPrice: number
  distanceToStopPct: number | null
  distanceToTakeProfitPct: number | null
  isTriggered: boolean | null
  isTakeProfitTriggered: boolean | null
}

export const defaultFeeSettings: FeeSettings = {
  brokerFeeRate: 0.001425,
  brokerDiscount: 1,
  minBrokerFee: 20,
  sellTaxRate: 0.003,
}

function roundCurrency(value: number): number {
  return Math.round(value)
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addBusinessDays(baseDate: Date, days: number): Date {
  const result = new Date(baseDate)
  let remaining = days

  while (remaining > 0) {
    result.setDate(result.getDate() + 1)
    const weekday = result.getDay()
    if (weekday === 0 || weekday === 6) {
      continue
    }
    remaining -= 1
  }

  return result
}

function calculateBrokerFee(grossAmount: number, feeSettings: FeeSettings): number {
  const effectiveRate = feeSettings.brokerFeeRate * feeSettings.brokerDiscount
  return Math.max(roundCurrency(grossAmount * effectiveRate), feeSettings.minBrokerFee)
}

export function calculateTradeCharges(
  action: TradeAction,
  quantity: number,
  price: number,
  feeSettings: FeeSettings,
): TradeChargeBreakdown {
  const grossAmount = quantity * price
  const brokerFee = calculateBrokerFee(grossAmount, feeSettings)
  const tax =
    action === 'SELL' ? roundCurrency(grossAmount * feeSettings.sellTaxRate) : 0

  const netCash =
    action === 'BUY'
      ? -(grossAmount + brokerFee)
      : grossAmount - brokerFee - tax

  return {
    grossAmount,
    brokerFee,
    tax,
    netCash,
  }
}

export function calculatePortfolioSummary(
  trades: TradeRecord[],
  quotes: Record<string, QuoteData>,
  feeSettings: FeeSettings,
): PortfolioSummary {
  const accumulators = new Map<string, CostAccumulator>()

  const sortedTrades = [...trades].sort((left, right) => {
    if (left.tradedAt === right.tradedAt) {
      return left.createdAt - right.createdAt
    }
    return left.tradedAt.localeCompare(right.tradedAt)
  })

  for (const trade of sortedTrades) {
    const symbol = trade.symbol.toUpperCase()
    const current =
      accumulators.get(symbol) ?? {
        quantity: 0,
        costBasis: 0,
        realizedPnl: 0,
        lifetimeBuyCost: 0,
      }
    const charges = calculateTradeCharges(
      trade.action,
      trade.quantity,
      trade.price,
      feeSettings,
    )

    if (trade.action === 'BUY') {
      current.quantity += trade.quantity
      current.costBasis += charges.grossAmount + charges.brokerFee
      current.lifetimeBuyCost += charges.grossAmount + charges.brokerFee
      accumulators.set(symbol, current)
      continue
    }

    if (current.quantity <= 0) {
      continue
    }

    const soldQuantity = Math.min(trade.quantity, current.quantity)
    const avgCost = current.costBasis / current.quantity
    const soldCostBasis = avgCost * soldQuantity
    const soldGross = soldQuantity * trade.price
    const soldFee = calculateBrokerFee(soldGross, feeSettings)
    const soldTax = roundCurrency(soldGross * feeSettings.sellTaxRate)
    const proceeds = soldGross - soldFee - soldTax

    current.quantity -= soldQuantity
    current.costBasis -= soldCostBasis
    current.realizedPnl += proceeds - soldCostBasis

    if (current.quantity === 0) {
      current.costBasis = 0
    }

    accumulators.set(symbol, current)
  }

  const positions: PositionSummary[] = []
  let investedCapital = 0
  let realizedPnl = 0
  let marketValue = 0
  let unrealizedPnl = 0
  let hasUnknownQuote = false
  let totalBuyCost = 0
  let totalSellProceeds = 0

  for (const [symbol, info] of accumulators.entries()) {
    investedCapital += info.costBasis
    realizedPnl += info.realizedPnl

    const quote = quotes[symbol]
    const hasQuantity = info.quantity > 0
    const quotePrice = quote?.price

    let positionMarketValue: number | null = null
    let positionUnrealized: number | null = null

    if (!hasQuantity) {
      positionMarketValue = 0
      positionUnrealized = 0
    } else if (typeof quotePrice === 'number') {
      const grossValue = quotePrice * info.quantity
      const exitFee = calculateBrokerFee(grossValue, feeSettings)
      const exitTax = roundCurrency(grossValue * feeSettings.sellTaxRate)
      positionMarketValue = grossValue - exitFee - exitTax
      positionUnrealized = positionMarketValue - info.costBasis
      marketValue += positionMarketValue
      unrealizedPnl += positionUnrealized
    } else {
      hasUnknownQuote = true
    }

    let totalSymbolPnl: number | null
    if (!hasQuantity) {
      totalSymbolPnl = info.realizedPnl
    } else if (typeof quotePrice === 'number' && positionUnrealized !== null) {
      totalSymbolPnl = info.realizedPnl + positionUnrealized
    } else {
      totalSymbolPnl = null
    }

    const lifetimeBuyRounded = roundCurrency(info.lifetimeBuyCost)
    const returnRate =
      lifetimeBuyRounded <= 0 || totalSymbolPnl === null
        ? null
        : (totalSymbolPnl / lifetimeBuyRounded) * 100

    positions.push({
      symbol,
      quantity: info.quantity,
      averageCost: hasQuantity ? info.costBasis / info.quantity : 0,
      costBasis: info.costBasis,
      marketValue: positionMarketValue,
      unrealizedPnl: positionUnrealized,
      realizedPnl: info.realizedPnl,
      lifetimeBuyCost: lifetimeBuyRounded,
      totalPnl: totalSymbolPnl === null ? null : roundCurrency(totalSymbolPnl),
      returnRate,
    })
  }

  positions.sort((left, right) => left.symbol.localeCompare(right.symbol))

  const portfolioMarketValue = hasUnknownQuote ? null : marketValue
  const portfolioUnrealizedPnl = hasUnknownQuote ? null : unrealizedPnl
  const totalPnl =
    portfolioUnrealizedPnl === null ? null : realizedPnl + portfolioUnrealizedPnl

  for (const trade of sortedTrades) {
    const charges = calculateTradeCharges(
      trade.action,
      trade.quantity,
      trade.price,
      feeSettings,
    )

    if (trade.action === 'BUY') {
      totalBuyCost += charges.grossAmount + charges.brokerFee
      continue
    }

    totalSellProceeds += charges.grossAmount - charges.brokerFee - charges.tax
  }

  const overallReturnRate =
    totalPnl === null || totalBuyCost <= 0 ? null : (totalPnl / totalBuyCost) * 100

  return {
    positions,
    investedCapital,
    marketValue: portfolioMarketValue,
    realizedPnl,
    unrealizedPnl: portfolioUnrealizedPnl,
    totalPnl,
    totalBuyCost: roundCurrency(totalBuyCost),
    totalSellProceeds: roundCurrency(totalSellProceeds),
    overallReturnRate,
  }
}

export function calculateCapitalDisciplineSummary(
  trades: TradeRecord[],
  portfolioSummary: PortfolioSummary,
  feeSettings: FeeSettings,
  capitalLimit: number,
): CapitalDisciplineSummary {
  const normalizedCapitalLimit = Math.max(0, capitalLimit)
  let netCashFlow = 0

  for (const trade of trades) {
    const charges = calculateTradeCharges(
      trade.action,
      trade.quantity,
      trade.price,
      feeSettings,
    )
    netCashFlow += charges.netCash
  }

  const cashBalance = normalizedCapitalLimit + netCashFlow
  const isOpenValueEstimated = portfolioSummary.marketValue === null
  const openPositionValue =
    portfolioSummary.marketValue ?? portfolioSummary.investedCapital
  const accountEquity = cashBalance + openPositionValue
  const withdrawableProfit = Math.max(0, accountEquity - normalizedCapitalLimit)
  const principalGap = Math.max(0, normalizedCapitalLimit - accountEquity)
  const buyBudget = Math.max(0, Math.min(cashBalance, normalizedCapitalLimit))

  return {
    capitalLimit: roundCurrency(normalizedCapitalLimit),
    cashBalance: roundCurrency(cashBalance),
    openPositionValue: roundCurrency(openPositionValue),
    accountEquity: roundCurrency(accountEquity),
    isOpenValueEstimated,
    withdrawableProfit: roundCurrency(withdrawableProfit),
    principalGap: roundCurrency(principalGap),
    buyBudget: roundCurrency(buyBudget),
  }
}

export function calculateStopLossSuggestions(
  positions: PositionSummary[],
  quotes: Record<string, QuoteData>,
  stopLossInput: ShortTermTargetInput,
  takeProfitInput: ShortTermTargetInput,
): StopLossSuggestion[] {
  const safeStopLossValue = Math.max(0, stopLossInput.value)
  const safeTakeProfitValue = Math.max(0, takeProfitInput.value)

  const rows = positions
    .filter((item) => item.quantity > 0)
    .map((position) => {
      const currentPrice = quotes[position.symbol]?.price ?? null
      const stopLossPrice =
        stopLossInput.mode === 'PERCENT'
          ? position.averageCost *
            (1 - Math.min(Math.max(safeStopLossValue / 100, 0), 0.9))
          : Math.max(0, position.averageCost - safeStopLossValue)
      const takeProfitPrice =
        takeProfitInput.mode === 'PERCENT'
          ? position.averageCost *
            (1 + Math.min(Math.max(safeTakeProfitValue / 100, 0), 5))
          : position.averageCost + safeTakeProfitValue
      const distanceToStopPct =
        currentPrice === null || currentPrice === 0
          ? null
          : ((currentPrice - stopLossPrice) / currentPrice) * 100
      const distanceToTakeProfitPct =
        currentPrice === null || currentPrice === 0
          ? null
          : ((takeProfitPrice - currentPrice) / currentPrice) * 100
      const isTriggered =
        currentPrice === null ? null : currentPrice <= stopLossPrice
      const isTakeProfitTriggered =
        currentPrice === null ? null : currentPrice >= takeProfitPrice

      return {
        symbol: position.symbol,
        quantity: position.quantity,
        averageCost: position.averageCost,
        currentPrice,
        stopLossPrice,
        takeProfitPrice,
        distanceToStopPct,
        distanceToTakeProfitPct,
        isTriggered,
        isTakeProfitTriggered,
      } satisfies StopLossSuggestion
    })

  rows.sort((left, right) => {
    const score = (item: StopLossSuggestion): number => {
      if (item.isTriggered === true) {
        return 3
      }
      if (item.isTakeProfitTriggered === true) {
        return 2
      }
      return 1
    }

    const leftScore = score(left)
    const rightScore = score(right)
    if (leftScore !== rightScore) {
      return rightScore - leftScore
    }
    return left.symbol.localeCompare(right.symbol)
  })

  return rows
}

export function calculateTPlus2Summary(
  trades: TradeRecord[],
  feeSettings: FeeSettings,
  thresholds: TPlus2Thresholds,
): TPlus2Summary {
  const today = startOfLocalDay(new Date())
  const horizonDate = addBusinessDays(today, 2)
  const grouped = new Map<string, { payable: number; receivable: number }>()

  for (const trade of trades) {
    const tradeDate = new Date(trade.tradedAt)
    if (Number.isNaN(tradeDate.getTime())) {
      continue
    }

    const settlementDate = addBusinessDays(startOfLocalDay(tradeDate), 2)
    if (settlementDate < today || settlementDate > horizonDate) {
      continue
    }

    const settlementKey = formatDateKey(settlementDate)
    const current = grouped.get(settlementKey) ?? { payable: 0, receivable: 0 }
    const charges = calculateTradeCharges(
      trade.action,
      trade.quantity,
      trade.price,
      feeSettings,
    )

    if (trade.action === 'BUY') {
      current.payable += charges.grossAmount + charges.brokerFee
    } else {
      current.receivable += charges.grossAmount - charges.brokerFee - charges.tax
    }

    grouped.set(settlementKey, current)
  }

  const warnings: TPlus2Warning[] = Array.from(grouped.entries())
    .map(([settlementDate, values]) => {
      const payable = roundCurrency(values.payable)
      const receivable = roundCurrency(values.receivable)
      const netCashImpact = receivable - payable

      if (payable >= thresholds.payableAlert) {
        return {
          settlementDate,
          payable,
          receivable,
          netCashImpact,
          level: 'ALERT',
          warningText:
            '今日/近期 T+2 應付交割款偏高，若資金不足可能觸發違約交割風險。',
        } satisfies TPlus2Warning
      }

      if (netCashImpact <= -thresholds.netOutflowAlert) {
        return {
          settlementDate,
          payable,
          receivable,
          netCashImpact,
          level: 'WATCH',
          warningText: 'T+2 淨流出偏大，建議提前確認銀行餘額與交割專戶資金。',
        } satisfies TPlus2Warning
      }

      if (netCashImpact < 0) {
        return {
          settlementDate,
          payable,
          receivable,
          netCashImpact,
          level: 'WATCH',
          warningText: 'T+2 略為淨流出，建議留意資金調度與加碼節奏。',
        } satisfies TPlus2Warning
      }

      return {
        settlementDate,
        payable,
        receivable,
        netCashImpact,
        level: 'INFO',
        warningText: 'T+2 交割壓力中性，現金流風險相對可控。',
      } satisfies TPlus2Warning
    })
    .sort((left, right) => left.settlementDate.localeCompare(right.settlementDate))

  const totalPayable = warnings.reduce((sum, item) => sum + item.payable, 0)
  const totalReceivable = warnings.reduce((sum, item) => sum + item.receivable, 0)
  const netCashImpact = totalReceivable - totalPayable

  return {
    warnings,
    totalPayable: roundCurrency(totalPayable),
    totalReceivable: roundCurrency(totalReceivable),
    netCashImpact: roundCurrency(netCashImpact),
  }
}
