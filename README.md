# 股票損益 Web App（Firebase + 即時股價 API）

這是一個 React + TypeScript 的股票買賣紀錄系統，支援：

- 新增/刪除買進與賣出交易
- 透過 Firebase Firestore 儲存交易資料
- 透過網路 API 抓即時股價（Yahoo Finance，必要時可加 Alpha Vantage）
- 即時計算已實現/未實現/總損益
- 計算整體收益率（含累計買進成本、累計賣出回收）
- 持股報價自動追蹤（可設定更新秒數，不需手動更新）
- 損益計算包含手續費、最低手續費、賣出證交稅
- 短線資金紀律（固定本金 20,000、獲利建議贖回、虧損不補錢）
- 停損建議（可調停損幅度，支援零股/碎股）
- 建議股票資訊區（自動掃描市場熱門股，近 10 交易日連漲/連跌 + MA5/MA10 + RSI14 + 建議原因）
- 分頁簡化：短期買賣 / 長期持有 / 系統設定（短期判斷基準集中於設定頁）
- 外資/三大法人大量買賣標示與警訊解讀（台股）
- 長期持有標籤頁（獨立記錄長期配置標的）
- 長期持有賣出/轉投資警訊（停損、獲利目標、法人訊號）

## 1) 安裝與啟動

```bash
npm install
cp .env.example .env
npm run dev
```

## 2) 設定 Firebase

請到 Firebase Console 建立專案，啟用 Firestore，然後把 Web App 設定填到 `.env`：

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
```

> 若未設定 Firebase，系統會自動退回用瀏覽器 `LocalStorage` 暫存資料。

### 白名單登入（可選）

```env
VITE_ENABLE_AUTH_WHITELIST=false
VITE_AUTH_WHITELIST_EMAILS=y.chengju@gmail.com
```

- 已預設白名單帳號為 `y.chengju@gmail.com`
- 本地測試預設 `false`（不啟用白名單登入）
- 正式環境可改為 `true`，啟用 Google 登入 + 白名單限制

## 3) 設定股價 API（可選）

預設會直接由前端連到 Yahoo Finance 取得報價。  
若你也想加 Alpha Vantage 當備援，可在 `.env` 加上：

```env
VITE_ALPHA_VANTAGE_API_KEY=
```

## 4) Firestore 規則與索引

先用開發規則測試，正式上線前請改成有登入驗證版本：

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /trades/{tradeId} {
      allow read, write: if true;
    }
  }
}
```

目前專案查詢已調整為單一排序，不需要額外建立複合索引。

## 5) 損益計算邏輯

- 買進成本 = `成交金額 + 手續費`
- 賣出收入 = `成交金額 - 手續費 - 證交稅`
- 已實現損益：使用加權平均成本法（Average Cost）
- 未實現損益：以最新價估算賣出後可回收金額（已扣手續費/稅）再減掉持有成本
- 整體收益率 = `總損益 / 累計買進成本`

## 6) T+2 交割警訊

- 交割規則：台股採 `T+2`（成交後第 2 個營業日交割）
- 系統會顯示近 2 個營業日：
  - 應付交割款（買進）
  - 應收交割款（賣出）
  - 淨現金衝擊（應收 - 應付）
- 警訊意義：
  - `高風險`：應付交割款過高，需防違約交割
  - `注意`：淨流出偏大，需提前備資金
  - `一般`：短期交割壓力可控

## 7) 建議股票資訊邏輯

- 候選池來源：TWSE 每日收盤行情（成交金額前段標的）+ 目前持股
- 歷史資料來源：Yahoo 近 3 個月日線資料
- 排行條件：近 10 個交易日「目前連續上漲/下跌」至少 2 天（動態更新，不鎖定固定股票）
- 指標：`MA5`、`MA10`、`RSI14`
- 每檔都會列出「建議原因」（連續漲跌、均線排列、RSI 區間、近 10 日漲跌幅）
- 建議區間：
  - `順勢回檔布局`：價格站上 MA5 且 MA5 > MA10，建議區間落在 MA5 附近
  - `強勢但偏熱`：連漲天數過長，建議等待回檔到 MA10~MA5 再評估
  - `弱勢反彈觀察`：空方排列時以觀察為主，不建議積極追價
- 聲明：僅作技術分析輔助，不構成投資建議

## 8) 法人籌碼警訊邏輯（台股）

- 資料來源：TWSE 法人買賣超（T86）
- 判斷邏輯（門檻依追蹤名單自動套用常態值）：
  - 外資買賣超 >= 門檻：標示 `大量買入`
  - 外資買賣超 <= -門檻：標示 `大量賣出`
  - 三大法人買賣超同理
  - 系統會依追蹤台股檔數與 ETF 比例，自動調整外資/三大法人門檻
- 警訊解讀：
  - 外資/法人同向大量買入：市場共識轉強，但仍需防追高回檔
  - 外資/法人同向大量賣出：籌碼轉弱警訊，短線易承壓
  - 僅一方大量買賣：代表籌碼分歧，建議搭配均線與量價確認

## 9) 介面區域

- `短期買賣`：交易紀錄、損益、停損、T+2、法人警訊與建議股票資訊
- `長期持有`：長期標的明細、賣出/轉投資建議與所有長期判斷基準（同頁可調）
- `系統設定`：白名單登入、短期判斷基準與系統層級資訊
- `系統設定` 的法人觀察補充清單為選填，只影響法人警訊範圍，不會限制建議股票來源
- 短線策略：本金上限固定 20,000，表單允許最小 0.001 股交易，買進會檢查可用買進上限
- 預設追蹤頻率：股價 120 秒一次、法人資料 30 分鐘一次（偏保守，降低限流風險）

## 10) 常用指令

```bash
npm run dev
npm run server
npm run dev:all
npm run build
npm run preview
```
