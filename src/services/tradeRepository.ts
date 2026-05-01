import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { TradeAction, TradeRecord } from '../types'

const STORAGE_KEY = 'stock-tracker-trades'

type TradeInput = Omit<TradeRecord, 'id' | 'createdAt'>
type TradeUpdateInput = Omit<TradeRecord, 'id'>

function parseRawTrade(value: unknown): TradeRecord | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const trade = value as Partial<TradeRecord>
  const action = trade.action as TradeAction

  if (
    typeof trade.id !== 'string' ||
    typeof trade.symbol !== 'string' ||
    (action !== 'BUY' && action !== 'SELL') ||
    typeof trade.quantity !== 'number' ||
    typeof trade.price !== 'number' ||
    typeof trade.tradedAt !== 'string' ||
    typeof trade.createdAt !== 'number'
  ) {
    return null
  }

  return {
    id: trade.id,
    symbol: trade.symbol,
    action,
    quantity: trade.quantity,
    price: trade.price,
    tradedAt: trade.tradedAt,
    note: typeof trade.note === 'string' ? trade.note : undefined,
    createdAt: trade.createdAt,
  }
}

function sortTrades(trades: TradeRecord[]): TradeRecord[] {
  return [...trades].sort((a, b) => {
    if (a.tradedAt === b.tradedAt) {
      return b.createdAt - a.createdAt
    }
    return b.tradedAt.localeCompare(a.tradedAt)
  })
}

function readLocalTrades(): TradeRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as unknown[]
    return sortTrades(
      parsed
        .map(parseRawTrade)
        .filter((trade): trade is TradeRecord => trade !== null),
    )
  } catch {
    return []
  }
}

function writeLocalTrades(trades: TradeRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trades))
}

export const storageMode = db ? 'firebase' : 'local-storage'

export function subscribeTrades(
  onData: (trades: TradeRecord[]) => void,
  onError: (message: string) => void,
): () => void {
  if (!db) {
    onData(readLocalTrades())
    return () => undefined
  }

  const tradesQuery = query(
    collection(db, 'trades'),
    orderBy('tradedAt', 'desc'),
  )

  return onSnapshot(
    tradesQuery,
    (snapshot) => {
      const trades = sortTrades(snapshot.docs.map((item) => {
        const data = item.data() as Omit<TradeRecord, 'id'>
        return {
          id: item.id,
          symbol: data.symbol,
          action: data.action,
          quantity: data.quantity,
          price: data.price,
          tradedAt: data.tradedAt,
          note: data.note,
          createdAt: data.createdAt,
        } satisfies TradeRecord
      }))

      onData(trades)
    },
    (error) => {
      onError(error.message)
    },
  )
}

export async function createTrade(input: TradeInput): Promise<void> {
  const payload = {
    ...input,
    symbol: input.symbol.trim().toUpperCase(),
    createdAt: Date.now(),
  }

  if (!db) {
    const current = readLocalTrades()
    const trade: TradeRecord = {
      id: crypto.randomUUID(),
      ...payload,
    }
    current.unshift(trade)
    writeLocalTrades(current)
    return
  }

  await addDoc(collection(db, 'trades'), payload)
}

export async function updateTrade(
  id: string,
  input: TradeUpdateInput,
): Promise<void> {
  const payload = {
    ...input,
    symbol: input.symbol.trim().toUpperCase(),
  }

  if (!db) {
    const current = readLocalTrades()
    const next = current.map((trade) => {
      if (trade.id !== id) {
        return trade
      }
      return {
        id,
        ...payload,
      } satisfies TradeRecord
    })
    writeLocalTrades(next)
    return
  }

  await setDoc(doc(db, 'trades', id), payload)
}

export async function removeTrade(id: string): Promise<void> {
  if (!db) {
    const next = readLocalTrades().filter((trade) => trade.id !== id)
    writeLocalTrades(next)
    return
  }

  await deleteDoc(doc(db, 'trades', id))
}
