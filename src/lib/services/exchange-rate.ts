import yahooFinance from 'yahoo-finance2';
import { db } from '@/db';
import { exchangeRates } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';

// ============ TYPES ============

export interface ExchangeRateData {
  fromCurrency: 'USD' | 'TWD';
  toCurrency: 'USD' | 'TWD';
  rate: number;
  date: string;
  source: string;
}

export interface FetchRateResult {
  success: boolean;
  data?: ExchangeRateData;
  error?: string;
}

// ============ EXCHANGE RATE APIS ============

/**
 * 從 Yahoo Finance 取得 USD/TWD 匯率
 * Yahoo 提供穩定且即時的匯率資料
 */
export async function fetchUSDToTWDFromYahoo(): Promise<FetchRateResult> {
  try {
    // Yahoo Finance 使用 "USDTWD=X" 格式
    const quote = await yahooFinance.quote('USDTWD=X');

    if (!quote || !quote.regularMarketPrice) {
      return { success: false, error: 'No rate data available' };
    }

    const marketTime = quote.regularMarketTime;
    const date = marketTime
      ? new Date(marketTime).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    return {
      success: true,
      data: {
        fromCurrency: 'USD',
        toCurrency: 'TWD',
        rate: quote.regularMarketPrice,
        date,
        source: 'Yahoo Finance',
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
 * 從 ExchangeRate-API 取得 USD/TWD 匯率 (免費公開 API)
 * https://open.er-api.com/v6/latest/USD
 */
export async function fetchUSDToTWDFromExchangeRateAPI(): Promise<FetchRateResult> {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD', {
      headers: {
        'User-Agent': 'FinRecorder/1.0',
      },
    });

    if (!response.ok) {
      return { success: false, error: `HTTP error: ${response.status}` };
    }

    const data = await response.json();

    if (data.result !== 'success' || !data.rates?.TWD) {
      return { success: false, error: 'Invalid response format' };
    }

    // 日期格式: "2024-01-15"
    const date = data.time_last_update_utc
      ? new Date(data.time_last_update_utc).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    return {
      success: true,
      data: {
        fromCurrency: 'USD',
        toCurrency: 'TWD',
        rate: data.rates.TWD,
        date,
        source: 'ExchangeRate-API',
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
 * 從台灣央行 API 取得匯率 (每日 16:00 後更新)
 * 這是官方匯率，但更新較慢
 */
export async function fetchUSDToTWDFromTaiwanCBC(): Promise<FetchRateResult> {
  try {
    // 台灣央行每日收盤匯率 API
    const response = await fetch(
      'https://www.cbc.gov.tw/tw/public/data/daily/2ER.json',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      }
    );

    if (!response.ok) {
      return { success: false, error: `HTTP error: ${response.status}` };
    }

    const data = await response.json();

    // 找到 USD 的匯率
    const usdRate = data.find((item: { 幣別: string }) => item['幣別'] === 'USD');

    if (!usdRate) {
      return { success: false, error: 'USD rate not found' };
    }

    // 銀行賣出匯率 (較接近市場匯率)
    const rate = parseFloat(usdRate['收盤匯率'] || usdRate['即期賣出']);

    if (isNaN(rate)) {
      return { success: false, error: 'Invalid rate value' };
    }

    return {
      success: true,
      data: {
        fromCurrency: 'USD',
        toCurrency: 'TWD',
        rate,
        date: new Date().toISOString().split('T')[0],
        source: 'Taiwan CBC',
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
 * 取得最新 USD/TWD 匯率 (嘗試多個來源)
 */
export async function fetchLatestUSDToTWD(): Promise<FetchRateResult> {
  // 優先使用 Yahoo Finance (最即時)
  let result = await fetchUSDToTWDFromYahoo();
  if (result.success) return result;

  // 備援: ExchangeRate-API
  result = await fetchUSDToTWDFromExchangeRateAPI();
  if (result.success) return result;

  // 最後備援: 台灣央行
  result = await fetchUSDToTWDFromTaiwanCBC();
  return result;
}

// ============ DATABASE OPERATIONS ============

/**
 * 儲存匯率到資料庫
 */
export async function saveExchangeRateToDB(rateData: ExchangeRateData): Promise<void> {
  await db.insert(exchangeRates).values({
    fromCurrency: rateData.fromCurrency,
    toCurrency: rateData.toCurrency,
    rate: rateData.rate.toString(),
    date: rateData.date,
  }).onConflictDoUpdate({
    target: [exchangeRates.fromCurrency, exchangeRates.toCurrency, exchangeRates.date],
    set: {
      rate: rateData.rate.toString(),
    },
  });
}

/**
 * 更新匯率並儲存到資料庫
 */
export async function updateExchangeRate(): Promise<{
  success: boolean;
  rate?: number;
  source?: string;
  error?: string;
}> {
  const result = await fetchLatestUSDToTWD();

  if (!result.success || !result.data) {
    return {
      success: false,
      error: result.error || 'Failed to fetch exchange rate',
    };
  }

  try {
    await saveExchangeRateToDB(result.data);

    // 同時儲存反向匯率 (TWD -> USD)
    await saveExchangeRateToDB({
      fromCurrency: 'TWD',
      toCurrency: 'USD',
      rate: 1 / result.data.rate,
      date: result.data.date,
      source: result.data.source,
    });

    return {
      success: true,
      rate: result.data.rate,
      source: result.data.source,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database error',
    };
  }
}

/**
 * 從資料庫取得最新 USD/TWD 匯率
 */
export async function getLatestUSDToTWDRate(): Promise<number | null> {
  const latestRate = await db.query.exchangeRates.findFirst({
    where: and(
      eq(exchangeRates.fromCurrency, 'USD'),
      eq(exchangeRates.toCurrency, 'TWD')
    ),
    orderBy: [desc(exchangeRates.date)],
  });

  return latestRate ? parseFloat(latestRate.rate) : null;
}

/**
 * 從資料庫取得指定日期的 USD/TWD 匯率
 */
export async function getUSDToTWDRateByDate(date: string): Promise<number | null> {
  const rate = await db.query.exchangeRates.findFirst({
    where: and(
      eq(exchangeRates.fromCurrency, 'USD'),
      eq(exchangeRates.toCurrency, 'TWD'),
      eq(exchangeRates.date, date)
    ),
  });

  return rate ? parseFloat(rate.rate) : null;
}

/**
 * 取得匯率 (優先從資料庫，如果沒有則從 API 取得)
 */
export async function getUSDToTWDRate(): Promise<number> {
  // 先嘗試從資料庫取得今天的匯率
  const today = new Date().toISOString().split('T')[0];
  let rate = await getUSDToTWDRateByDate(today);

  if (rate) return rate;

  // 沒有今天的匯率，嘗試從 API 取得
  const result = await updateExchangeRate();
  if (result.success && result.rate) {
    return result.rate;
  }

  // 使用資料庫中最新的匯率
  rate = await getLatestUSDToTWDRate();
  if (rate) return rate;

  // 如果都沒有，使用預設匯率
  console.warn('No exchange rate available, using default rate 32.0');
  return 32.0;
}

/**
 * 轉換金額
 */
export async function convertCurrency(
  amount: number,
  from: 'USD' | 'TWD',
  to: 'USD' | 'TWD'
): Promise<number> {
  if (from === to) return amount;

  const usdToTwd = await getUSDToTWDRate();

  if (from === 'USD' && to === 'TWD') {
    return amount * usdToTwd;
  } else {
    return amount / usdToTwd;
  }
}
