/**
 * 獲取單一股票的歷史價格
 * 執行方式: npx tsx scripts/fetch-stock-prices.ts <symbol>
 * 例如: npx tsx scripts/fetch-stock-prices.ts 00926
 */

import 'dotenv/config';
import yahooFinance from 'yahoo-finance2';
import { db } from '../src/db';
import { stocks, stockPrices } from '../src/db/schema';
import { eq, and } from 'drizzle-orm';

async function fetchPrices(symbol: string, year: number = 2025) {
  console.log(`Fetching prices for ${symbol} (${year})...\n`);

  // 找股票
  const stock = await db.query.stocks.findFirst({
    where: and(eq(stocks.symbol, symbol), eq(stocks.market, 'TW')),
  });

  if (!stock) {
    console.error(`Stock ${symbol} not found in database`);
    return;
  }

  const yahooSymbol = `${symbol}.TW`;

  try {
    const historical = await yahooFinance.chart(yahooSymbol, {
      period1: `${year}-01-01`,
      period2: `${year}-12-31`,
      interval: '1d',
    });

    if (!historical.quotes || historical.quotes.length === 0) {
      console.log('No price data returned');
      return;
    }

    console.log(`Got ${historical.quotes.length} price records`);

    let saved = 0;
    for (const quote of historical.quotes) {
      if (quote.date && quote.close) {
        const dateStr = new Date(quote.date).toISOString().split('T')[0];
        try {
          await db.insert(stockPrices).values({
            stockId: stock.id,
            date: dateStr,
            open: quote.open?.toString(),
            high: quote.high?.toString(),
            low: quote.low?.toString(),
            close: quote.close.toString(),
            volume: quote.volume?.toString(),
          }).onConflictDoNothing();
          saved++;
        } catch (e) {
          // ignore
        }
      }
    }

    console.log(`Saved ${saved} price records to database`);
  } catch (error) {
    console.error('Error:', error);
  }

  process.exit(0);
}

const symbol = process.argv[2];
if (!symbol) {
  console.log('Usage: npx tsx scripts/fetch-stock-prices.ts <symbol>');
  console.log('Example: npx tsx scripts/fetch-stock-prices.ts 00926');
  process.exit(1);
}

fetchPrices(symbol);
