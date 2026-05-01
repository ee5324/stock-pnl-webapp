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

async function fetchQuote(rawSymbol) {
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

  return {
    symbol: String(rawSymbol).trim().toUpperCase(),
    yahooSymbol,
    price,
    previousClose,
    change,
    changePercent,
    currency: meta.currency ?? 'TWD',
    fetchedAt: new Date().toISOString(),
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
