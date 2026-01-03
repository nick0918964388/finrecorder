import { NextRequest, NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';
import { db } from '@/db';
import { transactions, stocks, stockPrices, dailyNetValues, holdings } from '@/db/schema';
import { eq, and, lte, desc, asc, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getUSDToTWDRate } from '@/lib/services/exchange-rate';

interface DailyHolding {
  stockId: string;
  symbol: string;
  market: 'TW' | 'US';
  quantity: number;
  totalCost: number;
}

/**
 * POST /api/admin/backfill-snapshots
 * 回溯建立歷史淨值快照
 *
 * Body:
 * - year: 要回溯的年度 (例如: 2025)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const year = body.year || 2025;
    const userId = session.user.id;

    console.log(`Starting backfill for user ${userId}, year ${year}`);

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
      return NextResponse.json({
        success: false,
        error: `No transactions found for year ${year}`
      });
    }

    // Step 2: 取得所有涉及的股票並獲取歷史股價
    const stockSymbols = [...new Set(yearTransactions.map(t => t.stock.symbol))];
    console.log(`Fetching historical prices for: ${stockSymbols.join(', ')}`);

    const priceMap = new Map<string, Map<string, number>>(); // symbol -> date -> price

    for (const symbol of stockSymbols) {
      const stock = yearTransactions.find(t => t.stock.symbol === symbol)?.stock;
      if (!stock) continue;

      const yahooSymbol = stock.market === 'TW' ? `${symbol}.TW` : symbol;

      try {
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
        console.log(`Got ${symbolPrices.size} price records for ${symbol}`);

        // 同時將股價存入資料庫
        const stockRecord = await db.query.stocks.findFirst({
          where: and(eq(stocks.symbol, symbol), eq(stocks.market, stock.market)),
        });

        if (stockRecord && historical.quotes) {
          for (const quote of historical.quotes) {
            if (quote.date && quote.close) {
              const dateStr = new Date(quote.date).toISOString().split('T')[0];
              await db.insert(stockPrices).values({
                stockId: stockRecord.id,
                date: dateStr,
                open: quote.open?.toString(),
                high: quote.high?.toString(),
                low: quote.low?.toString(),
                close: quote.close.toString(),
                volume: quote.volume?.toString(),
              }).onConflictDoNothing();
            }
          }
        }
      } catch (error) {
        console.error(`Failed to fetch prices for ${symbol}:`, error);
      }
    }

    // Step 3: 取得年初前的持倉狀態 (計算到上一年度的累計持倉)
    const previousYearTransactions = await db.query.transactions.findMany({
      where: and(
        eq(transactions.userId, userId),
        sql`${transactions.transactionDate} < ${`${year}-01-01`}`
      ),
      with: { stock: true },
      orderBy: [asc(transactions.transactionDate)],
    });

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
        existing.quantity -= tx.quantity;
        // 賣出時按比例減少成本
        if (existing.quantity > 0) {
          const costPerShare = existing.totalCost / (existing.quantity + tx.quantity);
          existing.totalCost = costPerShare * existing.quantity;
        } else {
          existing.totalCost = 0;
        }
      }

      initialHoldings.set(tx.stockId, existing);
    }

    // Step 4: 取得所有需要建立快照的日期 (交易日)
    const allDates = new Set<string>();

    // 從股價資料取得所有交易日
    for (const [, prices] of priceMap) {
      for (const date of prices.keys()) {
        if (date.startsWith(`${year}-`)) {
          allDates.add(date);
        }
      }
    }

    const sortedDates = Array.from(allDates).sort();
    console.log(`Processing ${sortedDates.length} trading days`);

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
        const price = prices?.get(date);

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

      // 只有有持倉價值時才建立快照
      if (totalValue > 0) {
        // 計算日報酬率
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

        // 儲存快照
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
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        year,
        tradingDays: sortedDates.length,
        snapshotsCreated,
        stocksProcessed: stockSymbols,
      },
    });
  } catch (error) {
    console.error('Error in backfill:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/backfill-snapshots
 * 取得回溯任務資訊
 */
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/admin/backfill-snapshots',
    method: 'POST',
    description: 'Backfill historical net value snapshots for a specific year',
    body: {
      year: 'Year to backfill (e.g., 2025)',
    },
  });
}
