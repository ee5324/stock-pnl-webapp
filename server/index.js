import 'dotenv/config'
import cors from 'cors'
import express from 'express'

const app = express()
const port = Number(process.env.PORT ?? 8787)

app.use(cors())
app.use(express.json())

function normalizeSymbol(inputSymbol) {
  const symbol = String(inputSymbol ?? '')
    .trim()
    .toUpperCase()

  if (!symbol) {
    throw new Error('請提供股票代號')
  }

  if (/^\d+$/.test(symbol)) {
    return `${symbol}.TW`
  }

  return symbol
}

/** 台股上市常用 Finnhub 代碼 TPE:XXXX；美股等維持原 ticker。 */
function toFinnhubSymbol(rawSymbol) {
  const s = String(rawSymbol ?? '')
    .trim()
    .toUpperCase()

  if (!s) {
    throw new Error('請提供股票代號')
  }

  const twWithSuffix = /^(\d{4,6})\.TW$/.exec(s)
  if (twWithSuffix) {
    return `TPE:${twWithSuffix[1]}`
  }

  if (/^\d{4,6}$/.test(s)) {
    return `TPE:${s}`
  }

  return s
}

function isLikelyTaiwanListed(code) {
  return /^\d{4,6}(\.TW)?$/.test(code)
}

async function fetchQuoteFromYahoo(rawSymbol) {
  const yahooSymbol = normalizeSymbol(rawSymbol)
  const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1m&range=1d`
  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': 'stock-pnl-webapp/1.0',
    },
  })

  if (!response.ok) {
    throw new Error(`無法取得 ${rawSymbol} 報價 (${response.status})`)
  }

  const payload = await response.json()
  const meta = payload?.chart?.result?.[0]?.meta

  if (!meta) {
    throw new Error(`查無 ${rawSymbol} 報價資料`)
  }

  const priceCandidates = [
    meta.regularMarketPrice,
    meta.postMarketPrice,
    meta.preMarketPrice,
  ]
  const price = priceCandidates.find((value) => typeof value === 'number')

  if (typeof price !== 'number') {
    throw new Error(`報價資料不完整：${rawSymbol}`)
  }

  const previousClose =
    typeof meta.previousClose === 'number'
      ? meta.previousClose
      : typeof meta.chartPreviousClose === 'number'
        ? meta.chartPreviousClose
        : price
  const change = price - previousClose
  const changePercent = previousClose === 0 ? 0 : (change / previousClose) * 100

  const displayNameRaw =
    typeof meta.longName === 'string' && meta.longName.trim()
      ? meta.longName.trim()
      : typeof meta.shortName === 'string' && meta.shortName.trim()
        ? meta.shortName.trim()
        : undefined

  return {
    symbol: String(rawSymbol).trim().toUpperCase(),
    yahooSymbol,
    displayName: displayNameRaw,
    price,
    previousClose,
    change,
    changePercent,
    currency: meta.currency ?? 'TWD',
    fetchedAt: new Date().toISOString(),
  }
}

async function fetchQuoteFromFinnhub(rawSymbol, token) {
  const finnhubSymbol = toFinnhubSymbol(rawSymbol)
  const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSymbol)}&token=${encodeURIComponent(token)}`
  const quoteRes = await fetch(quoteUrl)

  if (!quoteRes.ok) {
    throw new Error(`Finnhub quote HTTP ${quoteRes.status}`)
  }

  const data = await quoteRes.json()
  let current = typeof data.c === 'number' && Number.isFinite(data.c) ? data.c : null
  const previousClose =
    typeof data.pc === 'number' && Number.isFinite(data.pc) ? data.pc : null

  if (current === 0 || current === null) {
    if (previousClose !== null && previousClose > 0) {
      current = previousClose
    }
  }

  if (typeof current !== 'number' || !Number.isFinite(current) || current <= 0) {
    throw new Error('Finnhub 無可用成交價')
  }

  const baseClose = previousClose !== null && previousClose > 0 ? previousClose : current
  const change = current - baseClose
  const changePercent = baseClose === 0 ? 0 : (change / baseClose) * 100

  let displayName
  let currency = isLikelyTaiwanListed(String(rawSymbol).trim().toUpperCase()) ? 'TWD' : 'USD'

  try {
    const profileUrl = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(finnhubSymbol)}&token=${encodeURIComponent(token)}`
    const profileRes = await fetch(profileUrl)
    if (profileRes.ok) {
      const profile = await profileRes.json()
      if (typeof profile.name === 'string' && profile.name.trim()) {
        displayName = profile.name.trim()
      }
      if (typeof profile.currency === 'string' && profile.currency.trim()) {
        currency = profile.currency.trim().toUpperCase()
      }
    }
  } catch {
    /* profile 為加分項，失敗忽略 */
  }

  const code = String(rawSymbol).trim().toUpperCase()

  return {
    symbol: code,
    yahooSymbol: normalizeSymbol(rawSymbol),
    displayName,
    price: current,
    previousClose: baseClose,
    change,
    changePercent,
    currency,
    fetchedAt: new Date().toISOString(),
  }
}

async function fetchQuote(rawSymbol) {
  let yahooError
  try {
    return await fetchQuoteFromYahoo(rawSymbol)
  } catch (err) {
    yahooError = err
  }

  const token = String(process.env.FINNHUB_API_KEY ?? '').trim()
  if (!token) {
    throw yahooError instanceof Error ? yahooError : new Error(String(yahooError))
  }

  try {
    return await fetchQuoteFromFinnhub(rawSymbol, token)
  } catch (finnhubErr) {
    const yMsg = yahooError instanceof Error ? yahooError.message : String(yahooError)
    const fMsg = finnhubErr instanceof Error ? finnhubErr.message : String(finnhubErr)
    throw new Error(`${yMsg}（Finnhub：${fMsg}）`)
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/quote', async (req, res) => {
  const symbol = String(req.query.symbol ?? '')

  if (!symbol.trim()) {
    res.status(400).json({ error: '請提供 symbol 參數' })
    return
  }

  try {
    const quote = await fetchQuote(symbol)
    res.json({ quote })
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : '讀取報價失敗' })
  }
})

app.get('/api/quotes', async (req, res) => {
  const symbolsParam = String(req.query.symbols ?? '')
  const symbols = symbolsParam
    .split(',')
    .map((symbol) => symbol.trim())
    .filter(Boolean)

  if (symbols.length === 0) {
    res.status(400).json({ error: '請提供 symbols 參數，例如 symbols=2330,2317' })
    return
  }

  const uniqueSymbols = [...new Set(symbols)].slice(0, 30)
  const results = await Promise.allSettled(uniqueSymbols.map((symbol) => fetchQuote(symbol)))
  const quotes = {}
  const errors = {}

  results.forEach((result, index) => {
    const symbol = uniqueSymbols[index]
    if (result.status === 'fulfilled') {
      quotes[symbol] = result.value
      return
    }

    errors[symbol] = result.reason instanceof Error ? result.reason.message : '讀取失敗'
  })

  res.json({ quotes, errors })
})

app.listen(port, () => {
  console.log(`Stock quote API running on http://localhost:${port}`)
})
