import type { QuoteData } from '../types'

interface YahooResponse {
  quoteResponse?: {
    result?: Array<{
      symbol?: string
      shortName?: string
      longName?: string
      regularMarketPrice?: number
      currency?: string
    }>
  }
}

interface AlphaResponse {
  'Global Quote'?: {
    '05. price'?: string
    '01. symbol'?: string
  }
}

const alphaVantageApiKey = import.meta.env.VITE_ALPHA_VANTAGE_API_KEY

export function normalizeSymbol(rawSymbol: string): string {
  const value = rawSymbol.trim().toUpperCase()

  if (/^\d{4,6}$/.test(value)) {
    return `${value}.TW`
  }

  return value
}

async function fetchFromYahoo(symbol: string): Promise<QuoteData> {
  const normalized = normalizeSymbol(symbol)
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(normalized)}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Yahoo Finance HTTP ${response.status}`)
  }

  const data = (await response.json()) as YahooResponse
  const quote = data.quoteResponse?.result?.[0]

  if (!quote || typeof quote.regularMarketPrice !== 'number') {
    throw new Error('Yahoo Finance 無可用報價')
  }

  return {
    symbol: symbol.trim().toUpperCase(),
    price: quote.regularMarketPrice,
    currency: quote.currency ?? 'TWD',
    fetchedAt: new Date().toISOString(),
    displayName: quote.longName ?? quote.shortName ?? quote.symbol,
  }
}

async function fetchFromAlphaVantage(symbol: string): Promise<QuoteData> {
  if (!alphaVantageApiKey) {
    throw new Error('未設定 Alpha Vantage API Key')
  }

  const normalized = normalizeSymbol(symbol)
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(normalized)}&apikey=${encodeURIComponent(alphaVantageApiKey)}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Alpha Vantage HTTP ${response.status}`)
  }

  const data = (await response.json()) as AlphaResponse
  const quoteData = data['Global Quote']
  const parsedPrice = Number(quoteData?.['05. price'])

  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
    throw new Error('Alpha Vantage 無可用報價')
  }

  return {
    symbol: symbol.trim().toUpperCase(),
    price: parsedPrice,
    currency: 'USD',
    fetchedAt: new Date().toISOString(),
    displayName: quoteData?.['01. symbol'] ?? normalized,
  }
}

export async function fetchLatestQuote(symbol: string): Promise<QuoteData> {
  const providers: Array<(value: string) => Promise<QuoteData>> = [fetchFromYahoo]
  if (alphaVantageApiKey) {
    providers.push(fetchFromAlphaVantage)
  }

  const errors: string[] = []
  for (const provider of providers) {
    try {
      return await provider(symbol)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知錯誤'
      errors.push(message)
    }
  }

  throw new Error(errors.join(' | '))
}
