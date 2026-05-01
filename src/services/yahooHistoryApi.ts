import { normalizeSymbol } from './quoteApi'

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[]
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>
        }>
      }
    }>
    error?: {
      description?: string
    }
  }
}

export interface YahooHistoryData {
  symbol: string
  normalizedSymbol: string
  closes: number[]
}

export async function fetchYahooDailyHistory(
  symbol: string,
): Promise<YahooHistoryData> {
  const normalizedSymbol = normalizeSymbol(symbol)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normalizedSymbol)}?interval=1d&range=3mo`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Yahoo 歷史資料 HTTP ${response.status}`)
  }

  const payload = (await response.json()) as YahooChartResponse
  const chartError = payload.chart?.error?.description
  if (chartError) {
    throw new Error(chartError)
  }

  const result = payload.chart?.result?.[0]
  const closes = result?.indicators?.quote?.[0]?.close ?? []
  const validCloses = closes.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  )

  if (validCloses.length < 20) {
    throw new Error('歷史資料不足，無法計算指標')
  }

  return {
    symbol: symbol.trim().toUpperCase(),
    normalizedSymbol,
    closes: validCloses,
  }
}
