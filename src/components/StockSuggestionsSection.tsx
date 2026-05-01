import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchTopTradedTaiwanSymbols } from '../services/twseMarketApi'
import { fetchYahooDailyHistory } from '../services/yahooHistoryApi'

type StreakDirection = 'UP' | 'DOWN' | 'FLAT'

interface StockSuggestion {
  symbol: string
  normalizedSymbol: string
  latestClose: number
  tenDayChangePct: number
  currentDirection: StreakDirection
  currentStreak: number
  maxUpStreakIn10: number
  maxDownStreakIn10: number
  ma5: number
  ma10: number
  rsi14: number
  strategyLabel: string
  rangeLow: number | null
  rangeHigh: number | null
  riskGuard: number | null
  reasons: string[]
  note: string
}

const numberFormatter = new Intl.NumberFormat('zh-TW', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const percentFormatter = new Intl.NumberFormat('zh-TW', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function calculateSma(closes: number[], period: number): number {
  const sample = closes.slice(-period)
  const sum = sample.reduce((total, value) => total + value, 0)
  return sum / period
}

function calculateRsi(closes: number[], period: number): number {
  const changes = closes.slice(-period - 1)
  let gain = 0
  let loss = 0

  for (let index = 1; index < changes.length; index += 1) {
    const diff = changes[index] - changes[index - 1]
    if (diff > 0) {
      gain += diff
    } else if (diff < 0) {
      loss += Math.abs(diff)
    }
  }

  const averageGain = gain / period
  const averageLoss = loss / period

  if (averageLoss === 0) {
    return 100
  }

  const relativeStrength = averageGain / averageLoss
  return 100 - 100 / (1 + relativeStrength)
}

function getStreakStats(last10Closes: number[]): {
  currentDirection: StreakDirection
  currentStreak: number
  maxUpStreakIn10: number
  maxDownStreakIn10: number
} {
  let maxUp = 0
  let maxDown = 0
  let upRun = 0
  let downRun = 0

  for (let index = 1; index < last10Closes.length; index += 1) {
    const diff = last10Closes[index] - last10Closes[index - 1]
    if (diff > 0) {
      upRun += 1
      downRun = 0
    } else if (diff < 0) {
      downRun += 1
      upRun = 0
    } else {
      upRun = 0
      downRun = 0
    }

    maxUp = Math.max(maxUp, upRun)
    maxDown = Math.max(maxDown, downRun)
  }

  let currentDirection: StreakDirection = 'FLAT'
  let currentStreak = 0

  for (let index = last10Closes.length - 1; index > 0; index -= 1) {
    const diff = last10Closes[index] - last10Closes[index - 1]
    if (diff === 0) {
      break
    }

    const sign = diff > 0 ? 'UP' : 'DOWN'
    if (currentDirection === 'FLAT') {
      currentDirection = sign
      currentStreak = 1
      continue
    }

    if (sign !== currentDirection) {
      break
    }

    currentStreak += 1
  }

  return {
    currentDirection,
    currentStreak,
    maxUpStreakIn10: maxUp,
    maxDownStreakIn10: maxDown,
  }
}

function buildSuggestion(
  symbol: string,
  normalizedSymbol: string,
  closes: number[],
): StockSuggestion {
  const latestClose = closes[closes.length - 1]
  const ma5 = calculateSma(closes, 5)
  const ma10 = calculateSma(closes, 10)
  const rsi14 = calculateRsi(closes, 14)
  const last10Closes = closes.slice(-10)
  const firstCloseIn10 = last10Closes[0]
  const tenDayChangePct =
    firstCloseIn10 > 0 ? ((latestClose - firstCloseIn10) / firstCloseIn10) * 100 : 0

  const streakStats = getStreakStats(last10Closes)

  let strategyLabel = '中性觀察'
  let rangeLow: number | null = null
  let rangeHigh: number | null = null
  let riskGuard: number | null = null
  let note = '尚未出現明確趨勢，建議等待突破或回檔確認。'

  if (latestClose > ma5 && ma5 > ma10 && rsi14 >= 50 && rsi14 <= 75) {
    strategyLabel = '順勢回檔布局'
    rangeLow = ma5 * 0.99
    rangeHigh = ma5 * 1.01
    riskGuard = ma10 * 0.97
    note =
      '常見網路趨勢策略：多頭排列下，等待回檔 5 日均線附近分批布局。'
  } else if (streakStats.currentDirection === 'UP' && streakStats.currentStreak >= 4) {
    strategyLabel = '強勢但偏熱'
    rangeLow = ma10 * 0.99
    rangeHigh = ma5
    riskGuard = ma10 * 0.97
    note =
      '連漲天數偏多，依常見回檔策略不追價，等回測均線再評估。'
  } else if (latestClose < ma5 && ma5 < ma10 && rsi14 < 45) {
    strategyLabel = '弱勢反彈觀察'
    rangeLow = ma5
    rangeHigh = ma10 * 1.01
    riskGuard = latestClose * 0.95
    note =
      '空方排列時以觀察為主，需先站回 10 日線才提高勝率。'
  } else if (rsi14 < 30) {
    strategyLabel = '超跌反彈觀察'
    rangeLow = latestClose * 0.97
    rangeHigh = latestClose * 1.02
    riskGuard = latestClose * 0.94
    note = 'RSI 低檔可能有技術反彈，但風險較高需嚴控停損。'
  }

  const reasons: string[] = []
  if (streakStats.currentDirection === 'UP' && streakStats.currentStreak >= 2) {
    reasons.push(`近 ${streakStats.currentStreak} 日連漲，短線動能偏強`)
  } else if (
    streakStats.currentDirection === 'DOWN' &&
    streakStats.currentStreak >= 2
  ) {
    reasons.push(`近 ${streakStats.currentStreak} 日連跌，波動風險提高`)
  }

  if (latestClose > ma5 && ma5 > ma10) {
    reasons.push('站上 MA5 且 MA5 > MA10，屬多頭排列')
  } else if (latestClose < ma5 && ma5 < ma10) {
    reasons.push('跌破 MA5 且 MA5 < MA10，屬空方排列')
  } else if (latestClose > ma10) {
    reasons.push('仍守在 MA10 之上，趨勢未轉弱')
  } else {
    reasons.push('跌破 MA10，需留意反彈是否無量')
  }

  if (rsi14 >= 50 && rsi14 <= 75) {
    reasons.push('RSI 位於 50~75，動能偏多但未極端過熱')
  } else if (rsi14 > 75) {
    reasons.push('RSI 偏高，追價風險增加')
  } else if (rsi14 < 30) {
    reasons.push('RSI 低於 30，可能有技術性反彈')
  } else {
    reasons.push('RSI 動能中性，建議搭配量價確認')
  }

  reasons.push(`近 10 日漲跌 ${percentFormatter.format(tenDayChangePct)}%`)

  return {
    symbol,
    normalizedSymbol,
    latestClose,
    tenDayChangePct,
    currentDirection: streakStats.currentDirection,
    currentStreak: streakStats.currentStreak,
    maxUpStreakIn10: streakStats.maxUpStreakIn10,
    maxDownStreakIn10: streakStats.maxDownStreakIn10,
    ma5,
    ma10,
    rsi14,
    strategyLabel,
    rangeLow,
    rangeHigh,
    riskGuard,
    reasons: reasons.slice(0, 4),
    note,
  }
}

function toSignClass(value: number): string {
  if (value > 0) {
    return 'positive'
  }
  if (value < 0) {
    return 'negative'
  }
  return ''
}

function formatRange(low: number | null, high: number | null): string {
  if (low === null || high === null) {
    return '--'
  }
  return `${numberFormatter.format(low)} ~ ${numberFormatter.format(high)}`
}

function formatDirection(direction: StreakDirection, streak: number): string {
  if (direction === 'UP') {
    return `連漲 ${streak} 天`
  }
  if (direction === 'DOWN') {
    return `連跌 ${streak} 天`
  }
  return '持平'
}

function getSuggestionRankScore(item: StockSuggestion): number {
  const strategyScore: Record<string, number> = {
    順勢回檔布局: 5,
    強勢但偏熱: 4,
    超跌反彈觀察: 3,
    弱勢反彈觀察: 2,
    中性觀察: 1,
  }

  const streakFactor =
    item.currentDirection === 'UP'
      ? item.currentStreak * 1.5
      : item.currentDirection === 'DOWN'
        ? item.currentStreak
        : 0
  const trendFactor = Math.min(10, Math.abs(item.tenDayChangePct) / 2)
  const rsiPenalty = item.rsi14 > 85 ? 2 : 0

  return (strategyScore[item.strategyLabel] ?? 0) * 10 + streakFactor + trendFactor - rsiPenalty
}

function renderSuggestionTable(
  title: string,
  rows: StockSuggestion[],
  emptyText: string,
) {
  return (
    <article className="suggestion-group">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="subtle">{emptyText}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>代號</th>
                <th>最新價</th>
                <th>近10日漲跌</th>
                <th>連續天數</th>
                <th>10日內最大連漲/跌</th>
                <th>MA5 / MA10</th>
                <th>RSI14</th>
                <th>建議區間</th>
                <th>防守價</th>
                <th>建議原因</th>
                <th>策略</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.normalizedSymbol}>
                  <td data-label="代號">{item.symbol}</td>
                  <td data-label="最新價">{numberFormatter.format(item.latestClose)}</td>
                  <td data-label="近10日漲跌" className={toSignClass(item.tenDayChangePct)}>
                    {percentFormatter.format(item.tenDayChangePct)}%
                  </td>
                  <td
                    data-label="連續天數"
                    className={
                      item.currentDirection === 'UP'
                        ? 'positive'
                        : item.currentDirection === 'DOWN'
                          ? 'negative'
                          : ''
                    }
                  >
                    {formatDirection(item.currentDirection, item.currentStreak)}
                  </td>
                  <td data-label="10日內最大連漲/跌">
                    {item.maxUpStreakIn10} / {item.maxDownStreakIn10}
                  </td>
                  <td data-label="MA5 / MA10">
                    {numberFormatter.format(item.ma5)} / {numberFormatter.format(item.ma10)}
                  </td>
                  <td data-label="RSI14">{numberFormatter.format(item.rsi14)}</td>
                  <td data-label="建議區間">{formatRange(item.rangeLow, item.rangeHigh)}</td>
                  <td data-label="防守價">
                    {item.riskGuard === null ? '--' : numberFormatter.format(item.riskGuard)}
                  </td>
                  <td data-label="建議原因">
                    {item.reasons.map((reason, index) => (
                      <small key={`${item.normalizedSymbol}-reason-${index}`}>- {reason}</small>
                    ))}
                  </td>
                  <td data-label="策略">
                    <strong>{item.strategyLabel}</strong>
                    <small>{item.note}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  )
}

interface StockSuggestionsSectionProps {
  trackedSymbols: string[]
}

function StockSuggestionsSection({ trackedSymbols }: StockSuggestionsSectionProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<StockSuggestion[]>([])
  const [message, setMessage] = useState('')
  const [lastUpdatedAt, setLastUpdatedAt] = useState('')
  const [scannedCount, setScannedCount] = useState(0)
  const [marketDate, setMarketDate] = useState('')

  const trackedTaiwanSymbols = useMemo(() => {
    return trackedSymbols
      .map((value) => value.trim().toUpperCase())
      .filter((value) => /^\d{4,6}$/.test(value))
  }, [trackedSymbols])

  const refreshSuggestions = useCallback(async () => {
    setIsLoading(true)
    setMessage('')

    try {
      const marketSymbols = await fetchTopTradedTaiwanSymbols(60)
      const symbols = Array.from(
        new Set([...trackedTaiwanSymbols, ...marketSymbols.symbols]),
      ).slice(
        0,
        36,
      )

      if (symbols.length === 0) {
        setSuggestions([])
        setScannedCount(0)
        setMessage('目前沒有可用的市場候選標的。')
        return
      }

      const results = await Promise.allSettled(
        symbols.map(async (symbol) => {
          const history = await fetchYahooDailyHistory(symbol)
          return buildSuggestion(history.symbol, history.normalizedSymbol, history.closes)
        }),
      )

      const successItems: StockSuggestion[] = []
      const failedSymbols: string[] = []

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successItems.push(result.value)
        } else {
          failedSymbols.push(symbols[index])
        }
      })

      successItems.sort((left, right) => {
        const leftScore = getSuggestionRankScore(left)
        const rightScore = getSuggestionRankScore(right)
        if (leftScore !== rightScore) {
          return rightScore - leftScore
        }
        return left.symbol.localeCompare(right.symbol)
      })

      setSuggestions(successItems)
      setScannedCount(symbols.length)
      setLastUpdatedAt(new Date().toISOString())
      const formattedDate = marketSymbols.marketDate.match(/^\d{8}$/)
        ? `${marketSymbols.marketDate.slice(0, 4)}-${marketSymbols.marketDate.slice(
            4,
            6,
          )}-${marketSymbols.marketDate.slice(6, 8)}`
        : marketSymbols.marketDate
      setMarketDate(formattedDate)

      if (successItems.length === 0) {
        setMessage('市場掃描完成，但目前沒有足夠資料可產出建議。')
      } else if (failedSymbols.length > 0) {
        setMessage(`部分代號讀取失敗：${failedSymbols.join(', ')}`)
      } else {
        setMessage('')
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : '未知錯誤'
      setSuggestions([])
      setScannedCount(0)
      setMessage(`更新建議失敗：${errorText}`)
    } finally {
      setIsLoading(false)
    }
  }, [trackedTaiwanSymbols])

  useEffect(() => {
    void refreshSuggestions()
  }, [refreshSuggestions])

  const rising = useMemo(() => {
    return suggestions
      .filter((item) => item.currentDirection === 'UP' && item.currentStreak >= 2)
      .slice(0, 12)
  }, [suggestions])
  const falling = useMemo(() => {
    return suggestions
      .filter((item) => item.currentDirection === 'DOWN' && item.currentStreak >= 2)
      .slice(0, 12)
  }, [suggestions])

  return (
    <section className="card">
      <div className="section-header">
        <h2>建議股票資訊（市場自動掃描）</h2>
        <button type="button" onClick={refreshSuggestions} disabled={isLoading}>
          {isLoading ? '計算中...' : '更新建議'}
        </button>
      </div>

      <p className="subtle">
        依市場成交排行自動擴充候選股，再用均線趨勢 + RSI + 連續漲跌做技術篩選，避免只看固定名單。
      </p>
      <p className="subtle">不鎖定固定股票池，系統每次更新都會重新掃描市場熱門股。</p>

      {message && <p className="warning">{message}</p>}

      <div className="suggestion-summary">
        <span className="badge">掃描樣本：{scannedCount} 檔</span>
        <span className="badge">連漲名單：{rising.length}</span>
        <span className="badge">連跌名單：{falling.length}</span>
        <span className="badge">市場日期：{marketDate || '尚未更新'}</span>
        <span className="badge">
          最近更新：
          {lastUpdatedAt
            ? ` ${new Date(lastUpdatedAt).toLocaleTimeString('zh-TW')}`
            : ' 尚未更新'}
        </span>
      </div>

      {renderSuggestionTable(
        '連續上漲名單（至少 2 天）',
        rising,
        '目前沒有符合條件的連漲股票。',
      )}
      {renderSuggestionTable(
        '連續下跌名單（至少 2 天）',
        falling,
        '目前沒有符合條件的連跌股票。',
      )}
    </section>
  )
}

export default StockSuggestionsSection
