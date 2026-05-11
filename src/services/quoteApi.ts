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

function quoteApiBaseUrl(): string {
  return String(import.meta.env.VITE_QUOTE_API_BASE ?? '').trim().replace(/\/$/, '')
}

interface QuoteServerEnvelope {
  quote?: {
    symbol: string
    price: number
    currency?: string
    fetchedAt: string
    displayName?: string
  }
  error?: string
}

/** Same-origin `/api/quote` (Vite proxy → server) or `VITE_QUOTE_API_BASE` in production. */
async function fetchFromQuoteServer(symbol: string): Promise<QuoteData> {
  const trimmed = symbol.trim()
  const path = `/api/quote?symbol=${encodeURIComponent(trimmed)}`
  const base = quoteApiBaseUrl()
  const url = base ? `${base}${path}` : path

  const response = await fetch(url)
  const text = await response.text()
  let payload: QuoteServerEnvelope
  try {
    payload = JSON.parse(text) as QuoteServerEnvelope
  } catch {
    throw new Error(
      response.ok ? '報價伺服器回傳格式異常' : `報價伺服器 HTTP ${response.status}`,
    )
  }

  if (!response.ok) {
    throw new Error(payload.error ?? `報價伺服器 HTTP ${response.status}`)
  }

  const quote = payload.quote
  if (!quote || typeof quote.price !== 'number') {
    throw new Error('報價伺服器無可用資料')
  }

  const displayName =
    typeof quote.displayName === 'string' && quote.displayName.trim()
      ? quote.displayName.trim()
      : undefined

  return {
    symbol: quote.symbol.trim().toUpperCase(),
    price: quote.price,
    currency: quote.currency ?? 'TWD',
    fetchedAt: quote.fetchedAt,
    ...(displayName ? { displayName } : {}),
  }
}

function formatQuoteFetchFailure(errors: string[]): string {
  const joined = errors.join(' | ')
  if (!/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(joined)) {
    return joined
  }
  return `${joined}（直接從瀏覽器連 Yahoo 常被 CORS／網路擋下。請執行「npm run dev:all」或另開終端跑「npm run server」再開前端，靜態部署請設定 VITE_QUOTE_API_BASE 指向你的報價 API 網址）`
}

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
  const providers: Array<(value: string) => Promise<QuoteData>> = [
    fetchFromQuoteServer,
    fetchFromYahoo,
  ]
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

  throw new Error(formatQuoteFetchFailure(errors))
}
