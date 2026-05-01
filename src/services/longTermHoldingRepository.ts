import type { LongTermHolding } from '../types'

const STORAGE_KEY = 'stock-tracker-long-term-holdings'

type LongTermHoldingInput = Omit<LongTermHolding, 'id' | 'createdAt'>

function parseRawHolding(value: unknown): LongTermHolding | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Partial<LongTermHolding>
  if (
    typeof item.id !== 'string' ||
    typeof item.symbol !== 'string' ||
    typeof item.quantity !== 'number' ||
    typeof item.averageCost !== 'number' ||
    typeof item.startedAt !== 'string' ||
    typeof item.createdAt !== 'number'
  ) {
    return null
  }

  return {
    id: item.id,
    symbol: item.symbol,
    quantity: item.quantity,
    averageCost: item.averageCost,
    startedAt: item.startedAt,
    thesis: typeof item.thesis === 'string' ? item.thesis : undefined,
    createdAt: item.createdAt,
  }
}

function sortRows(rows: LongTermHolding[]): LongTermHolding[] {
  return [...rows].sort((left, right) => {
    if (left.startedAt === right.startedAt) {
      return right.createdAt - left.createdAt
    }
    return right.startedAt.localeCompare(left.startedAt)
  })
}

export function getLongTermHoldings(): LongTermHolding[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as unknown[]
    return sortRows(
      parsed
        .map(parseRawHolding)
        .filter((item): item is LongTermHolding => item !== null),
    )
  } catch {
    return []
  }
}

function writeLongTermHoldings(rows: LongTermHolding[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
}

export function createLongTermHolding(input: LongTermHoldingInput): LongTermHolding {
  const row: LongTermHolding = {
    id: crypto.randomUUID(),
    symbol: input.symbol.trim().toUpperCase(),
    quantity: input.quantity,
    averageCost: input.averageCost,
    startedAt: input.startedAt,
    thesis: input.thesis?.trim() || undefined,
    createdAt: Date.now(),
  }

  const next = sortRows([row, ...getLongTermHoldings()])
  writeLongTermHoldings(next)
  return row
}

export function deleteLongTermHolding(id: string): void {
  const next = getLongTermHoldings().filter((item) => item.id !== id)
  writeLongTermHoldings(next)
}
