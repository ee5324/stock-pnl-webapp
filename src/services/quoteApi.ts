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
  /** 頻率過高或試用限制時常見 */
  Note?: string
  Information?: string
}

const alphaVantageApiKey = import.meta.env.VITE_ALPHA_VANTAGE_API_KEY
const finnhubApiKey = String(import.meta.env.VITE_FINNHUB_API_KEY ?? '').trim()

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

  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知錯誤'
    throw new Error(
      `報價伺服器無法連線（${detail}）。本機請執行「npm run dev:all」，或另開終端跑「npm run server」再跑「npm run dev」（需 Vite 將 /api 轉到 8787）。`,
    )
  }

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

/**
 * 僅靜默略過：靜態託管沒有掛 `/api` 時回傳的 404。
 * 連線失敗（Failed to fetch）不再略過，避免只剩 Yahoo CORS 訊息、看不出是報價伺服器沒開。
 */
function isRelativeQuoteServerUnavailable(
  provider: (symbol: string) => Promise<QuoteData>,
  message: string,
): boolean {
  if (provider !== fetchFromQuoteServer || quoteApiBaseUrl()) {
    return false
  }
  return /報價伺服器 HTTP 404\b/.test(message)
}

function formatQuoteFetchFailure(errors: string[]): string {
  const joined = errors.join(' | ')
  if (!/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(joined)) {
    return joined
  }
  return `${joined}（瀏覽器直連 Yahoo 常被 CORS 擋下。請確認：① 本機已「npm run dev:all」或已開報價伺服器；② 靜態部署已設 VITE_QUOTE_API_BASE；③ 可另設免費 VITE_FINNHUB_API_KEY（https://finnhub.io/register）或已設 VITE_ALPHA_VANTAGE_API_KEY 並重啟 dev 讓 .env 生效）`
}

/** 與 server/index.js `toFinnhubSymbol` 一致：台股上市 → TPE:代號。 */
function userSymbolToFinnhubSymbol(rawSymbol: string): string {
  const s = rawSymbol.trim().toUpperCase()
  const twSuffix = /^(\d{4,6})\.TW$/.exec(s)
  if (twSuffix) {
    return `TPE:${twSuffix[1]}`
  }
  if (/^\d{4,6}$/.test(s)) {
    return `TPE:${s}`
  }
  return s
}

function isLikelyTaiwanListedSymbol(code: string): boolean {
  return /^\d{4,6}(\.TW)?$/.test(code.trim().toUpperCase())
}

interface FinnhubQuoteResponse {
  c?: number
  pc?: number
}

interface FinnhubProfileResponse {
  name?: string
  currency?: string
}

async function fetchFromFinnhub(symbol: string): Promise<QuoteData> {
  if (!finnhubApiKey) {
    throw new Error('未設定 VITE_FINNHUB_API_KEY')
  }

  const finnhubSym = userSymbolToFinnhubSymbol(symbol)
  const token = encodeURIComponent(finnhubApiKey)
  const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSym)}&token=${token}`

  const quoteRes = await fetch(quoteUrl)
  if (!quoteRes.ok) {
    throw new Error(`Finnhub HTTP ${quoteRes.status}`)
  }

  const data = (await quoteRes.json()) as FinnhubQuoteResponse
  let current = typeof data.c === 'number' && Number.isFinite(data.c) ? data.c : null
  const previousClose =
    typeof data.pc === 'number' && Number.isFinite(data.pc) ? data.pc : null

  if (current === 0 || current === null) {
    if (previousClose !== null && previousClose > 0) {
      current = previousClose
    }
  }

  if (typeof current !== 'number' || !Number.isFinite(current) || current <= 0) {
    throw new Error('Finnhub 無可用報價')
  }

  let displayName: string | undefined
  let currency = isLikelyTaiwanListedSymbol(symbol) ? 'TWD' : 'USD'

  try {
    const profileUrl = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(finnhubSym)}&token=${token}`
    const profileRes = await fetch(profileUrl)
    if (profileRes.ok) {
      const profile = (await profileRes.json()) as FinnhubProfileResponse
      if (typeof profile.name === 'string' && profile.name.trim()) {
        displayName = profile.name.trim()
      }
      if (typeof profile.currency === 'string' && profile.currency.trim()) {
        currency = profile.currency.trim().toUpperCase()
      }
    }
  } catch {
    /* optional */
  }

  return {
    symbol: symbol.trim().toUpperCase(),
    price: current,
    currency,
    fetchedAt: new Date().toISOString(),
    ...(displayName ? { displayName } : {}),
  }
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
  if (typeof data.Note === 'string' && data.Note.trim()) {
    throw new Error('Alpha Vantage 請求過於頻繁或暫不可用（Note），請稍後再試')
  }
  if (typeof data.Information === 'string' && data.Information.trim()) {
    throw new Error('Alpha Vantage：請確認 API Key 與額度（Information）')
  }

  const quoteData = data['Global Quote']
  if (!quoteData || Object.keys(quoteData).length === 0) {
    throw new Error(
      'Alpha Vantage 無 GLOBAL_QUOTE 資料（免費版常僅支援部分美股代號，台股請依賴報價伺服器／Yahoo／Finnhub）',
    )
  }

  const parsedPrice = Number(quoteData['05. price'])

  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
    throw new Error('Alpha Vantage 無可用報價')
  }

  const code = symbol.trim().toUpperCase()
  const currency = /^\d{4,6}(\.TW)?$/.test(code) ? 'TWD' : 'USD'

  return {
    symbol: code,
    price: parsedPrice,
    currency,
    fetchedAt: new Date().toISOString(),
    displayName: quoteData?.['01. symbol'] ?? normalized,
  }
}

export async function fetchLatestQuote(symbol: string): Promise<QuoteData> {
  const providers: Array<(value: string) => Promise<QuoteData>> = [fetchFromQuoteServer]
  if (finnhubApiKey) {
    providers.push(fetchFromFinnhub)
  }
  // Alpha 多數環境可從瀏覽器直連；台股 GLOBAL_QUOTE 常無資料，但仍應早於 Yahoo 以避開 CORS
  if (alphaVantageApiKey) {
    providers.push(fetchFromAlphaVantage)
  }
  providers.push(fetchFromYahoo)

  const errors: string[] = []
  for (const provider of providers) {
    try {
      return await provider(symbol)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知錯誤'
      if (isRelativeQuoteServerUnavailable(provider, message)) {
        continue
      }
      errors.push(message)
    }
  }

  throw new Error(formatQuoteFetchFailure(errors))
}
