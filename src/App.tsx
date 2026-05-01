import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import InstitutionalSignalsSection from './components/InstitutionalSignalsSection'
import StockSuggestionsSection from './components/StockSuggestionsSection'
import { isFirebaseConfigured } from './firebase'
import {
  authWhitelistEmails,
  authWhitelistEnabled,
  isEmailWhitelisted,
  loginWithGoogle,
  logoutCurrentUser,
  subscribeAuth,
} from './services/authService'
import { fetchInstitutionalFlowSignals } from './services/institutionalFlowApi'
import {
  createLongTermHolding,
  deleteLongTermHolding,
  getLongTermHoldings,
} from './services/longTermHoldingRepository'
import { fetchLatestQuote } from './services/quoteApi'
import {
  createTrade,
  removeTrade,
  storageMode,
  subscribeTrades,
} from './services/tradeRepository'
import {
  calculateCapitalDisciplineSummary,
  calculatePortfolioSummary,
  calculateStopLossSuggestions,
  calculateTPlus2Summary,
  calculateTradeCharges,
  defaultFeeSettings,
  type TPlus2Thresholds,
} from './utils/calculations'
import type {
  FeeSettings,
  InstitutionalFlowEntry,
  InstitutionalFlowThresholds,
  LongTermHolding,
  QuoteData,
  TradeAction,
  TradeRecord,
} from './types'

interface TradeFormState {
  symbol: string
  action: TradeAction
  quantity: string
  price: string
  tradedAt: string
  note: string
}

interface LongTermFormState {
  symbol: string
  quantity: string
  averageCost: string
  startedAt: string
  thesis: string
}

type AppTab = 'dashboard' | 'longterm' | 'settings'

interface AuthUser {
  uid: string
  email: string | null
  displayName: string | null
}

type LongTermAdviceLevel = 'SELL' | 'WATCH' | 'HOLD' | 'NO_DATA'

interface LongTermAdvisory {
  symbol: string
  returnRate: number | null
  currentPrice: number | null
  stopLossPrice: number
  targetPrice: number
  level: LongTermAdviceLevel
  actionText: string
  reasonText: string
}

const currencyFormatter = new Intl.NumberFormat('zh-TW', {
  style: 'currency',
  currency: 'TWD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const numberFormatter = new Intl.NumberFormat('zh-TW', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const percentFormatter = new Intl.NumberFormat('zh-TW', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function getCurrentDatetimeInputValue(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function getCurrentDateInputValue(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function formatCurrency(value: number | null): string {
  if (value === null) {
    return '--'
  }
  return currencyFormatter.format(value)
}

function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return '--'
  }

  return `${percentFormatter.format(value)}%`
}

function getTPlus2LevelDisplay(level: 'ALERT' | 'WATCH' | 'INFO'): {
  text: string
  className: string
} {
  if (level === 'ALERT') {
    return { text: '高風險', className: 'sell' }
  }
  if (level === 'WATCH') {
    return { text: '注意', className: 'watch' }
  }
  return { text: '一般', className: 'neutral' }
}

function getStopLossStatusDisplay(isTriggered: boolean | null): {
  text: string
  className: string
} {
  if (isTriggered === true) {
    return { text: '觸發停損', className: 'sell' }
  }
  if (isTriggered === false) {
    return { text: '續抱觀察', className: 'buy' }
  }
  return { text: '待報價', className: 'na' }
}

function getLongTermAdviceDisplay(level: LongTermAdviceLevel): {
  text: string
  className: string
} {
  if (level === 'SELL') {
    return { text: '賣出/減碼', className: 'sell' }
  }
  if (level === 'WATCH') {
    return { text: '轉投資觀察', className: 'watch' }
  }
  if (level === 'NO_DATA') {
    return { text: '資料不足', className: 'na' }
  }
  return { text: '續抱', className: 'buy' }
}

function toClassBySign(value: number | null): string {
  if (value === null || value === 0) {
    return ''
  }

  return value > 0 ? 'positive' : 'negative'
}

function parseInputDate(value: string): string {
  return new Date(value).toISOString()
}

function parseSymbolList(input: string): string[] {
  return [...new Set(input.split(',').map((value) => value.trim().toUpperCase()))].filter(
    Boolean,
  )
}

