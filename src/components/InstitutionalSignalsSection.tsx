import type { InstitutionalFlowEntry } from '../types'

interface InstitutionalSignalsSectionProps {
  rows: InstitutionalFlowEntry[]
  isLoading: boolean
  errorMessage: string
  autoEnabled: boolean
  autoIntervalMinutes: number
  lastUpdatedAt: string
  onRefresh: () => Promise<void> | void
}

const numberFormatter = new Intl.NumberFormat('zh-TW', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

function formatLots(value: number | null): string {
  if (value === null) {
    return '--'
  }

  return `${numberFormatter.format(value)} 張`
}

function getSignalText(signal: InstitutionalFlowEntry['foreignSignal']): string {
  if (signal === 'HEAVY_BUY') {
    return '大量買入'
  }
  if (signal === 'HEAVY_SELL') {
    return '大量賣出'
  }
  if (signal === 'NO_DATA') {
    return '無資料'
  }
  return '中性'
}

function getSignalClass(signal: InstitutionalFlowEntry['foreignSignal']): string {
  if (signal === 'HEAVY_BUY') {
    return 'buy'
  }
  if (signal === 'HEAVY_SELL') {
    return 'sell'
  }
  if (signal === 'NO_DATA') {
    return 'na'
  }
  return 'neutral'
}

function InstitutionalSignalsSection({
  rows,
  isLoading,
  errorMessage,
  autoEnabled,
  autoIntervalMinutes,
  lastUpdatedAt,
  onRefresh,
}: InstitutionalSignalsSectionProps) {
  return (
    <section className="card">
      <div className="section-header">
        <h2>法人籌碼警訊（外資 / 三大法人）</h2>
        <button type="button" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? '更新中...' : '立即更新'}
        </button>
      </div>
      <p className="subtle">
        {autoEnabled
          ? `自動追蹤中（每 ${autoIntervalMinutes} 分鐘）`
          : '自動追蹤已關閉，僅手動更新'}
        {lastUpdatedAt
          ? `，最近更新：${new Date(lastUpdatedAt).toLocaleTimeString('zh-TW')}`
          : ''}
      </p>

      {errorMessage && <p className="warning">{errorMessage}</p>}

      {rows.length === 0 ? (
        <p className="subtle">
          尚無可分析的台股代號。請在持股或觀察清單加入台股代號（如 2330）。
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>代號</th>
                <th>資料日</th>
                <th>外資買賣超</th>
                <th>外資標示</th>
                <th>三大法人買賣超</th>
                <th>法人標示</th>
                <th>警訊解讀</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.symbol}>
                  <td data-label="代號">{row.symbol}</td>
                  <td data-label="資料日">{row.tradeDate}</td>
                  <td data-label="外資買賣超">{formatLots(row.foreignNetLots)}</td>
                  <td data-label="外資標示">
                    <span className={`signal-badge ${getSignalClass(row.foreignSignal)}`}>
                      {getSignalText(row.foreignSignal)}
                    </span>
                  </td>
                  <td data-label="三大法人買賣超">
                    {formatLots(row.institutionalNetLots)}
                  </td>
                  <td data-label="法人標示">
                    <span
                      className={`signal-badge ${getSignalClass(row.institutionalSignal)}`}
                    >
                      {getSignalText(row.institutionalSignal)}
                    </span>
                  </td>
                  <td data-label="警訊解讀">{row.warningText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default InstitutionalSignalsSection
