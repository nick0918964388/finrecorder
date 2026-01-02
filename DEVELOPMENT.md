# FinRecorder - 股票交易記錄 APP 開發文檔

## 專案概述

手機優先的極簡風格股票交易記錄 Web APP，支援台股+美股，自動抓取收盤價並提供資產分析功能。

## 技術棧

| 類別 | 技術 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 16.1.1 |
| 語言 | TypeScript | 5.x |
| 資料庫 | PostgreSQL | 16 |
| ORM | Drizzle ORM | 0.45.x |
| 認證 | NextAuth.js | v5 beta |
| UI | shadcn/ui + Tailwind CSS | v4 |
| 圖表 | Recharts | 3.x |
| 狀態管理 | TanStack Query + Zustand | - |
| 驗證 | Zod | - |
| 容器 | Docker Compose | - |

---

## 功能需求

### 核心功能
- [x] Google 帳號登入
- [x] 交易記錄 CRUD (買入/賣出、股數、價格、手續費)
- [x] 持倉計算與總覽
- [x] 每日自動抓取收盤價 (台股+美股)
- [x] 自動抓取 USD/TWD 匯率換算總資產
- [x] 資產分析 (CAGR、波動率、夏普比率、最大回撤)
- [x] Recharts 圖表視覺化
- [x] 個人化設定 (預設市場、手續費率)
- [x] 手機優先極簡 UI (底部導航)

### 數據來源
| 市場 | 主要來源 | 備援 |
|------|----------|------|
| 台股 | TWSE OpenAPI | Yahoo Finance TW |
| 美股 | yahoo-finance2 | Alpha Vantage |
| 匯率 | 台灣央行 API / ExchangeRate-API | Yahoo Finance |

### 定時任務排程
- 台股：每日 14:30 (收盤後)
- 美股：每日 05:00 台北時間 (美股收盤後)
- 匯率：每日 10:00 + 16:00
- 淨值快照：每日 22:00

---

## 專案結構

```
finrecorder/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx        # 登入頁面
│   │   │   └── layout.tsx
│   │   ├── (main)/
│   │   │   ├── dashboard/page.tsx    # 儀表板
│   │   │   ├── transactions/
│   │   │   │   ├── page.tsx          # 交易列表
│   │   │   │   └── new/page.tsx      # 新增交易
│   │   │   ├── portfolio/page.tsx    # 持倉總覽
│   │   │   ├── analytics/page.tsx    # 資產分析
│   │   │   ├── settings/page.tsx     # 個人設定
│   │   │   └── layout.tsx            # 主佈局 (含認證檢查)
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   ├── transactions/route.ts
│   │   │   ├── portfolio/route.ts
│   │   │   ├── settings/route.ts
│   │   │   └── cron/
│   │   │       ├── update-prices/route.ts
│   │   │       ├── update-rates/route.ts
│   │   │       └── snapshot-values/route.ts
│   │   ├── layout.tsx
│   │   ├── page.tsx                  # 首頁重定向
│   │   └── globals.css
│   │
│   ├── components/
│   │   ├── ui/                       # shadcn/ui 組件
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── input.tsx
│   │   │   ├── select.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── table.tsx
│   │   │   ├── form.tsx
│   │   │   ├── label.tsx
│   │   │   ├── badge.tsx
│   │   │   └── sheet.tsx
│   │   └── layout/
│   │       ├── header.tsx            # 頂部導航
│   │       └── bottom-nav.tsx        # 手機底部導航
│   │
│   ├── db/
│   │   ├── schema.ts                 # Drizzle Schema 定義
│   │   ├── index.ts                  # DB 連線
│   │   └── migrations/               # 資料庫遷移檔案
│   │
│   ├── lib/
│   │   ├── auth.ts                   # NextAuth 配置
│   │   ├── utils.ts                  # 工具函式
│   │   ├── validators.ts             # Zod 驗證 Schema
│   │   ├── services/                 # 業務邏輯服務
│   │   │   ├── stock-price.ts        # 股價服務 (TWSE + Yahoo)
│   │   │   ├── exchange-rate.ts      # 匯率服務
│   │   │   ├── net-value.ts          # 淨值計算服務
│   │   │   └── index.ts              # 服務索引
│   │   └── cron/
│   │       └── scheduler.ts          # 定時任務調度器
│   │
│   ├── providers/
│   │   └── session-provider.tsx      # NextAuth SessionProvider
│   │
│   └── types/
│       └── next-auth.d.ts            # NextAuth 類型擴展
│
├── drizzle.config.ts
├── docker-compose.yml
├── .env
├── .env.example
└── package.json
```