function getAutoInstitutionalThresholds(
  symbols: string[],
): InstitutionalFlowThresholds {
  const taiwanSymbols = symbols.filter((value) => /^\d{4,6}$/.test(value))
  const etfSymbols = taiwanSymbols.filter((value) => /^00\d{2}$/.test(value))

  let foreignLots = 1800
  let institutionalLots = 900

  if (taiwanSymbols.length >= 12) {
    foreignLots += 400
    institutionalLots += 200
  }

  if (etfSymbols.length > 0 && etfSymbols.length / taiwanSymbols.length >= 0.5) {
    foreignLots += 800
    institutionalLots += 400
  }

  return {
    foreignLots: Math.round(foreignLots / 100) * 100,
    institutionalLots: Math.round(institutionalLots / 100) * 100,
  }
}

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard')
  const [trades, setTrades] = useState<TradeRecord[]>([])
  const [longTermHoldings, setLongTermHoldings] = useState<LongTermHolding[]>(() =>
    getLongTermHoldings(),
  )
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({})
  const [quoteLoading, setQuoteLoading] = useState<Record<string, boolean>>({})
  const [quoteErrors, setQuoteErrors] = useState<Record<string, string>>({})
  const [isLoadingTrades, setIsLoadingTrades] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRefreshingAll, setIsRefreshingAll] = useState(false)
  const [isRefreshingLongTermQuotes, setIsRefreshingLongTermQuotes] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [longTermErrorMessage, setLongTermErrorMessage] = useState('')
  const [longTermSuccessMessage, setLongTermSuccessMessage] = useState('')
  const [isSubmittingLongTerm, setIsSubmittingLongTerm] = useState(false)
  const [longTermStopLossRate, setLongTermStopLossRate] = useState(0.12)
  const [longTermTargetRate, setLongTermTargetRate] = useState(0.25)
  const [longTermRotateLossRate, setLongTermRotateLossRate] = useState(0.15)
  const [feeSettings, setFeeSettings] = useState<FeeSettings>(defaultFeeSettings)
  const [capitalLimit] = useState(20000)
  const [stopLossRate, setStopLossRate] = useState(0.03)
  const [tPlus2Thresholds, setTPlus2Thresholds] = useState<TPlus2Thresholds>({
    payableAlert: 300000,
    netOutflowAlert: 150000,
  })
  const [autoTrackEnabled, setAutoTrackEnabled] = useState(true)
  const [autoTrackIntervalSec, setAutoTrackIntervalSec] = useState(120)
  const [lastAutoRefreshAt, setLastAutoRefreshAt] = useState('')
  const [watchlistInput, setWatchlistInput] = useState('')
  const [institutionalRows, setInstitutionalRows] = useState<InstitutionalFlowEntry[]>([])
  const [isRefreshingInstitutional, setIsRefreshingInstitutional] = useState(false)
  const [institutionalError, setInstitutionalError] = useState('')
  const [institutionalAutoEnabled, setInstitutionalAutoEnabled] = useState(true)
  const [institutionalAutoIntervalMin, setInstitutionalAutoIntervalMin] = useState(30)
  const [lastInstitutionalRefreshAt, setLastInstitutionalRefreshAt] = useState('')
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [isAuthChecking, setIsAuthChecking] = useState(
    authWhitelistEnabled && isFirebaseConfigured,
  )
  const [isAuthBusy, setIsAuthBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [form, setForm] = useState<TradeFormState>({
    symbol: '',
    action: 'BUY',
    quantity: '',
    price: '',
    tradedAt: getCurrentDatetimeInputValue(),
    note: '',
  })
  const [longTermForm, setLongTermForm] = useState<LongTermFormState>({
    symbol: '',
    quantity: '',
    averageCost: '',
    startedAt: getCurrentDateInputValue(),
    thesis: '',
  })

  const isAccessGranted =
    !authWhitelistEnabled || isEmailWhitelisted(authUser?.email ?? null)
  const isLockedByWhitelist = authWhitelistEnabled && !isAccessGranted
  const authConfigWarning =
    authWhitelistEnabled && !isFirebaseConfigured
      ? 'Firebase 尚未設定完成，無法啟用白名單登入。'
      : ''

  useEffect(() => {
    if (!authWhitelistEnabled || !isFirebaseConfigured) {
      return () => undefined
    }

    const unsubscribe = subscribeAuth(
      (nextUser) => {
        setAuthUser(nextUser)
        setIsAuthChecking(false)

        if (nextUser && !isEmailWhitelisted(nextUser.email)) {
          setAuthMessage('此帳號不在白名單，已自動登出。')
          void logoutCurrentUser()
          return
        }

        setAuthMessage('')
      },
      (message) => {
        setAuthMessage(`登入狀態監聽失敗：${message}`)
        setIsAuthChecking(false)
      },
    )

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!isAccessGranted) {
      return () => undefined
    }
    const unsubscribe = subscribeTrades(
      (nextTrades) => {
        setTrades(nextTrades)
        setIsLoadingTrades(false)
      },
      (message) => {
        setErrorMessage(`載入交易資料失敗：${message}`)
        setIsLoadingTrades(false)
      },
    )

    return unsubscribe
  }, [isAccessGranted])

  const tradeTrackedSymbols = useMemo(() => {
    const quantityMap = new Map<string, number>()

    for (const trade of trades) {
      const symbol = trade.symbol.toUpperCase()
      const quantity = quantityMap.get(symbol) ?? 0
      const delta = trade.action === 'BUY' ? trade.quantity : -trade.quantity
      quantityMap.set(symbol, quantity + delta)
    }

    return Array.from(quantityMap.entries())
      .filter(([, quantity]) => quantity > 0)
      .map(([symbol]) => symbol)
      .sort((left, right) => left.localeCompare(right))
  }, [trades])

  const longTermSymbols = useMemo(() => {
    return Array.from(
      new Set(
        longTermHoldings.map((holding) => {
          return holding.symbol.toUpperCase()
        }),
      ),
    ).sort((left, right) => left.localeCompare(right))
  }, [longTermHoldings])

  const trackedSymbols = useMemo(() => {
    return Array.from(new Set([...tradeTrackedSymbols, ...longTermSymbols])).sort(
      (left, right) => left.localeCompare(right),
    )
  }, [tradeTrackedSymbols, longTermSymbols])

  const watchlistSymbols = useMemo(() => {
    return parseSymbolList(watchlistInput)
  }, [watchlistInput])

  const institutionalTargetSymbols = useMemo(() => {
    return Array.from(new Set([...trackedSymbols, ...watchlistSymbols])).sort((a, b) =>
      a.localeCompare(b),
    )
  }, [trackedSymbols, watchlistSymbols])

  const institutionalThresholds = useMemo(() => {
    return getAutoInstitutionalThresholds(institutionalTargetSymbols)
  }, [institutionalTargetSymbols])

  const portfolioSummary = useMemo(() => {
    return calculatePortfolioSummary(trades, quotes, feeSettings)
  }, [trades, quotes, feeSettings])

  const capitalDiscipline = useMemo(() => {
    return calculateCapitalDisciplineSummary(
      trades,
      portfolioSummary,
      feeSettings,
      capitalLimit,
    )
  }, [trades, portfolioSummary, feeSettings, capitalLimit])

  const stopLossSuggestions = useMemo(() => {
    return calculateStopLossSuggestions(
      portfolioSummary.positions,
      quotes,
      stopLossRate,
    )
  }, [portfolioSummary.positions, quotes, stopLossRate])

  const tPlus2Summary = useMemo(() => {
    return calculateTPlus2Summary(trades, feeSettings, tPlus2Thresholds)
  }, [trades, feeSettings, tPlus2Thresholds])

  const positionLookup = useMemo(() => {
    const lookup: Record<string, number> = {}
    for (const position of portfolioSummary.positions) {
      lookup[position.symbol] = position.quantity
    }
    return lookup
  }, [portfolioSummary.positions])

  const longTermRows = useMemo(() => {
    return longTermHoldings.map((holding) => {
      const symbol = holding.symbol.toUpperCase()
      const currentPrice = quotes[symbol]?.price ?? null
      const costBasis = holding.quantity * holding.averageCost
      const marketValue =
        currentPrice === null ? null : currentPrice * holding.quantity
      const unrealizedPnl =
        marketValue === null ? null : marketValue - costBasis

      return {
        ...holding,
        symbol,
        costBasis,
        currentPrice,
        marketValue,
        unrealizedPnl,
      }
    })
  }, [longTermHoldings, quotes])

  const longTermSummary = useMemo(() => {
    let totalCost = 0
    let totalMarket = 0
    let totalUnrealized = 0
    let hasUnknownQuote = false

    for (const row of longTermRows) {
      totalCost += row.costBasis
      if (row.marketValue === null || row.unrealizedPnl === null) {
        hasUnknownQuote = true
        continue
      }
      totalMarket += row.marketValue
      totalUnrealized += row.unrealizedPnl
    }

    return {
      totalCost,
      totalMarket: hasUnknownQuote ? null : totalMarket,
      totalUnrealized: hasUnknownQuote ? null : totalUnrealized,
      hasUnknownQuote,
    }
  }, [longTermRows])

  const institutionalLookup = useMemo(() => {
    const lookup: Record<string, InstitutionalFlowEntry> = {}
    for (const row of institutionalRows) {
      lookup[row.symbol.toUpperCase()] = row
    }
    return lookup
  }, [institutionalRows])

  const longTermAdvisories = useMemo(() => {
    return longTermRows
      .map((row) => {
        const institutional = institutionalLookup[row.symbol]
        const returnRate =
          row.currentPrice === null || row.averageCost === 0
            ? null
            : ((row.currentPrice - row.averageCost) / row.averageCost) * 100
        const stopLossPrice = row.averageCost * (1 - longTermStopLossRate)
        const targetPrice = row.averageCost * (1 + longTermTargetRate)

        const foreignHeavySell = institutional?.foreignSignal === 'HEAVY_SELL'
        const institutionalHeavySell =
          institutional?.institutionalSignal === 'HEAVY_SELL'
        const heavySell = foreignHeavySell || institutionalHeavySell
        const belowStop =
          row.currentPrice !== null && row.currentPrice <= stopLossPrice
        const deepLoss =
          returnRate !== null && returnRate <= -(longTermRotateLossRate * 100)
        const reachTarget =
          returnRate !== null && returnRate >= longTermTargetRate * 100

        if (row.currentPrice === null) {
          return {
            symbol: row.symbol,
            returnRate,
            currentPrice: row.currentPrice,
            stopLossPrice,
            targetPrice,
            level: 'NO_DATA',
            actionText: '補齊報價再判斷',
            reasonText: '缺少即時價格，暫無法評估賣出或轉投資時機。',
          } satisfies LongTermAdvisory
        }

        if ((belowStop && heavySell) || (deepLoss && heavySell)) {
          return {
            symbol: row.symbol,
            returnRate,
            currentPrice: row.currentPrice,
            stopLossPrice,
            targetPrice,
            level: 'SELL',
            actionText: '建議分批賣出並評估轉投資',
            reasonText:
              '股價跌破停損或深度虧損，且法人偏空，屬於資金效率惡化警訊。',
          } satisfies LongTermAdvisory
        }

        if (reachTarget && heavySell) {
          return {
            symbol: row.symbol,
            returnRate,
            currentPrice: row.currentPrice,
            stopLossPrice,
            targetPrice,
            level: 'WATCH',
            actionText: '考慮獲利了結一部分',
            reasonText: '已達獲利目標但法人轉弱，建議分批落袋、保留機動資金。',
          } satisfies LongTermAdvisory
        }

        if (deepLoss) {
          return {
            symbol: row.symbol,
            returnRate,
            currentPrice: row.currentPrice,
            stopLossPrice,
            targetPrice,
            level: 'WATCH',
            actionText: '檢視基本面與持有理由',
            reasonText: '虧損擴大，若投資邏輯轉弱可考慮換股轉投資。',
          } satisfies LongTermAdvisory
        }

        if (heavySell) {
          return {
            symbol: row.symbol,
            returnRate,
            currentPrice: row.currentPrice,
            stopLossPrice,
            targetPrice,
            level: 'WATCH',
            actionText: '提高警戒，觀察是否續弱',
            reasonText: '法人連續偏賣，若同步跌破停損建議區可轉為減碼。',
          } satisfies LongTermAdvisory
        }

        return {
          symbol: row.symbol,
          returnRate,
          currentPrice: row.currentPrice,
          stopLossPrice,
          targetPrice,
          level: 'HOLD',
          actionText: '續抱，維持紀律追蹤',
          reasonText: '報價與籌碼尚未出現明顯轉弱警訊。',
        } satisfies LongTermAdvisory
      })
      .sort((left, right) => {
        const priority: Record<LongTermAdviceLevel, number> = {
          SELL: 4,
          WATCH: 3,
          NO_DATA: 2,
          HOLD: 1,
        }
        if (priority[left.level] !== priority[right.level]) {
          return priority[right.level] - priority[left.level]
        }
        return left.symbol.localeCompare(right.symbol)
      })
  }, [
    longTermRows,
    institutionalLookup,
    longTermStopLossRate,
    longTermTargetRate,
    longTermRotateLossRate,
  ])

  const rotationCandidates = useMemo(() => {
    const holdingSet = new Set(longTermRows.map((row) => row.symbol))

    return institutionalRows
      .filter((row) => !holdingSet.has(row.symbol))
      .filter(
        (row) =>
          row.foreignSignal === 'HEAVY_BUY' ||
          row.institutionalSignal === 'HEAVY_BUY',
      )
      .slice(0, 6)
  }, [institutionalRows, longTermRows])

  const longTermAdviceSummary = useMemo(() => {
    const result = { sell: 0, watch: 0, hold: 0, noData: 0 }
    for (const item of longTermAdvisories) {
      if (item.level === 'SELL') {
        result.sell += 1
      } else if (item.level === 'WATCH') {
        result.watch += 1
      } else if (item.level === 'HOLD') {
        result.hold += 1
      } else {
        result.noData += 1
      }
    }
    return result
  }, [longTermAdvisories])

  const autoRefreshInFlightRef = useRef(false)

  const refreshQuote = useCallback(async (symbol: string) => {
    const normalized = symbol.trim().toUpperCase()
    if (!normalized) {
      return
    }

    setQuoteLoading((prev) => ({ ...prev, [normalized]: true }))

    try {
      const quote = await fetchLatestQuote(normalized)
      setQuotes((prev) => ({ ...prev, [normalized]: quote }))
      setQuoteErrors((prev) => {
        const next = { ...prev }
        delete next[normalized]
        return next
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知錯誤'
      setQuoteErrors((prev) => ({ ...prev, [normalized]: message }))
    } finally {
      setQuoteLoading((prev) => ({ ...prev, [normalized]: false }))
    }
  }, [])

  const refreshQuotesForSymbols = useCallback(
    async (targetSymbols: string[]) => {
      if (targetSymbols.length === 0) {
        return
      }

      await Promise.all(targetSymbols.map((symbol) => refreshQuote(symbol)))
    },
    [refreshQuote],
  )

  useEffect(() => {
    if (!isAccessGranted || !autoTrackEnabled || trackedSymbols.length === 0) {
      return () => undefined
    }

    let isDisposed = false

    const runAutoRefresh = async () => {
      if (autoRefreshInFlightRef.current || document.visibilityState === 'hidden') {
        return
      }

      autoRefreshInFlightRef.current = true
      try {
        await refreshQuotesForSymbols(trackedSymbols)
        if (!isDisposed) {
          setLastAutoRefreshAt(new Date().toISOString())
        }
      } finally {
        autoRefreshInFlightRef.current = false
      }
    }

    const safeIntervalSeconds = Math.max(60, Math.round(autoTrackIntervalSec))
    const immediateTaskId = window.setTimeout(() => {
      void runAutoRefresh()
    }, 0)
    const intervalTaskId = window.setInterval(() => {
      void runAutoRefresh()
    }, safeIntervalSeconds * 1000)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void runAutoRefresh()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      isDisposed = true
      window.clearTimeout(immediateTaskId)
      window.clearInterval(intervalTaskId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [
    isAccessGranted,
    autoTrackEnabled,
    autoTrackIntervalSec,
    trackedSymbols,
    refreshQuotesForSymbols,
  ])

  const institutionalRefreshInFlightRef = useRef(false)

  const refreshInstitutionalSignals = useCallback(async () => {
    if (institutionalTargetSymbols.length === 0) {
      setInstitutionalRows([])
      setInstitutionalError('')
      return
    }

    setIsRefreshingInstitutional(true)
    setInstitutionalError('')

    try {
      const nextRows = await fetchInstitutionalFlowSignals(
        institutionalTargetSymbols,
        institutionalThresholds,
      )
      setInstitutionalRows(nextRows)
      setLastInstitutionalRefreshAt(new Date().toISOString())
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知錯誤'
      setInstitutionalError(`更新法人資料失敗：${message}`)
    } finally {
      setIsRefreshingInstitutional(false)
    }
  }, [institutionalTargetSymbols, institutionalThresholds])

  useEffect(() => {
    if (
      !isAccessGranted ||
      !institutionalAutoEnabled ||
      institutionalTargetSymbols.length === 0
    ) {
      return () => undefined
    }

    const runAutoRefresh = async () => {
      if (
        institutionalRefreshInFlightRef.current ||
        document.visibilityState === 'hidden'
      ) {
        return
      }

      institutionalRefreshInFlightRef.current = true
      try {
        await refreshInstitutionalSignals()
      } finally {
        institutionalRefreshInFlightRef.current = false
      }
    }

    const safeIntervalMinutes = Math.max(10, Math.round(institutionalAutoIntervalMin))
    const initialTaskId = window.setTimeout(() => {
      void runAutoRefresh()
    }, 0)
    const intervalTaskId = window.setInterval(() => {
      void runAutoRefresh()
    }, safeIntervalMinutes * 60_000)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void runAutoRefresh()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearTimeout(initialTaskId)
      window.clearInterval(intervalTaskId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [
    isAccessGranted,
    institutionalAutoEnabled,
    institutionalAutoIntervalMin,
    institutionalTargetSymbols,
    refreshInstitutionalSignals,
  ])

  const handleTradeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')

    if (!isAccessGranted) {
      setErrorMessage('目前未通過登入白名單驗證，無法新增交易。')
      return
    }

    const symbol = form.symbol.trim().toUpperCase()
    const quantity = Number(form.quantity)
    const price = Number(form.price)

    if (!symbol) {
      setErrorMessage('請輸入股票代號。')
      return
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setErrorMessage('股數必須大於 0。')
      return
    }

    if (!Number.isFinite(price) || price <= 0) {
      setErrorMessage('成交價必須大於 0。')
      return
    }

    if (!form.tradedAt) {
      setErrorMessage('請選擇交易時間。')
      return
    }

    const charges = calculateTradeCharges(form.action, quantity, price, feeSettings)

    if (form.action === 'BUY') {
      const requiredCash = charges.grossAmount + charges.brokerFee
      if (requiredCash > capitalDiscipline.buyBudget) {
        setErrorMessage(
          `超出短線資金上限，目前可用買進額度 ${formatCurrency(
            capitalDiscipline.buyBudget,
          )}。`,
        )
        return
      }
    }

    if (form.action === 'SELL') {
      const currentPosition = positionLookup[symbol] ?? 0
      if (quantity - currentPosition > 0.000001) {
        setErrorMessage(`可賣股數不足，目前持有 ${formatNumber(currentPosition)} 股。`)
        return
      }
    }

    setIsSubmitting(true)

    try {
      await createTrade({
        symbol,
        action: form.action,
        quantity,
        price,
        tradedAt: parseInputDate(form.tradedAt),
        note: form.note.trim() || undefined,
      })

      setSuccessMessage('交易已儲存。')
      setForm((prev) => ({
        ...prev,
        quantity: '',
        price: '',
        note: '',
        tradedAt: getCurrentDatetimeInputValue(),
      }))
      await refreshQuote(symbol)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知錯誤'
      setErrorMessage(`儲存交易失敗：${message}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteTrade = async (id: string) => {
    const shouldDelete = window.confirm('確定刪除這筆交易嗎？')
    if (!shouldDelete) {
      return
    }

    setErrorMessage('')
    try {
      await removeTrade(id)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知錯誤'
      setErrorMessage(`刪除交易失敗：${message}`)
    }
  }

  const handleLongTermSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLongTermErrorMessage('')
    setLongTermSuccessMessage('')

    if (!isAccessGranted) {
      setLongTermErrorMessage('目前未通過登入白名單驗證，無法新增長期持有標的。')
      return
    }

    const symbol = longTermForm.symbol.trim().toUpperCase()
    const quantity = Number(longTermForm.quantity)
    const averageCost = Number(longTermForm.averageCost)

    if (!symbol) {
      setLongTermErrorMessage('請輸入股票代號。')
      return
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setLongTermErrorMessage('持有股數必須大於 0。')
      return
    }

    if (!Number.isFinite(averageCost) || averageCost <= 0) {
      setLongTermErrorMessage('平均成本必須大於 0。')
      return
    }

    if (!longTermForm.startedAt) {
      setLongTermErrorMessage('請輸入開始持有日期。')
      return
    }

    setIsSubmittingLongTerm(true)
    try {
      createLongTermHolding({
        symbol,
        quantity,
        averageCost,
        startedAt: longTermForm.startedAt,
        thesis: longTermForm.thesis.trim() || undefined,
      })
      setLongTermHoldings(getLongTermHoldings())
      setLongTermSuccessMessage('已加入長期持有清單。')
      setLongTermForm((prev) => ({
        ...prev,
        symbol: '',
        quantity: '',
        averageCost: '',
        thesis: '',
        startedAt: getCurrentDateInputValue(),
      }))
      await refreshQuote(symbol)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知錯誤'
      setLongTermErrorMessage(`新增失敗：${message}`)
    } finally {
      setIsSubmittingLongTerm(false)
    }
  }

  const handleDeleteLongTermHolding = (id: string) => {
    const shouldDelete = window.confirm('確定刪除此長期持有標的嗎？')
    if (!shouldDelete) {
      return
    }

    deleteLongTermHolding(id)
    setLongTermHoldings(getLongTermHoldings())
    setLongTermSuccessMessage('已刪除長期持有標的。')
  }

  const refreshLongTermQuotes = async () => {
    if (longTermSymbols.length === 0) {
      return
    }

    setIsRefreshingLongTermQuotes(true)
    await refreshQuotesForSymbols(longTermSymbols)
    setLastAutoRefreshAt(new Date().toISOString())
    setIsRefreshingLongTermQuotes(false)
  }

  const refreshAllQuotes = async () => {
    if (trackedSymbols.length === 0) {
      return
    }

    setIsRefreshingAll(true)
    await refreshQuotesForSymbols(trackedSymbols)
    setLastAutoRefreshAt(new Date().toISOString())
    setIsRefreshingAll(false)
  }

  const updateFeeSetting = (key: keyof FeeSettings, value: number) => {
    if (!Number.isFinite(value) || value < 0) {
      return
    }

    setFeeSettings((prev) => ({ ...prev, [key]: value }))
  }

  const handleLogin = async () => {
    setIsAuthBusy(true)
    setAuthMessage('')

    try {
      await loginWithGoogle()
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知錯誤'
      setAuthMessage(`登入失敗：${message}`)
    } finally {
      setIsAuthBusy(false)
    }
  }

  const handleLogout = async () => {
    setIsAuthBusy(true)
    setAuthMessage('')

    try {
      await logoutCurrentUser()
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知錯誤'
      setAuthMessage(`登出失敗：${message}`)
    } finally {
      setIsAuthBusy(false)
    }
  }

  return (
    <main className="app">
      <header className="header">
        <h1>股票損益計算系統</h1>
        <p>
          Firebase 儲存交易資料，搭配網路報價 API 即時計算損益（含手續費與稅金）。
        </p>
        <div className="badge-row">
          <span className="badge">
            資料儲存：{storageMode === 'firebase' ? 'Firebase' : 'LocalStorage'}
          </span>
          <span className="badge">
            Firebase 設定：{isFirebaseConfigured ? '已設定' : '未設定'}
          </span>
          <span className="badge">
            白名單登入：{authWhitelistEnabled ? '已啟用' : '本地測試關閉'}
          </span>
          <span className="badge">
            股價追蹤：{autoTrackEnabled ? `每 ${autoTrackIntervalSec} 秒` : '已關閉'}
          </span>
          <span className="badge">
            法人警訊：{institutionalAutoEnabled ? `每 ${institutionalAutoIntervalMin} 分` : '已關閉'}
          </span>
          <span className="badge">
            T+2 淨衝擊：{formatCurrency(tPlus2Summary.netCashImpact)}
          </span>
        </div>
        {!isFirebaseConfigured && (
          <p className="warning">
            尚未設定 Firebase 環境變數，目前會暫存到瀏覽器 LocalStorage。
          </p>
        )}
      </header>

      <section className="tab-strip">
        <button
          type="button"
          className={activeTab === 'dashboard' ? 'active' : ''}
          onClick={() => {
            setActiveTab('dashboard')
          }}
        >
          短期買賣
        </button>
        <button
          type="button"
          className={activeTab === 'longterm' ? 'active' : ''}
          onClick={() => {
            setActiveTab('longterm')
          }}
        >
          長期持有
        </button>
        <button
          type="button"
          className={activeTab === 'settings' ? 'active' : ''}
          onClick={() => {
            setActiveTab('settings')
          }}
        >
          系統設定
        </button>
      </section>

      {isLockedByWhitelist && (
        <section className="card">
          <h2>白名單登入驗證</h2>
          <p className="subtle">
            此環境已開啟白名單，僅允許以下帳號登入：
            {authWhitelistEmails.join(', ')}
          </p>
          <div className="auth-actions">
            <button type="button" onClick={handleLogin} disabled={isAuthChecking || isAuthBusy}>
              {isAuthChecking || isAuthBusy ? '處理中...' : 'Google 登入'}
            </button>
          </div>
          {authConfigWarning && <p className="warning">{authConfigWarning}</p>}
          {authMessage && <p className="warning">{authMessage}</p>}
        </section>
      )}

      {!isLockedByWhitelist && activeTab === 'dashboard' && (
        <>
          <section className="card metrics">
            <article>
              <h2>已實現損益</h2>
              <p className={toClassBySign(portfolioSummary.realizedPnl)}>
                {formatCurrency(portfolioSummary.realizedPnl)}
              </p>
            </article>
            <article>
              <h2>未實現損益</h2>
              <p className={toClassBySign(portfolioSummary.unrealizedPnl)}>
                {formatCurrency(portfolioSummary.unrealizedPnl)}
              </p>
            </article>
            <article>
              <h2>總損益</h2>
              <p className={toClassBySign(portfolioSummary.totalPnl)}>
                {formatCurrency(portfolioSummary.totalPnl)}
              </p>
            </article>
            <article>
              <h2>整體收益率</h2>
              <p className={toClassBySign(portfolioSummary.overallReturnRate)}>
                {formatPercent(portfolioSummary.overallReturnRate)}
              </p>
            </article>
            <article>
              <h2>持有成本</h2>
              <p>{formatCurrency(portfolioSummary.investedCapital)}</p>
            </article>
            <article>
              <h2>預估可回收市值</h2>
              <p>{formatCurrency(portfolioSummary.marketValue)}</p>
            </article>
            <article>
              <h2>累計買進成本</h2>
              <p>{formatCurrency(portfolioSummary.totalBuyCost)}</p>
            </article>
            <article>
              <h2>累計賣出回收</h2>
              <p>{formatCurrency(portfolioSummary.totalSellProceeds)}</p>
            </article>
          </section>

          <section className="card">
            <h2>短線資金紀律（固定本金 20,000 元）</h2>
            <p className="subtle">
              以短線策略維持 20,000 元運作：有獲利先贖回超出本金部分，虧損時原則不補錢。
            </p>
            <div className="badge-row">
              <span className="badge">可用現金：{formatCurrency(capitalDiscipline.cashBalance)}</span>
              <span className="badge">帳戶淨值：{formatCurrency(capitalDiscipline.accountEquity)}</span>
              <span className="badge">買進上限：{formatCurrency(capitalDiscipline.buyBudget)}</span>
            </div>
            {capitalDiscipline.withdrawableProfit > 0 && (
              <p className="success">
                建議贖回：{formatCurrency(capitalDiscipline.withdrawableProfit)}（讓本金回到
                20,000 元）
              </p>
            )}
            {capitalDiscipline.principalGap > 0 && (
              <p className="warning">
                目前低於本金 {formatCurrency(capitalDiscipline.principalGap)}，依你的策略「不補錢」，建議縮小部位或降低單筆曝險。
              </p>
            )}
            {capitalDiscipline.isOpenValueEstimated && (
              <p className="subtle">
                部分持股尚無即時報價，帳戶淨值暫以持有成本估算。
              </p>
            )}
          </section>

          <section className="card">
            <h2>停損建議（短線）</h2>
            <p className="subtle">
              目前以均價下方 {formatPercent(stopLossRate * 100)} 作為建議停損基準，可在本頁上方直接調整。
            </p>
            {stopLossSuggestions.length === 0 ? (
              <p className="subtle">目前沒有持股，暫無停損建議。</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>代號</th>
                      <th>股數</th>
                      <th>均價</th>
                      <th>現價</th>
                      <th>建議停損價</th>
                      <th>距離停損</th>
                      <th>狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stopLossSuggestions.map((item) => {
                      const status = getStopLossStatusDisplay(item.isTriggered)
                      return (
                        <tr key={item.symbol}>
                          <td data-label="代號">{item.symbol}</td>
                          <td data-label="股數">{formatNumber(item.quantity)}</td>
                          <td data-label="均價">{formatCurrency(item.averageCost)}</td>
                          <td data-label="現價">
                            {item.currentPrice === null ? '--' : formatCurrency(item.currentPrice)}
                          </td>
                          <td data-label="建議停損價">{formatCurrency(item.stopLossPrice)}</td>
                          <td
                            data-label="距離停損"
                            className={toClassBySign(item.distanceToStopPct)}
                          >
                            {formatPercent(item.distanceToStopPct)}
                          </td>
                          <td data-label="狀態">
                            <span className={`signal-badge ${status.className}`}>
                              {status.text}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2>T+2 交割警訊（近 2 個營業日）</h2>
            <p className="subtle">
              T+2 代表成交日後第 2 個營業日交割。大量買進會形成應付壓力，若資金不足可能造成違約交割風險。
            </p>
            <div className="badge-row">
              <span className="badge">
                近期待付：{formatCurrency(tPlus2Summary.totalPayable)}
              </span>
              <span className="badge">
                近期可收：{formatCurrency(tPlus2Summary.totalReceivable)}
              </span>
              <span className="badge">
                淨衝擊：{formatCurrency(tPlus2Summary.netCashImpact)}
              </span>
            </div>
            {tPlus2Summary.warnings.length === 0 ? (
              <p className="subtle">近兩個營業日沒有 T+2 交割款壓力。</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>交割日</th>
                      <th>應付交割</th>
                      <th>應收交割</th>
                      <th>淨現金衝擊</th>
                      <th>警示等級</th>
                      <th>警訊說明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tPlus2Summary.warnings.map((item) => {
                      const levelDisplay = getTPlus2LevelDisplay(item.level)
                      return (
                        <tr key={item.settlementDate}>
                          <td data-label="交割日">{item.settlementDate}</td>
                          <td data-label="應付交割">{formatCurrency(item.payable)}</td>
                          <td data-label="應收交割">{formatCurrency(item.receivable)}</td>
                          <td
                            data-label="淨現金衝擊"
                            className={toClassBySign(item.netCashImpact)}
                          >
                            {formatCurrency(item.netCashImpact)}
                          </td>
                          <td data-label="警示等級">
                            <span className={`signal-badge ${levelDisplay.className}`}>
                              {levelDisplay.text}
                            </span>
                          </td>
                          <td data-label="警訊說明">{item.warningText}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <StockSuggestionsSection trackedSymbols={trackedSymbols} />
          <InstitutionalSignalsSection
            rows={institutionalRows}
            isLoading={isRefreshingInstitutional}
            errorMessage={institutionalError}
            autoEnabled={institutionalAutoEnabled}
            autoIntervalMinutes={institutionalAutoIntervalMin}
            lastUpdatedAt={lastInstitutionalRefreshAt}
            onRefresh={refreshInstitutionalSignals}
          />

          <section className="card">
            <h2>新增交易</h2>
            <form className="trade-form" onSubmit={handleTradeSubmit}>
              <label>
                股票代號
                <input
                  type="text"
                  placeholder="例如 2330 或 AAPL"
                  value={form.symbol}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, symbol: event.target.value }))
                  }}
                  required
                />
              </label>
              <label>
                交易類型
                <select
                  value={form.action}
                  onChange={(event) => {
                    setForm((prev) => ({
                      ...prev,
                      action: event.target.value as TradeAction,
                    }))
                  }}
                >
                  <option value="BUY">買進</option>
                  <option value="SELL">賣出</option>
                </select>
              </label>
              <label>
                股數（支援零股/碎股）
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={form.quantity}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, quantity: event.target.value }))
                  }}
                  required
                />
              </label>
              <label>
                成交價
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, price: event.target.value }))
                  }}
                  required
                />
              </label>
              <label>
                交易時間
                <input
                  type="datetime-local"
                  value={form.tradedAt}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, tradedAt: event.target.value }))
                  }}
                  required
                />
              </label>
              <label className="full-width">
                備註
                <input
                  type="text"
                  value={form.note}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, note: event.target.value }))
                  }}
                  placeholder="可留空"
                />
              </label>
              <button type="submit" disabled={isSubmitting || !isAccessGranted}>
                {isSubmitting ? '儲存中...' : '儲存交易'}
              </button>
            </form>
            {errorMessage && <p className="error">{errorMessage}</p>}
            {successMessage && <p className="success">{successMessage}</p>}
          </section>

          <section className="card">
            <div className="section-header">
              <h2>持股總覽</h2>
              <button
                type="button"
                onClick={refreshAllQuotes}
                disabled={isRefreshingAll || trackedSymbols.length === 0}
              >
                {isRefreshingAll ? '更新中...' : '更新所有股價'}
              </button>
            </div>
            <p className="subtle status-line">
              {autoTrackEnabled
                ? `系統自動追蹤中（每 ${autoTrackIntervalSec} 秒）`
                : '自動追蹤已關閉，僅手動更新'}
              {lastAutoRefreshAt
                ? `，最近更新：${new Date(lastAutoRefreshAt).toLocaleTimeString('zh-TW')}`
                : ''}
            </p>
            {portfolioSummary.positions.length === 0 ? (
              <p className="subtle">目前沒有持股資料。</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>代號</th>
                      <th>股數</th>
                      <th>均價</th>
                      <th>持有成本</th>
                      <th>最新價</th>
                      <th>可回收市值(估)</th>
                      <th>未實現損益</th>
                      <th>已實現損益</th>
                      <th>報價</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolioSummary.positions.map((position) => {
                      const quote = quotes[position.symbol]
                      return (
                        <tr key={position.symbol}>
                          <td data-label="代號">{position.symbol}</td>
                          <td data-label="股數">{formatNumber(position.quantity)}</td>
                          <td data-label="均價">{formatCurrency(position.averageCost)}</td>
                          <td data-label="持有成本">{formatCurrency(position.costBasis)}</td>
                          <td data-label="最新價">
                            {quote ? formatCurrency(quote.price) : '--'}
                          </td>
                          <td data-label="可回收市值(估)">
                            {formatCurrency(position.marketValue)}
                          </td>
                          <td
                            data-label="未實現損益"
                            className={toClassBySign(position.unrealizedPnl)}
                          >
                            {formatCurrency(position.unrealizedPnl)}
                          </td>
                          <td
                            data-label="已實現損益"
                            className={toClassBySign(position.realizedPnl)}
                          >
                            {formatCurrency(position.realizedPnl)}
                          </td>
                          <td data-label="報價" className="actions-cell">
                            <button
                              type="button"
                              className="inline"
                              onClick={() => {
                                void refreshQuote(position.symbol)
                              }}
                              disabled={quoteLoading[position.symbol]}
                            >
                              {quoteLoading[position.symbol] ? '更新中' : '更新'}
                            </button>
                            {quote && (
                              <small>
                                {new Date(quote.fetchedAt).toLocaleTimeString('zh-TW')}
                              </small>
                            )}
                            {quoteErrors[position.symbol] && (
                              <small className="error">{quoteErrors[position.symbol]}</small>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2>交易紀錄</h2>
            {isLoadingTrades ? (
              <p className="subtle">讀取中...</p>
            ) : trades.length === 0 ? (
              <p className="subtle">尚無交易，先新增第一筆吧。</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>時間</th>
                      <th>代號</th>
                      <th>類型</th>
                      <th>股數</th>
                      <th>成交價</th>
                      <th>成交金額</th>
                      <th>手續費</th>
                      <th>稅金</th>
                      <th>淨現金流</th>
                      <th>備註</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((trade) => {
                      const charges = calculateTradeCharges(
                        trade.action,
                        trade.quantity,
                        trade.price,
                        feeSettings,
                      )
                      return (
                        <tr key={trade.id}>
                          <td data-label="時間">
                            {new Date(trade.tradedAt).toLocaleString('zh-TW', {
                              hour12: false,
                            })}
                          </td>
                          <td data-label="代號">{trade.symbol}</td>
                          <td data-label="類型">
                            {trade.action === 'BUY' ? '買進' : '賣出'}
                          </td>
                          <td data-label="股數">{formatNumber(trade.quantity)}</td>
                          <td data-label="成交價">{formatCurrency(trade.price)}</td>
                          <td data-label="成交金額">
                            {formatCurrency(charges.grossAmount)}
                          </td>
                          <td data-label="手續費">{formatCurrency(charges.brokerFee)}</td>
                          <td data-label="稅金">{formatCurrency(charges.tax)}</td>
                          <td
                            data-label="淨現金流"
                            className={toClassBySign(charges.netCash)}
                          >
                            {formatCurrency(charges.netCash)}
                          </td>
                          <td data-label="備註">{trade.note ?? '-'}</td>
                          <td data-label="操作" className="actions-cell">
                            <button
                              type="button"
                              className="danger inline"
                              onClick={() => {
                                void handleDeleteTrade(trade.id)
                              }}
                            >
                              刪除
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {!isLockedByWhitelist && activeTab === 'longterm' && (
        <>
          <section className="card">
            <div className="section-header">
              <h2>長期持有資產總覽</h2>
              <button
                type="button"
                onClick={refreshLongTermQuotes}
                disabled={isRefreshingLongTermQuotes || longTermSymbols.length === 0}
              >
                {isRefreshingLongTermQuotes ? '更新中...' : '更新長期持有報價'}
              </button>
            </div>
            <p className="subtle">
              這個標籤頁專門記錄你打算長期持有的股票，不會改變短線交易資金紀律。
            </p>
            <div className="badge-row">
              <span className="badge">標的數：{longTermRows.length}</span>
              <span className="badge">
                總持有成本：{formatCurrency(longTermSummary.totalCost)}
              </span>
              <span className="badge">
                預估市值：{formatCurrency(longTermSummary.totalMarket)}
              </span>
              <span className="badge">
                未實現損益：{formatCurrency(longTermSummary.totalUnrealized)}
              </span>
            </div>
            {longTermSummary.hasUnknownQuote && (
              <p className="subtle">部分標的缺少即時報價，市值與損益為部分估算。</p>
            )}
          </section>

          <section className="card">
            <h2>長期持有賣出 / 轉投資建議</h2>
            <p className="subtle">
              綜合報酬率、停損區間與法人籌碼訊號，提供續抱、減碼與轉投資警訊。
            </p>
            <div className="badge-row">
              <span className="badge">賣出/減碼：{longTermAdviceSummary.sell}</span>
              <span className="badge">轉投資觀察：{longTermAdviceSummary.watch}</span>
              <span className="badge">續抱：{longTermAdviceSummary.hold}</span>
              <span className="badge">待補資料：{longTermAdviceSummary.noData}</span>
            </div>
            {longTermAdvisories.length === 0 ? (
              <p className="subtle">尚無長期持有標的，暫無賣出建議。</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>代號</th>
                      <th>現價</th>
                      <th>報酬率</th>
                      <th>停損參考</th>
                      <th>目標價參考</th>
                      <th>建議</th>
                      <th>警訊說明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {longTermAdvisories.map((item) => {
                      const adviceDisplay = getLongTermAdviceDisplay(item.level)
                      return (
                        <tr key={item.symbol}>
                          <td data-label="代號">{item.symbol}</td>
                          <td data-label="現價">
                            {item.currentPrice === null ? '--' : formatCurrency(item.currentPrice)}
                          </td>
                          <td data-label="報酬率" className={toClassBySign(item.returnRate)}>
                            {formatPercent(item.returnRate)}
                          </td>
                          <td data-label="停損參考">{formatCurrency(item.stopLossPrice)}</td>
                          <td data-label="目標價參考">{formatCurrency(item.targetPrice)}</td>
                          <td data-label="建議">
                            <span className={`signal-badge ${adviceDisplay.className}`}>
                              {adviceDisplay.text}
                            </span>
                            <small>{item.actionText}</small>
                          </td>
                          <td data-label="警訊說明">{item.reasonText}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2>長期判斷基準設定（同頁調整）</h2>
            <div className="settings-grid">
              <label>
                長期停損幅度（%）
                <input
                  type="number"
                  min="3"
                  max="30"
                  step="0.5"
                  value={longTermStopLossRate * 100}
                  onChange={(event) => {
                    const parsed = Number(event.target.value)
                    if (!Number.isFinite(parsed)) {
                      return
                    }
                    setLongTermStopLossRate(Math.min(0.3, Math.max(0.03, parsed / 100)))
                  }}
                />
              </label>
              <label>
                長期獲利目標（%）
                <input
                  type="number"
                  min="5"
                  max="80"
                  step="1"
                  value={longTermTargetRate * 100}
                  onChange={(event) => {
                    const parsed = Number(event.target.value)
                    if (!Number.isFinite(parsed)) {
                      return
                    }
                    setLongTermTargetRate(Math.min(0.8, Math.max(0.05, parsed / 100)))
                  }}
                />
              </label>
              <label>
                轉投資虧損警戒（%）
                <input
                  type="number"
                  min="5"
                  max="40"
                  step="1"
                  value={longTermRotateLossRate * 100}
                  onChange={(event) => {
                    const parsed = Number(event.target.value)
                    if (!Number.isFinite(parsed)) {
                      return
                    }
                    setLongTermRotateLossRate(Math.min(0.4, Math.max(0.05, parsed / 100)))
                  }}
                />
              </label>
            </div>
            <p className="subtle">
              上述設定會即時套用在本頁賣出建議與轉投資候選警訊。
            </p>
          </section>

          <section className="card">
            <h2>轉投資候選警訊（法人偏多）</h2>
            {rotationCandidates.length === 0 ? (
              <p className="subtle">目前沒有明確的法人偏多候選，先維持現有配置觀察。</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>代號</th>
                      <th>外資標示</th>
                      <th>法人標示</th>
                      <th>警訊說明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rotationCandidates.map((item) => (
                      <tr key={`rotation-${item.symbol}`}>
                        <td data-label="代號">{item.symbol}</td>
                        <td data-label="外資標示">
                          <span
                            className={`signal-badge ${
                              item.foreignSignal === 'HEAVY_BUY'
                                ? 'buy'
                                : item.foreignSignal === 'HEAVY_SELL'
                                  ? 'sell'
                                  : 'neutral'
                            }`}
                          >
                            {item.foreignSignal === 'HEAVY_BUY'
                              ? '大量買入'
                              : item.foreignSignal === 'HEAVY_SELL'
                                ? '大量賣出'
                                : '中性'}
                          </span>
                        </td>
                        <td data-label="法人標示">
                          <span
                            className={`signal-badge ${
                              item.institutionalSignal === 'HEAVY_BUY'
                                ? 'buy'
                                : item.institutionalSignal === 'HEAVY_SELL'
                                  ? 'sell'
                                  : 'neutral'
                            }`}
                          >
                            {item.institutionalSignal === 'HEAVY_BUY'
                              ? '大量買入'
                              : item.institutionalSignal === 'HEAVY_SELL'
                                ? '大量賣出'
                                : '中性'}
                          </span>
                        </td>
                        <td data-label="警訊說明">{item.warningText}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2>新增長期持有標的</h2>
            <form className="trade-form" onSubmit={handleLongTermSubmit}>
              <label>
                股票代號
                <input
                  type="text"
                  placeholder="例如 0050 或 AAPL"
                  value={longTermForm.symbol}
                  onChange={(event) => {
                    setLongTermForm((prev) => ({ ...prev, symbol: event.target.value }))
                  }}
                  required
                />
              </label>
              <label>
                持有股數（支援零股/碎股）
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={longTermForm.quantity}
                  onChange={(event) => {
                    setLongTermForm((prev) => ({ ...prev, quantity: event.target.value }))
                  }}
                  required
                />
              </label>
              <label>
                平均成本
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={longTermForm.averageCost}
                  onChange={(event) => {
                    setLongTermForm((prev) => ({ ...prev, averageCost: event.target.value }))
                  }}
                  required
                />
              </label>
              <label>
                開始持有日
                <input
                  type="date"
                  value={longTermForm.startedAt}
                  onChange={(event) => {
                    setLongTermForm((prev) => ({ ...prev, startedAt: event.target.value }))
                  }}
                  required
                />
              </label>
              <label className="full-width">
                長期持有理由
                <input
                  type="text"
                  value={longTermForm.thesis}
                  onChange={(event) => {
                    setLongTermForm((prev) => ({ ...prev, thesis: event.target.value }))
                  }}
                  placeholder="例如 配息穩定、產業長期成長"
                />
              </label>
              <button type="submit" disabled={isSubmittingLongTerm}>
                {isSubmittingLongTerm ? '儲存中...' : '加入長期清單'}
              </button>
            </form>
            {longTermErrorMessage && <p className="error">{longTermErrorMessage}</p>}
            {longTermSuccessMessage && <p className="success">{longTermSuccessMessage}</p>}
          </section>

          <section className="card">
            <h2>長期持有明細</h2>
            {longTermRows.length === 0 ? (
              <p className="subtle">目前尚無長期持有標的。</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>代號</th>
                      <th>股數</th>
                      <th>平均成本</th>
                      <th>現價</th>
                      <th>報酬率</th>
                      <th>持有成本</th>
                      <th>市值</th>
                      <th>未實現損益</th>
                      <th>開始持有</th>
                      <th>理由</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {longTermRows.map((row) => {
                      const returnRate =
                        row.currentPrice === null || row.averageCost === 0
                          ? null
                          : ((row.currentPrice - row.averageCost) / row.averageCost) * 100
                      return (
                        <tr key={row.id}>
                          <td data-label="代號">{row.symbol}</td>
                          <td data-label="股數">{formatNumber(row.quantity)}</td>
                          <td data-label="平均成本">{formatCurrency(row.averageCost)}</td>
                          <td data-label="現價">
                            {row.currentPrice === null ? '--' : formatCurrency(row.currentPrice)}
                          </td>
                          <td data-label="報酬率" className={toClassBySign(returnRate)}>
                            {formatPercent(returnRate)}
                          </td>
                          <td data-label="持有成本">{formatCurrency(row.costBasis)}</td>
                          <td data-label="市值">{formatCurrency(row.marketValue)}</td>
                          <td data-label="未實現損益" className={toClassBySign(row.unrealizedPnl)}>
                            {formatCurrency(row.unrealizedPnl)}
                          </td>
                          <td data-label="開始持有">{row.startedAt}</td>
                          <td data-label="理由">{row.thesis ?? '-'}</td>
                          <td data-label="操作" className="actions-cell">
                            <button
                              type="button"
                              className="danger inline"
                              onClick={() => {
                                handleDeleteLongTermHolding(row.id)
                              }}
                            >
                              刪除
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {!isLockedByWhitelist && activeTab === 'settings' && (
        <>
          <section className="card">
            <h2>系統存取設定</h2>
            <div className="settings-grid">
              <label>
                白名單帳號
                <input
                  type="text"
                  value={authWhitelistEmails.join(', ')}
                  disabled
                  readOnly
                />
              </label>
              <label>
                白名單啟用狀態
                <input
                  type="text"
                  value={authWhitelistEnabled ? '已啟用' : '本地測試關閉'}
                  disabled
                  readOnly
                />
              </label>
            </div>
            <p className="subtle">
              已寫入僅允許 `y.chengju@gmail.com`，目前本地測試預設關閉。
            </p>
            {authWhitelistEnabled && (
              <div className="auth-actions">
                <button
                  type="button"
                  onClick={handleLogin}
                  disabled={isAuthBusy || isAuthChecking}
                >
                  {isAuthBusy || isAuthChecking ? '處理中...' : 'Google 登入'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={handleLogout}
                  disabled={isAuthBusy || isAuthChecking || !authUser}
                >
                  登出
                </button>
              </div>
            )}
            <p className="subtle">
              目前登入：{authUser?.displayName ?? authUser?.email ?? '未登入'}
            </p>
            {authMessage && <p className="warning">{authMessage}</p>}
          </section>

          <section className="card">
            <h2>短期判斷基準設定</h2>
            <p className="subtle">
              短期買賣相關的設定已集中於此，主頁只保留結果與警示資訊。
            </p>
            <div className="settings-grid">
              <label>
                固定本金上限（元）
                <input type="number" value={capitalLimit} disabled readOnly />
              </label>
              <label>
                短線停損幅度（%）
                <input
                  type="number"
                  min="0.5"
                  max="20"
                  step="0.1"
                  value={stopLossRate * 100}
                  onChange={(event) => {
                    const parsed = Number(event.target.value)
                    if (!Number.isFinite(parsed)) {
                      return
                    }
                    setStopLossRate(Math.min(0.2, Math.max(0.005, parsed / 100)))
                  }}
                />
              </label>
              <label>
                股價追蹤開關
                <select
                  value={autoTrackEnabled ? 'on' : 'off'}
                  onChange={(event) => {
                    setAutoTrackEnabled(event.target.value === 'on')
                  }}
                >
                  <option value="on">開啟</option>
                  <option value="off">關閉</option>
                </select>
              </label>
              <label>
                股價更新間隔（秒）
                <input
                  type="number"
                  min="60"
                  max="900"
                  step="1"
                  value={autoTrackIntervalSec}
                  onChange={(event) => {
                    const parsed = Number(event.target.value)
                    if (!Number.isFinite(parsed)) {
                      return
                    }
                    setAutoTrackIntervalSec(Math.min(900, Math.max(60, parsed)))
                  }}
                  disabled={!autoTrackEnabled}
                />
              </label>
              <label>
                手續費率（%）
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={feeSettings.brokerFeeRate * 100}
                  onChange={(event) => {
                    updateFeeSetting('brokerFeeRate', Number(event.target.value) / 100)
                  }}
                />
              </label>
              <label>
                手續費折扣（%）
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={feeSettings.brokerDiscount * 100}
                  onChange={(event) => {
                    updateFeeSetting('brokerDiscount', Number(event.target.value) / 100)
                  }}
                />
              </label>
              <label>
                最低手續費（元）
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={feeSettings.minBrokerFee}
                  onChange={(event) => {
                    updateFeeSetting('minBrokerFee', Number(event.target.value))
                  }}
                />
              </label>
              <label>
                賣出證交稅率（%）
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={feeSettings.sellTaxRate * 100}
                  onChange={(event) => {
                    updateFeeSetting('sellTaxRate', Number(event.target.value) / 100)
                  }}
                />
              </label>
              <label>
                外資大量門檻（張）
                <input type="number" value={institutionalThresholds.foreignLots} disabled readOnly />
              </label>
              <label>
                三大法人大量門檻（張）
                <input
                  type="number"
                  value={institutionalThresholds.institutionalLots}
                  disabled
                  readOnly
                />
              </label>
              <label>
                法人自動追蹤
                <select
                  value={institutionalAutoEnabled ? 'on' : 'off'}
                  onChange={(event) => {
                    setInstitutionalAutoEnabled(event.target.value === 'on')
                  }}
                >
                  <option value="on">開啟</option>
                  <option value="off">關閉</option>
                </select>
              </label>
              <label>
                法人更新間隔（分鐘）
                <input
                  type="number"
                  min="10"
                  max="240"
                  step="1"
                  value={institutionalAutoIntervalMin}
                  onChange={(event) => {
                    const parsed = Number(event.target.value)
                    if (!Number.isFinite(parsed)) {
                      return
                    }
                    setInstitutionalAutoIntervalMin(Math.min(240, Math.max(10, parsed)))
                  }}
                  disabled={!institutionalAutoEnabled}
                />
              </label>
              <label>
                T+2 應付高風險門檻（元）
                <input
                  type="number"
                  min="10000"
                  step="10000"
                  value={tPlus2Thresholds.payableAlert}
                  onChange={(event) => {
                    const parsed = Number(event.target.value)
                    if (!Number.isFinite(parsed)) {
                      return
                    }
                    setTPlus2Thresholds((prev) => ({
                      ...prev,
                      payableAlert: Math.max(10000, Math.round(parsed)),
                    }))
                  }}
                />
              </label>
              <label>
                T+2 淨流出門檻（元）
                <input
                  type="number"
                  min="10000"
                  step="10000"
                  value={tPlus2Thresholds.netOutflowAlert}
                  onChange={(event) => {
                    const parsed = Number(event.target.value)
                    if (!Number.isFinite(parsed)) {
                      return
                    }
                    setTPlus2Thresholds((prev) => ({
                      ...prev,
                      netOutflowAlert: Math.max(10000, Math.round(parsed)),
                    }))
                  }}
                />
              </label>
            </div>
            <label className="watchlist-field">
              法人觀察補充清單（選填，逗號分隔）
              <input
                type="text"
                value={watchlistInput}
                onChange={(event) => {
                  setWatchlistInput(event.target.value)
                }}
                placeholder="例如 2330,2317,2454"
              />
            </label>
            <p className="subtle">
              外資與三大法人門檻已改為依追蹤名單自動套用常態值，避免需要手動調整複雜參數。
            </p>
            <p className="subtle">
              建議股票會自動掃描市場熱門標的；此清單只用於補充「法人籌碼警訊」追蹤範圍。
            </p>
          </section>

          <section className="card">
            <h2>頁面整理說明</h2>
            <p className="subtle">
              已依你的需求調整：短期判斷基準集中在「系統設定」頁，長期判斷基準保留在「長期持有」頁。
            </p>
            <p className="subtle">
              短期頁與長期頁會優先顯示結果與建議，減少複雜輸入欄位造成干擾。
            </p>
          </section>
        </>
      )}
    </main>
  )
}

export default App
