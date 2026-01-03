/**
 * 回溯建立 2025 年淨值快照的腳本
 * 執行方式: npx tsx scripts/backfill-2025.ts
 */

import 'dotenv/config';
import yahooFinance from 'yahoo-finance2';
import { db } from '../src/db';
import { transactions, stocks, stockPrices, dailyNetValues, users, holdings } from '../src/db/schema';
import { eq, and, asc, sql, desc } from 'drizzle-orm';

interface DailyHolding {
  stockId: string;
  symbol: string;
  market: 'TW' | 'US';
  quantity: number;
  totalCost: number;
}

async function getUSDToTWDRate(): Promise<number> {
  // 使用固定匯率或從 API 取得
  return 32.5; // 預設匯率
}

// 延遲函數，避免 API 請求過快
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function backfillYear(userId: string, year: number) {
  console.log(`\n=== Starting backfill for user ${userId}, year ${year} ===\n`);

  // Step 1: 取得該年度所有交易
  const yearTransactions = await db.query.transactions.findMany({
    where: and(
      eq(transactions.userId, userId),
      sql`${transactions.transactionDate} >= ${`${year}-01-01`}`,
      sql`${transactions.transactionDate} <= ${`${year}-12-31`}`
    ),
    with: { stock: true },
    orderBy: [asc(transactions.transactionDate)],
  });

  if (yearTransactions.length === 0) {
    console.log(`No transactions found for year ${year}`);
    return;
  }

  console.log(`Found ${yearTransactions.length} transactions in ${year}`);

  // Step 2: 取得所有涉及的股票並獲取歷史股價
  const stockSymbols = [...new Set(yearTransactions.map(t => t.stock.symbol))];
  console.log(`Stocks involved: ${stockSymbols.join(', ')}`);

  const priceMap = new Map<string, Map<string, number>>();

  for (const symbol of stockSymbols) {
    const stock = yearTransactions.find(t => t.stock.symbol === symbol)?.stock;
    if (!stock) continue;

    const yahooSymbol = stock.market === 'TW' ? `${symbol}.TW` : symbol;

    try {
      console.log(`Fetching historical prices for ${yahooSymbol}...`);

      // 先檢查資料庫是否已有該股票的歷史價格
      const existingPrices = await db.query.stockPrices.findMany({
        where: and(
          eq(stockPrices.stockId, stock.id),
          sql`${stockPrices.date} >= ${`${year}-01-01`}`,
          sql`${stockPrices.date} <= ${`${year}-12-31`}`
        ),
      });

      if (existingPrices.length > 0) {
        // 從資料庫載入價格
        console.log(`  Using ${existingPrices.length} existing price records from DB`);
        const symbolPrices = new Map<string, number>();
        for (const p of existingPrices) {
          symbolPrices.set(p.date, parseFloat(p.close));
        }
        priceMap.set(symbol, symbolPrices);

        // 如果已有足夠的價格數據，跳過 Yahoo Finance
        if (existingPrices.length > 100) {
          continue;
        }
      }

      // 從 Yahoo Finance 獲取
      await delay(3000); // 延遲 3 秒避免 API 限制
      const historical = await yahooFinance.chart(yahooSymbol, {
        period1: `${year}-01-01`,
        period2: `${year}-12-31`,
        interval: '1d',
      });

      const symbolPrices = new Map<string, number>();
      if (historical.quotes) {
        for (const quote of historical.quotes) {
          if (quote.date && quote.close) {
            const dateStr = new Date(quote.date).toISOString().split('T')[0];
            symbolPrices.set(dateStr, quote.close);
          }
        }
      }
      priceMap.set(symbol, symbolPrices);
      console.log(`  Got ${symbolPrices.size} price records`);

      // 將股價存入資料庫
      const stockRecord = await db.query.stocks.findFirst({
        where: and(eq(stocks.symbol, symbol), eq(stocks.market, stock.market)),
      });

      if (stockRecord && historical.quotes) {
        let savedCount = 0;
        for (const quote of historical.quotes) {
          if (quote.date && quote.close) {
            const dateStr = new Date(quote.date).toISOString().split('T')[0];
            try {
              await db.insert(stockPrices).values({
                stockId: stockRecord.id,
                date: dateStr,
                open: quote.open?.toString(),
                high: quote.high?.toString(),
                low: quote.low?.toString(),
                close: quote.close.toString(),
                volume: quote.volume?.toString(),
              }).onConflictDoNothing();
              savedCount++;
            } catch (e) {
              // ignore duplicates
            }
          }
        }
        console.log(`  Saved ${savedCount} price records to DB`);
      }
    } catch (error) {
      console.error(`  Failed to fetch prices for ${symbol}:`, error);
    }
  }

  // Step 3: 取得年初前的持倉狀態
  const previousYearTransactions = await db.query.transactions.findMany({
    where: and(
      eq(transactions.userId, userId),
      sql`${transactions.transactionDate} < ${`${year}-01-01`}`
    ),
    with: { stock: true },
    orderBy: [asc(transactions.transactionDate)],
  });

  console.log(`\nFound ${previousYearTransactions.length} transactions before ${year}`);

  // 計算年初持倉
  const initialHoldings = new Map<string, DailyHolding>();
  for (const tx of previousYearTransactions) {
    const existing = initialHoldings.get(tx.stockId) || {
      stockId: tx.stockId,
      symbol: tx.stock.symbol,
      market: tx.stock.market,
      quantity: 0,
      totalCost: 0,
    };

    if (tx.type === 'BUY') {
      existing.quantity += tx.quantity;
      existing.totalCost += parseFloat(tx.totalAmount);
    } else {
      const prevQuantity = existing.quantity;
      existing.quantity -= tx.quantity;
      if (existing.quantity > 0 && prevQuantity > 0) {
        const costPerShare = existing.totalCost / prevQuantity;
        existing.totalCost = costPerShare * existing.quantity;
      } else {
        existing.totalCost = 0;
      }
    }

    initialHoldings.set(tx.stockId, existing);
  }

  // 檢查是否有「先賣出」的情況，推算期初持倉
  // 掃描該年度的交易，如果有賣出但期初沒有足夠持倉，則推算期初持倉
  for (const tx of yearTransactions) {
    const existing = initialHoldings.get(tx.stockId);

    if (tx.type === 'SELL') {
      if (!existing || existing.quantity < tx.quantity) {
        // 需要推算期初持倉
        // 計算該年度對此股票的總買入和總賣出
        const stockTx = yearTransactions.filter(t => t.stockId === tx.stockId);
        let totalBuy = 0;
        let totalSell = 0;
        for (const t of stockTx) {
          if (t.type === 'BUY') totalBuy += t.quantity;
          else totalSell += t.quantity;
        }

        // 取得期末持倉（從 holdings 表）
        const currentHolding = await db.query.holdings.findFirst({
          where: and(eq(holdings.userId, userId), eq(holdings.stockId, tx.stockId)),
        });
        const endQuantity = currentHolding?.quantity || 0;

        // 期初持倉 = 期末持倉 - 總買入 + 總賣出
        const startQuantity = endQuantity - totalBuy + totalSell;

        if (startQuantity > 0) {
          // 取得第一個交易日的股價作為成本估算
          const firstTxDate = stockTx[0]?.transactionDate;
          const prices = priceMap.get(tx.stock.symbol);
          const estimatedCostPerShare = firstTxDate && prices ? (prices.get(firstTxDate) || parseFloat(tx.price)) : parseFloat(tx.price);

          initialHoldings.set(tx.stockId, {
            stockId: tx.stockId,
            symbol: tx.stock.symbol,
            market: tx.stock.market,
            quantity: startQuantity,
            totalCost: startQuantity * estimatedCostPerShare,
          });

          console.log(`  Inferred initial holding for ${tx.stock.symbol}: ${startQuantity} shares (cost estimated at ${estimatedCostPerShare})`);
        }
      }
    }
  }

  console.log(`Initial holdings at start of ${year}:`);
  for (const [, h] of initialHoldings) {
    if (h.quantity > 0) {
      console.log(`  ${h.symbol}: ${h.quantity} shares`);
    }
  }

  // Step 4: 取得所有需要建立快照的日期
  const allDates = new Set<string>();
  for (const [, prices] of priceMap) {
    for (const date of prices.keys()) {
      if (date.startsWith(`${year}-`)) {
        allDates.add(date);
      }
    }
  }

  const sortedDates = Array.from(allDates).sort();
  console.log(`\nProcessing ${sortedDates.length} trading days...\n`);

  // Step 5: 逐日計算淨值並建立快照
  const currentHoldings = new Map(initialHoldings);
  const usdToTwd = await getUSDToTWDRate();
  let snapshotsCreated = 0;
  let previousTotalValue: number | null = null;
  let firstTotalValue: number | null = null;

  for (const date of sortedDates) {
    // 處理當天的交易
    const dayTransactions = yearTransactions.filter(t => t.transactionDate === date);

    for (const tx of dayTransactions) {
      const existing = currentHoldings.get(tx.stockId) || {
        stockId: tx.stockId,
        symbol: tx.stock.symbol,
        market: tx.stock.market,
        quantity: 0,
        totalCost: 0,
      };

      if (tx.type === 'BUY') {
        existing.quantity += tx.quantity;
        existing.totalCost += parseFloat(tx.totalAmount);
      } else {
        const prevQuantity = existing.quantity;
        existing.quantity -= tx.quantity;
        if (existing.quantity > 0 && prevQuantity > 0) {
          const costPerShare = existing.totalCost / prevQuantity;
          existing.totalCost = costPerShare * existing.quantity;
        } else {
          existing.totalCost = 0;
        }
      }

      currentHoldings.set(tx.stockId, existing);
    }

    // 計算當天淨值
    let twStockValue = 0;
    let usStockValue = 0;

    for (const [, holding] of currentHoldings) {
      if (holding.quantity <= 0) continue;

      const prices = priceMap.get(holding.symbol);
      let price = prices?.get(date);

      // 如果沒有當天價格，嘗試用最近一天的價格
      if (!price && prices) {
        const sortedDates = Array.from(prices.keys()).sort();
        for (let i = sortedDates.length - 1; i >= 0; i--) {
          if (sortedDates[i] <= date) {
            price = prices.get(sortedDates[i]);
            break;
          }
        }
      }

      // 如果還是沒有價格，使用平均成本
      if (!price && holding.quantity > 0) {
        price = holding.totalCost / holding.quantity;
      }

      if (price) {
        const marketValue = price * holding.quantity;
        if (holding.market === 'TW') {
          twStockValue += marketValue;
        } else {
          usStockValue += marketValue;
        }
      }
    }

    const totalValue = twStockValue + usStockValue * usdToTwd;

    if (totalValue > 0) {
      let dailyReturn: number | undefined;
      let cumulativeReturn: number | undefined;

      if (previousTotalValue !== null && previousTotalValue > 0) {
        dailyReturn = (totalValue - previousTotalValue) / previousTotalValue;
      }

      if (firstTotalValue === null) {
        firstTotalValue = totalValue;
      } else if (firstTotalValue > 0) {
        cumulativeReturn = (totalValue - firstTotalValue) / firstTotalValue;
      }

      await db.insert(dailyNetValues).values({
        userId,
        date,
        twStockValue: twStockValue.toFixed(2),
        usStockValue: usStockValue.toFixed(2),
        totalValue: totalValue.toFixed(2),
        usdToTwdRate: usdToTwd.toFixed(4),
        dailyReturn: dailyReturn?.toFixed(6),
        cumulativeReturn: cumulativeReturn?.toFixed(6),
      }).onConflictDoUpdate({
        target: [dailyNetValues.userId, dailyNetValues.date],
        set: {
          twStockValue: twStockValue.toFixed(2),
          usStockValue: usStockValue.toFixed(2),
          totalValue: totalValue.toFixed(2),
          usdToTwdRate: usdToTwd.toFixed(4),
          dailyReturn: dailyReturn?.toFixed(6),
          cumulativeReturn: cumulativeReturn?.toFixed(6),
        },
      });

      previousTotalValue = totalValue;
      snapshotsCreated++;

      // 每 50 天輸出一次進度
      if (snapshotsCreated % 50 === 0) {
        console.log(`  Processed ${snapshotsCreated} snapshots... (current: ${date}, value: ${totalValue.toFixed(0)})`);
      }
    }
  }

  console.log(`\n=== Completed ===`);
  console.log(`Created ${snapshotsCreated} net value snapshots for ${year}`);
}

async function main() {
  try {
    // 取得所有用戶
    const allUsers = await db.query.users.findMany();

    if (allUsers.length === 0) {
      console.log('No users found');
      return;
    }

    console.log(`Found ${allUsers.length} user(s)`);

    for (const user of allUsers) {
      await backfillYear(user.id, 2025);
    }

    console.log('\nAll done!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
