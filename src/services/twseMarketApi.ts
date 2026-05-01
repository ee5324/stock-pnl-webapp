interface TwseMarketTable {
  title?: string
  fields?: string[]
  data?: string[][]
}

interface TwseMarketResponse {
  stat?: string
  date?: string
  tables?: TwseMarketTable[]
}

interface TwseMarketRow {
  symbol: string
  turnover: number
}

const LOOKBACK_DAYS = 14

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw) {
    return null
  }

  const cleaned = raw
    .replaceAll(',', '')
    .replaceAll('+', '')
    .replaceAll(' ', '')
    .trim()

  if (!cleaned || cleaned === '--' || cleaned === '-') {
    return null
  }

  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

function findColumnIndex(fields: string[], keyword: string): number {
  return fields.findIndex((value) => value.includes(keyword))
}

function parseMarketRows(payload: TwseMarketResponse): TwseMarketRow[] {
  const tables = payload.tables ?? []
  const targetTable = tables.find((table) => {
    const fields = table.fields ?? []
    return (
      fields.some((value) => value.includes('證券代號')) &&
      fields.some((value) => value.includes('成交金額'))
    )
  })

  if (!targetTable) {
    return []
  }

  const fields = targetTable.fields ?? []
  const rows = targetTable.data ?? []
  const symbolIndex = findColumnIndex(fields, '證券代號')
  const turnoverIndex = findColumnIndex(fields, '成交金額')
  const closeIndex = findColumnIndex(fields, '收盤價')

  if (symbolIndex < 0 || turnoverIndex < 0) {
    return []
  }

  const parsedRows: TwseMarketRow[] = []

  for (const row of rows) {
    const symbol = String(row[symbolIndex] ?? '').trim().toUpperCase()
    if (!/^\d{4,6}$/.test(symbol)) {
      continue
    }

    const turnover = parseNumber(row[turnoverIndex])
    const close = closeIndex >= 0 ? parseNumber(row[closeIndex]) : 1
    if (turnover === null || turnover <= 0 || close === null || close <= 0) {
      continue
    }

    parsedRows.push({ symbol, turnover })
  }

  return parsedRows
}

async function fetchMarketRowsByDate(dateKey: string): Promise<TwseMarketRow[]> {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${dateKey}&type=ALLBUT0999&response=json`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`TWSE HTTP ${response.status}`)
  }

  const payload = (await response.json()) as TwseMarketResponse
  return parseMarketRows(payload)
}

export interface TopTradedSymbolsResult {
  symbols: string[]
  marketDate: string
}

export async function fetchTopTradedTaiwanSymbols(
  limit: number,
): Promise<TopTradedSymbolsResult> {
  const safeLimit = Math.max(1, Math.min(200, Math.round(limit)))

  for (let offset = 0; offset < LOOKBACK_DAYS; offset += 1) {
    const candidate = new Date()
    candidate.setDate(candidate.getDate() - offset)
    const dateKey = formatDateKey(candidate)

    try {
      const rows = await fetchMarketRowsByDate(dateKey)
      if (rows.length === 0) {
        continue
      }

      rows.sort((left, right) => right.turnover - left.turnover)
      return {
        symbols: rows.slice(0, safeLimit).map((row) => row.symbol),
        marketDate: dateKey,
      }
    } catch {
      // Try previous trading day.
    }
  }

  throw new Error('近 14 天查無可用成交排行資料')
}
