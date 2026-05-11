import type { QuoteData } from '../types'
import { normalizeSymbol } from '../services/quoteApi'

type NameSource = Pick<QuoteData, 'displayName'> | null | undefined

/**
 * 顯示「代號 · 股名」：股名來自報價 API（Yahoo short/long name 等）。
 * 若尚無股名、或股名與代號重複，則只顯示代號。
 */
export function symbolWithCompanyName(symbol: string, quote?: NameSource): string {
  const code = symbol.trim().toUpperCase()
  const raw = quote?.displayName?.trim()
  if (!raw) {
    return code
  }

  const yahooTicker = normalizeSymbol(code).toUpperCase()
  const rawUpper = raw.toUpperCase()

  if (rawUpper === code || rawUpper === yahooTicker || raw === code) {
    return code
  }

  return `${code} · ${raw}`
}