---

## 資料庫 Schema

### 表格清單

| 表格 | 用途 |
|------|------|
| `users` | 用戶資料 (NextAuth) |
| `accounts` | OAuth 帳戶 |
| `sessions` | 登入 Session |
| `verification_tokens` | 驗證 Token |
| `user_preferences` | 用戶偏好設定 |
| `stocks` | 股票基本資料 |
| `stock_prices` | 每日收盤價 |
| `transactions` | 買賣交易記錄 |
| `holdings` | 持倉快照 |
| `daily_net_values` | 每日淨值快照 |
| `exchange_rates` | 匯率記錄 |

### Schema 位置
`src/db/schema.ts`

---

## 開發進度

### Phase 1: 基礎架構 ✅ 已完成
- [x] 建立 Next.js 專案 + TypeScript + Tailwind
- [x] 設定 PostgreSQL + Drizzle ORM
- [x] 建立資料庫 Schema 並執行 migration
- [x] 整合 NextAuth.js v5 + Google OAuth
- [x] 安裝 shadcn/ui 基礎組件
- [x] 建立頁面結構 (dashboard, transactions, portfolio, analytics, settings)
- [x] 建立 Header + BottomNav 佈局組件
- [x] 建立交易記錄 API (GET/POST)
- [x] 驗證專案編譯成功

### Phase 2: 核心功能 ✅ 已完成
- [x] 實作交易列表頁面 (從 API 讀取資料)
- [x] 建立 QueryProvider (TanStack Query)
- [x] 實作持倉計算邏輯
- [x] 建立持倉總覽頁面 (顯示實際持倉)
- [x] 建立持倉 API (/api/portfolio)
- [x] 實作設定頁面儲存功能
- [x] 建立設定 API (/api/settings)

### Phase 3: 股價更新 ✅ 已完成
- [x] 實作 TWSE API 整合 (台股)
- [x] 實作 yahoo-finance2 整合 (美股)
- [x] 實作匯率 API 整合 (Yahoo Finance / ExchangeRate-API / 台灣央行)
- [x] 建立定時任務調度器 (node-cron)
- [x] 實作每日淨值快照功能
- [x] 建立 Cron API 端點 (update-prices, update-rates, snapshot-values)

### Phase 4: 分析與圖表 ✅ 已完成
- [x] 實作績效指標計算 (CAGR, 波動率, 夏普比率, 最大回撤)
- [x] 建立資產分析頁面 (顯示實際數據)
- [x] 整合 Recharts 圖表 (資產趨勢、持倉分布、日報酬)
- [x] 建立分析 API (/api/analytics)

### Phase 5: 優化與部署 ✅ 已完成
- [x] 手機端 UI 優化 (Dashboard 真實數據、觸控優化)
- [x] 極簡風格調整 (底部導航、safe-area 支援)
- [x] Docker 容器化 (App + Cron)
- [x] docker-compose 完整配置
- [x] 健康檢查 API (/api/health)
- [x] 生產環境配置檔

---

## 環境設定

### 環境變數 (.env)

```env
# Database
DATABASE_URL=postgres://finrecorder:finrecorder123@localhost:5432/finrecorder

# NextAuth.js
AUTH_SECRET=dev-secret-change-in-production
AUTH_GOOGLE_ID=your-google-client-id
AUTH_GOOGLE_SECRET=your-google-client-secret
NEXTAUTH_URL=http://localhost:3000

# Optional
ALPHA_VANTAGE_API_KEY=your-api-key
```

### Google OAuth 設定步驟

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立新專案或選擇現有專案
3. 啟用 Google+ API
4. 建立 OAuth 2.0 憑證
5. 設定授權重定向 URI: `http://localhost:3000/api/auth/callback/google`
6. 複製 Client ID 和 Client Secret 到 `.env`

---

## 常用指令

```bash
# 安裝依賴
pnpm install

# 啟動 PostgreSQL
pnpm docker:up

# 停止 PostgreSQL
pnpm docker:down

# 資料庫操作
pnpm db:generate    # 生成 migration
pnpm db:migrate     # 執行 migration
pnpm db:push        # 強制同步 schema
pnpm db:studio      # 開啟 Drizzle Studio

# 開發
pnpm dev            # 開發模式
pnpm build          # 建置
pnpm start          # 生產模式
pnpm lint           # ESLint 檢查

# 定時任務
pnpm cron           # 啟動定時任務調度器
pnpm cron:run       # 手動執行所有任務 (測試用)
```

