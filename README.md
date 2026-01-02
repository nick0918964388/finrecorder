# FinRecorder

手機優先的股票買賣交易記錄與資產分析 Web APP

## 功能特色

- 記錄台股/美股買賣交易
- 自動抓取每日收盤價
- 自動換算匯率計算總資產
- 資產分析 (年化報酬率、波動率、夏普比率)
- Google 帳號登入
- 極簡風格 UI

## 快速開始

### 1. 安裝依賴

```bash
pnpm install
```

### 2. 設定環境變數

複製 `.env.example` 為 `.env` 並填入：

```env
DATABASE_URL=postgres://finrecorder:finrecorder123@localhost:5432/finrecorder
AUTH_SECRET=your-secret-key
AUTH_GOOGLE_ID=your-google-client-id
AUTH_GOOGLE_SECRET=your-google-client-secret
NEXTAUTH_URL=http://localhost:3000
```

### 3. 啟動資料庫

```bash
pnpm docker:up
```

### 4. 執行資料庫遷移

```bash
pnpm db:migrate
```

### 5. 啟動開發伺服器

```bash
pnpm dev
```

開啟 http://localhost:3000

## 技術棧

- Next.js 16 (App Router)
- TypeScript
- PostgreSQL + Drizzle ORM
- NextAuth.js v5
- Tailwind CSS + shadcn/ui
- Recharts

## 開發文檔

詳細的開發進度和規格請參閱 [DEVELOPMENT.md](./DEVELOPMENT.md)
