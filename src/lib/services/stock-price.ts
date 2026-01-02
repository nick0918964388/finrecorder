import yahooFinance from 'yahoo-finance2';
import { db } from '@/db';
import { stocks, stockPrices, type Stock } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

// ============ TYPES ============

export interface StockQuote {
  symbol: string;
  market: 'TW' | 'US';
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
  name?: string;
}

export interface FetchResult {
  success: boolean;
  data?: StockQuote;
  error?: string;
}

// ============ TWSE API (台股) ============

const TWSE_API_BASE = 'https://www.twse.com.tw/exchangeReport';

/**
 * 從 TWSE API 取得單一台股的收盤價
 * @param symbol 股票代號 (例如: "2330")
 * @param date 日期 (格式: YYYYMMDD)
 */
export async function fetchTWSEStockPrice(symbol: string, date?: string): Promise<FetchResult> {
  try {
    // 如果沒有指定日期，使用今天的日期
    const targetDate = date || formatTWSEDate(new Date());

    // TWSE API: 個股日成交資訊
    const url = `${TWSE_API_BASE}/STOCK_DAY?response=json&date=${targetDate}&stockNo=${symbol}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      return { success: false, error: `HTTP error: ${response.status}` };
    }

    const data = await response.json();

    if (data.stat !== 'OK' || !data.data || data.data.length === 0) {
      return { success: false, error: 'No data available' };
    }

    // 取得最後一筆資料 (最新日期)
    const lastRow = data.data[data.data.length - 1];
    // TWSE 日期格式: 114/01/02 (民國年)
    const [rocYear, month, day] = lastRow[0].split('/');
    const year = parseInt(rocYear) + 1911;
    const isoDate = `${year}-${month}-${day}`;

    // 解析價格 (移除逗號)
    const parsePrice = (str: string) => parseFloat(str.replace(/,/g, ''));

    return {
      success: true,
      data: {
        symbol,
        market: 'TW',
        date: isoDate,
        open: parsePrice(lastRow[3]),
        high: parsePrice(lastRow[4]),
        low: parsePrice(lastRow[5]),
        close: parsePrice(lastRow[6]),
        volume: parsePrice(lastRow[1]),
        name: data.title?.split(' ')[2], // 從標題取得股票名稱
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 從 TWSE 取得多檔台股的即時價格
 * 使用 TWSE 盤後資訊 API
 */
export async function fetchTWSEMultipleStockPrices(symbols: string[]): Promise<Map<string, FetchResult>> {
  const results = new Map<string, FetchResult>();

  try {
    // 使用 TWSE 每日收盤行情 API
    const today = formatTWSEDate(new Date());
    const url = `${TWSE_API_BASE}/MI_INDEX?response=json&date=${today}&type=ALLBUT0999`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      symbols.forEach(symbol => {
        results.set(symbol, { success: false, error: `HTTP error: ${response.status}` });
      });
      return results;
    }

    const data = await response.json();

    if (data.stat !== 'OK') {
      // 可能是假日，沒有資料
      symbols.forEach(symbol => {
        results.set(symbol, { success: false, error: 'No trading data (possibly a holiday)' });
      });
      return results;
    }

    // 解析日期
    const [rocYear, month, day] = (data.date as string).split('/');
    const year = parseInt(rocYear) + 1911;
    const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

    // 建立股票代號對應表
    const stockMap = new Map<string, StockQuote>();

    // data9 是上市股票的資料
    if (data.data9) {
      for (const row of data.data9) {
        const stockSymbol = row[0]; // 證券代號
        const stockName = row[1]; // 證券名稱

        const parsePrice = (str: string) => {
          if (!str || str === '--') return undefined;
          return parseFloat(str.replace(/,/g, ''));
        };

        const close = parsePrice(row[8]); // 收盤價
        if (close !== undefined) {
          stockMap.set(stockSymbol, {
            symbol: stockSymbol,
            market: 'TW',
            date: isoDate,
            open: parsePrice(row[5]),
            high: parsePrice(row[6]),
            low: parsePrice(row[7]),
            close,
            volume: parsePrice(row[2]),
            name: stockName,
          });
        }
      }
    }

    // 填入結果
    for (const symbol of symbols) {
      const quote = stockMap.get(symbol);
      if (quote) {
        results.set(symbol, { success: true, data: quote });
      } else {
        results.set(symbol, { success: false, error: 'Stock not found' });
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    symbols.forEach(symbol => {
      results.set(symbol, { success: false, error: errorMsg });
    });
  }

  return results;
}

// ============ YAHOO FINANCE (美股) ============

/**
 * 從 Yahoo Finance 取得美股收盤價
 * @param symbol 股票代號 (例如: "AAPL", "TSLA")
 */
export async function fetchUSStockPrice(symbol: string): Promise<FetchResult> {
  try {
    const quote = await yahooFinance.quote(symbol);

    if (!quote || !quote.regularMarketPrice) {
      return { success: false, error: 'No quote data available' };
    }

    // 取得最近交易日
    const marketTime = quote.regularMarketTime;
    const date = marketTime
      ? new Date(marketTime).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    return {
      success: true,
      data: {
        symbol,
        market: 'US',
        date,
        open: quote.regularMarketOpen,
        high: quote.regularMarketDayHigh,
        low: quote.regularMarketDayLow,
        close: quote.regularMarketPrice,
        volume: quote.regularMarketVolume,
        name: quote.shortName || quote.longName,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 從 Yahoo Finance 取得多檔美股收盤價
 */
export async function fetchUSMultipleStockPrices(symbols: string[]): Promise<Map<string, FetchResult>> {
  const results = new Map<string, FetchResult>();

  try {
    const quotes = await yahooFinance.quote(symbols);
    const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

    for (const quote of quotesArray) {
      if (!quote || !quote.symbol) continue;

      if (quote.regularMarketPrice) {
        const marketTime = quote.regularMarketTime;
        const date = marketTime
          ? new Date(marketTime).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0];

        results.set(quote.symbol, {
          success: true,
          data: {
            symbol: quote.symbol,
            market: 'US',
            date,
            open: quote.regularMarketOpen,
            high: quote.regularMarketDayHigh,
            low: quote.regularMarketDayLow,
            close: quote.regularMarketPrice,
            volume: quote.regularMarketVolume,
            name: quote.shortName || quote.longName,
          },
        });
      } else {
        results.set(quote.symbol, { success: false, error: 'No price data' });
      }
    }

    // 標記未找到的股票
    for (const symbol of symbols) {
      if (!results.has(symbol)) {
        results.set(symbol, { success: false, error: 'Quote not returned' });
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    symbols.forEach(symbol => {
      if (!results.has(symbol)) {
        results.set(symbol, { success: false, error: errorMsg });
      }
    });
  }

  return results;
}

/**
 * 為台股代號添加 .TW 後綴以用於 Yahoo Finance
 */
export function toYahooTWSymbol(symbol: string): string {
  return `${symbol}.TW`;
}

/**
 * 從 Yahoo Finance 取得台股收盤價 (備援方案)
 */
export async function fetchTWStockPriceFromYahoo(symbol: string): Promise<FetchResult> {
  const yahooSymbol = toYahooTWSymbol(symbol);
  const result = await fetchUSStockPrice(yahooSymbol);

  if (result.success && result.data) {
    // 修正市場標記
    result.data.symbol = symbol;
    result.data.market = 'TW';
  }

  return result;
}

// ============ DATABASE OPERATIONS ============

/**
 * 更新資料庫中的股價
 */
export async function updateStockPriceInDB(quote: StockQuote): Promise<void> {
  // 先查找或創建股票記錄
  let stock = await db.query.stocks.findFirst({
    where: and(
      eq(stocks.symbol, quote.symbol),
      eq(stocks.market, quote.market)
    ),
  });

  if (!stock) {
    const [newStock] = await db.insert(stocks).values({
      symbol: quote.symbol,
      market: quote.market,
      name: quote.name,
      nameTw: quote.market === 'TW' ? quote.name : undefined,
    }).returning();
    stock = newStock;
  }

  // 插入或更新股價 (使用 upsert)
  await db.insert(stockPrices).values({
    stockId: stock.id,
    date: quote.date,
    open: quote.open?.toString(),
    high: quote.high?.toString(),
    low: quote.low?.toString(),
    close: quote.close.toString(),
    volume: quote.volume?.toString(),
    adjustedClose: quote.close.toString(),
  }).onConflictDoUpdate({
    target: [stockPrices.stockId, stockPrices.date],
    set: {
      open: quote.open?.toString(),
      high: quote.high?.toString(),
      low: quote.low?.toString(),
      close: quote.close.toString(),
      volume: quote.volume?.toString(),
      adjustedClose: quote.close.toString(),
    },
  });
}

/**
 * 批量更新股價
 */
export async function updateMultipleStockPricesInDB(quotes: StockQuote[]): Promise<{
  success: number;
  failed: number;
  errors: string[];
}> {
  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const quote of quotes) {
    try {
      await updateStockPriceInDB(quote);
      success++;
    } catch (error) {
      failed++;
      errors.push(`${quote.symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return { success, failed, errors };
}

/**
 * 取得使用者持有的所有股票並更新其價格
 */
export async function updateAllUserStockPrices(): Promise<{
  twUpdated: number;
  usUpdated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let twUpdated = 0;
  let usUpdated = 0;

  // 取得所有有持倉的股票
  const allStocks = await db.query.stocks.findMany({
    where: eq(stocks.isActive, true),
  });

  const twStocks = allStocks.filter(s => s.market === 'TW');
  const usStocks = allStocks.filter(s => s.market === 'US');

  // 更新台股
  if (twStocks.length > 0) {
    const twSymbols = twStocks.map(s => s.symbol);
    const twResults = await fetchTWSEMultipleStockPrices(twSymbols);

    for (const [symbol, result] of twResults) {
      if (result.success && result.data) {
        try {
          await updateStockPriceInDB(result.data);
          twUpdated++;
        } catch (error) {
          errors.push(`TW:${symbol} - DB error: ${error instanceof Error ? error.message : 'Unknown'}`);
        }
      } else {
        // 嘗試使用 Yahoo Finance 作為備援
        const yahooResult = await fetchTWStockPriceFromYahoo(symbol);
        if (yahooResult.success && yahooResult.data) {
          try {
            await updateStockPriceInDB(yahooResult.data);
            twUpdated++;
          } catch (error) {
            errors.push(`TW:${symbol} - ${result.error}`);
          }
        } else {
          errors.push(`TW:${symbol} - ${result.error}`);
        }
      }
    }
  }

  // 更新美股
  if (usStocks.length > 0) {
    const usSymbols = usStocks.map(s => s.symbol);
    const usResults = await fetchUSMultipleStockPrices(usSymbols);

    for (const [symbol, result] of usResults) {
      if (result.success && result.data) {
        try {
          await updateStockPriceInDB(result.data);
          usUpdated++;
        } catch (error) {
          errors.push(`US:${symbol} - DB error: ${error instanceof Error ? error.message : 'Unknown'}`);
        }
      } else {
        errors.push(`US:${symbol} - ${result.error}`);
      }
    }
  }

  return { twUpdated, usUpdated, errors };
}

// ============ HELPERS ============

/**
 * 格式化日期為 TWSE API 格式 (YYYYMMDD)
 */
function formatTWSEDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * 取得股票的最新收盤價
 */
export async function getLatestStockPrice(stockId: string): Promise<number | null> {
  const latestPrice = await db.query.stockPrices.findFirst({
    where: eq(stockPrices.stockId, stockId),
    orderBy: (stockPrices, { desc }) => [desc(stockPrices.date)],
  });

  return latestPrice ? parseFloat(latestPrice.close) : null;
}

/**
 * 搜尋股票 (用於自動完成)
 */
export async function searchStocks(query: string, market?: 'TW' | 'US'): Promise<Stock[]> {
  // 先從資料庫搜尋
  const conditions = [];
  if (market) {
    conditions.push(eq(stocks.market, market));
  }

  const results = await db.query.stocks.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    limit: 20,
  });

  // 過濾符合查詢的結果
  const lowerQuery = query.toLowerCase();
  return results.filter(stock =>
    stock.symbol.toLowerCase().includes(lowerQuery) ||
    stock.name?.toLowerCase().includes(lowerQuery) ||
    stock.nameTw?.toLowerCase().includes(lowerQuery)
  );
}