---

## API 端點

### 已實作

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/transactions` | 取得交易記錄列表 |
| POST | `/api/transactions` | 新增交易記錄 |
| GET | `/api/portfolio` | 取得持倉總覽 (含持倉明細、市值、損益) |
| GET | `/api/settings` | 取得用戶設定 |
| PUT | `/api/settings` | 更新用戶設定 |
| POST | `/api/cron/update-prices` | 更新股價 (台股+美股) |
| POST | `/api/cron/update-rates` | 更新匯率 (USD/TWD) |
| POST | `/api/cron/snapshot-values` | 建立每日淨值快照 |
| GET | `/api/analytics` | 取得績效分析 (指標、配置、歷史) |

### 待實作

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/transactions/[id]` | 取得單筆交易 |
| PUT | `/api/transactions/[id]` | 更新交易 |
| DELETE | `/api/transactions/[id]` | 刪除交易 |
| GET | `/api/prices/search` | 搜尋股票 |

---

## 資產分析指標公式

### 年化報酬率 (CAGR)
```
CAGR = (終值 / 初值)^(1/年數) - 1
```

### 波動率
```
年化波動率 = 日報酬標準差 × √252
```

### 夏普比率
```
Sharpe Ratio = (報酬率 - 無風險利率) / 波動率
```

### 最大回撤
```
Max Drawdown = (峰值 - 谷值) / 峰值
```

---

## 專案完成

**當前狀態**: 所有 Phase 已完成！專案已可部署使用。

**已完成功能**:
- Google OAuth 登入
- 交易記錄 CRUD (新增交易會自動更新持倉)
- 持倉總覽 (顯示持倉明細、市值、未實現損益)
- 用戶設定 (預設市場、貨幣、手續費率)
- 台股收盤價自動抓取 (TWSE API + Yahoo Finance 備援)
- 美股收盤價自動抓取 (yahoo-finance2)
- USD/TWD 匯率自動抓取 (多來源: Yahoo/ExchangeRate-API/央行)
- 每日淨值快照
- 定時任務調度器
- 績效指標計算 (CAGR, 波動率, 夏普比率, 最大回撤, 勝率)
- Recharts 圖表 (資產趨勢、持倉分布圓餅圖、日報酬)
- Dashboard 即時數據顯示
- 手機端優化 UI (safe-area, 觸控優化)
- Docker 容器化部署

**重要檔案**:
- `src/db/schema.ts` - 資料庫結構
- `src/lib/auth.ts` - 認證配置
- `src/lib/services/` - 業務邏輯服務
- `src/lib/cron/scheduler.ts` - 定時任務調度器
- `src/app/api/` - API 端點
- `src/app/(main)/` - 主要頁面
- `Dockerfile` - Next.js 應用容器
- `Dockerfile.cron` - Cron 服務容器
- `docker-compose.yml` - 生產環境配置

---

## Docker 部署

### 開發環境 (僅資料庫)
```bash
# 啟動 PostgreSQL
pnpm docker:up

# 停止
pnpm docker:down
```

### 生產環境 (完整部署)
```bash
# 1. 複製環境變數
cp .env.example .env

# 2. 編輯 .env 填入實際值
#    - AUTH_SECRET (openssl rand -base64 32)
#    - AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET
#    - CRON_SECRET (openssl rand -base64 32)

# 3. 建置映像
pnpm docker:build

# 4. 啟動所有服務
pnpm docker:prod

# 5. 查看日誌
pnpm docker:logs

# 6. 停止服務
pnpm docker:prod:down
```

### 服務架構
```
┌─────────────────────────────────────────────────┐
│                   Docker Network                │
├─────────────┬─────────────┬─────────────────────┤
│   postgres  │     app     │        cron         │
│  (資料庫)   │ (Next.js)   │   (定時任務)         │
│  Port 5432  │  Port 3000  │                     │
└─────────────┴─────────────┴─────────────────────┘
```

### 定時任務排程 (台北時間)
- 台股收盤價: 每日 14:30 (週一至週五)
- 美股收盤價: 每日 05:00 (週二至週六)
- 匯率更新: 每日 10:00 + 16:00
- 淨值快照: 每日 22:00

### 手動觸發任務
```bash
# 更新股價
curl -X POST http://localhost:3000/api/cron/update-prices

# 更新匯率
curl -X POST http://localhost:3000/api/cron/update-rates

# 建立淨值快照
curl -X POST http://localhost:3000/api/cron/snapshot-values

# 健康檢查
curl http://localhost:3000/api/health
```
