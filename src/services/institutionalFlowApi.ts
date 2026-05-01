import type {
  FlowSignalLevel,
  InstitutionalFlowEntry,
  InstitutionalFlowThresholds,
} from '../types'

interface TwseResponse {
  stat?: string
  date?: string
  fields?: string[]
  data?: string[][]
}

interface TwseRecord {
  foreignNetShares: number | null
  institutionalNetShares: number | null
}

const LOOKBACK_DAYS = 14

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function formatDisplayDate(dateKey: string): string {
  if (!/^\d{8}$/.test(dateKey)) {
    return dateKey
  }

  return `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`
}

function parseShareValue(raw: string | undefined): number | null {
  if (!raw) {
    return null
  }

  const cleaned = raw
    .replaceAll(',', '')
    .replaceAll('+', '')
    .replaceAll(' ', '')
    .trim()

  if (!cleaned) {
    return null
  }

  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

function findColumnIndex(fields: string[], keyword: string): number {
  return fields.findIndex((field) => field.includes(keyword))
}

function classifySignal(
  netLots: number | null,
  threshold: number,
): FlowSignalLevel {
  if (netLots === null) {
    return 'NO_DATA'
  }

  if (netLots >= threshold) {
    return 'HEAVY_BUY'
  }

  if (netLots <= -threshold) {
    return 'HEAVY_SELL'
  }

  return 'NEUTRAL'
}

function buildWarningText(
  foreignSignal: FlowSignalLevel,
  institutionalSignal: FlowSignalLevel,
): string {
  if (
    foreignSignal === 'HEAVY_BUY' &&
    institutionalSignal === 'HEAVY_BUY'
  ) {
    return '外資與三大法人同向大買，代表市場共識轉強，但需留意短線追高風險。'
  }

  if (
    foreignSignal === 'HEAVY_SELL' &&
    institutionalSignal === 'HEAVY_SELL'
  ) {
    return '外資與三大法人同向大賣，屬於籌碼轉弱警訊，短線可能持續承壓。'
  }

  if (foreignSignal === 'HEAVY_BUY') {
    return '外資大量買入，常見於中期偏多布局，但若量價背離仍要防拉回。'
  }

  if (foreignSignal === 'HEAVY_SELL') {
    return '外資大量賣出，代表外部資金風險偏好下降，需注意趨勢轉弱。'
  }

  if (institutionalSignal === 'HEAVY_BUY') {
    return '三大法人大量買入，市場主力籌碼偏多，常見於波段啟動或續強。'
  }

  if (institutionalSignal === 'HEAVY_SELL') {
    return '三大法人大量賣出，主力籌碼轉空，若跌破關鍵均線屬風險警訊。'
  }

  return '法人買賣力道中性，尚未出現明確籌碼警訊。'
}

function parseTwseTable(payload: TwseResponse): Map<string, TwseRecord> {
  const fields = payload.fields ?? []
  const rows = payload.data ?? []
  const foreignIndex = findColumnIndex(fields, '外陸資買賣超股數')
  const institutionalIndex = findColumnIndex(fields, '三大法人買賣超股數')

  const fallbackForeignIndex = 4
  const fallbackInstitutionalIndex = fields.length > 0 ? fields.length - 1 : -1

  const foreignNetIndex = foreignIndex >= 0 ? foreignIndex : fallbackForeignIndex
  const institutionalNetIndex =
    institutionalIndex >= 0 ? institutionalIndex : fallbackInstitutionalIndex

  const records = new Map<string, TwseRecord>()

  for (const row of rows) {
    const symbol = String(row[0] ?? '').trim().toUpperCase()
    if (!/^\d{4,6}$/.test(symbol)) {
      continue
    }

    records.set(symbol, {
      foreignNetShares: parseShareValue(row[foreignNetIndex]),
      institutionalNetShares: parseShareValue(row[institutionalNetIndex]),
    })
  }

  return records
}

async function fetchTwseByDate(
  dateKey: string,
): Promise<{ dateKey: string; records: Map<string, TwseRecord> }> {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${dateKey}&selectType=ALLBUT0999&response=json`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`TWSE HTTP ${response.status}`)
  }

  const payload = (await response.json()) as TwseResponse
  const records = parseTwseTable(payload)

  return {
    dateKey: payload.date ?? dateKey,
    records,
  }
}

async function fetchLatestTwseSnapshot(): Promise<{
  date: string
  records: Map<string, TwseRecord>
}> {
  for (let offset = 0; offset < LOOKBACK_DAYS; offset += 1) {
    const candidate = new Date()
    candidate.setDate(candidate.getDate() - offset)
    const dateKey = formatDateKey(candidate)

    try {
      const result = await fetchTwseByDate(dateKey)
      if (result.records.size > 0) {
        return {
          date: formatDisplayDate(result.dateKey),
          records: result.records,
        }
      }
    } catch {
      // Continue searching previous days.
    }
  }

  throw new Error('近 14 天查無可用法人買賣資料')
}

export function filterTaiwanSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((value) => value.trim().toUpperCase()))].filter(
    (symbol) => /^\d{4,6}$/.test(symbol),
  )
}

export async function fetchInstitutionalFlowSignals(
  symbols: string[],
  thresholds: InstitutionalFlowThresholds,
): Promise<InstitutionalFlowEntry[]> {
  const targets = filterTaiwanSymbols(symbols)
  if (targets.length === 0) {
    return []
  }

  const snapshot = await fetchLatestTwseSnapshot()

  const rows = targets.map((symbol) => {
    const record = snapshot.records.get(symbol)
    const foreignNetLots =
      record?.foreignNetShares === null || record?.foreignNetShares === undefined
        ? null
        : record.foreignNetShares / 1000
    const institutionalNetLots =
      record?.institutionalNetShares === null ||
      record?.institutionalNetShares === undefined
        ? null
        : record.institutionalNetShares / 1000

    const foreignSignal = classifySignal(foreignNetLots, thresholds.foreignLots)
    const institutionalSignal = classifySignal(
      institutionalNetLots,
      thresholds.institutionalLots,
    )

    return {
      symbol,
      tradeDate: snapshot.date,
      foreignNetLots,
      institutionalNetLots,
      foreignSignal,
      institutionalSignal,
      warningText: buildWarningText(foreignSignal, institutionalSignal),
    } satisfies InstitutionalFlowEntry
  })

  const signalPriority: Record<FlowSignalLevel, number> = {
    HEAVY_SELL: 4,
    HEAVY_BUY: 3,
    NEUTRAL: 2,
    NO_DATA: 1,
  }

  rows.sort((left, right) => {
    const leftScore = Math.max(
      signalPriority[left.foreignSignal],
      signalPriority[left.institutionalSignal],
    )
    const rightScore = Math.max(
      signalPriority[right.foreignSignal],
      signalPriority[right.institutionalSignal],
    )

    if (leftScore !== rightScore) {
      return rightScore - leftScore
    }

    return left.symbol.localeCompare(right.symbol)
  })

  return rows
}
