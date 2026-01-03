/**
 * 從 TWSE 獲取台股歷史價格
 * 執行方式: npx tsx scripts/fetch-twse-prices.ts <symbol> <year> <month>
 * 例如: npx tsx scripts/fetch-twse-prices.ts 00926 2025 1
 */

import 'dotenv/config';
import { db } from '../src/db';
import { stocks, stockPrices } from '../src/db/schema';
import { eq, and } from 'drizzle-orm';

interface TWSEResponse {
  stat: string;
  date: string;
  title: string;
  data?: string[][];
}

async function fetchTWSEMonthlyPrices(symbol: string, year: number, month: number): Promise<number> {
  const dateStr = `${year}${month.toString().padStart(2, '0')}01`;
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${dateStr}&stockNo=${symbol}`;

  console.log(`  Fetching ${year}/${month}...`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!response.ok) {
    console.log(`    HTTP error: ${response.status}`);
    return 0;
  }

  const data: TWSEResponse = await response.json();

  if (data.stat !== 'OK' || !data.data || data.data.length === 0) {
    console.log(`    No data available`);
    return 0;
  }

  // 找股票
  const stock = await db.query.stocks.findFirst({
    where: and(eq(stocks.symbol, symbol), eq(stocks.market, 'TW')),
  });

  if (!stock) {
    console.log(`    Stock ${symbol} not found in database`);
    return 0;
  }

  let saved = 0;
  for (const row of data.data) {
    // TWSE 日期格式: 114/01/02 (民國年)
    const [rocYear, m, d] = row[0].split('/');
    const fullYear = parseInt(rocYear) + 1911;
    const isoDate = `${fullYear}-${m}-${d}`;

    const parsePrice = (str: string) => {
      const cleaned = str.replace(/,/g, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : num;
    };

    const open = parsePrice(row[3]);
    const high = parsePrice(row[4]);
    const low = parsePrice(row[5]);
    const close = parsePrice(row[6]);
    const volume = parsePrice(row[1]);

    if (close !== null) {
      try {
        await db.insert(stockPrices).values({
          stockId: stock.id,
          date: isoDate,
          open: open?.toString(),
          high: high?.toString(),
          low: low?.toString(),
          close: close.toString(),
          volume: volume?.toString(),
        }).onConflictDoNothing();
        saved++;
      } catch (e) {
        // ignore
      }
    }
  }

  console.log(`    Saved ${saved} records`);
  return saved;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchFullYear(symbol: string, year: number) {
  console.log(`\nFetching ${symbol} prices for ${year}...\n`);

  let totalSaved = 0;

  for (let month = 1; month <= 12; month++) {
    const saved = await fetchTWSEMonthlyPrices(symbol, year, month);
    totalSaved += saved;
    await delay(3000); // 每個月間隔 3 秒
  }

  console.log(`\nTotal saved: ${totalSaved} records`);
}

// 主程式
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: npx tsx scripts/fetch-twse-prices.ts <symbol> [year]');
  console.log('Example: npx tsx scripts/fetch-twse-prices.ts 00926 2025');
  process.exit(1);
}

const symbol = args[0];
const year = args[1] ? parseInt(args[1]) : 2025;

fetchFullYear(symbol, year).then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
