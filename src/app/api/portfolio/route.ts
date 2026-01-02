import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { holdings, stocks, stockPrices, exchangeRates } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';

export interface HoldingWithStock {
  holding: {
    id: string;
    quantity: number;
    averageCost: string;
    totalCost: string;
    currency: 'TWD' | 'USD';
  };
  stock: {
    id: string;
    symbol: string;
    market: 'TW' | 'US';
    name: string | null;
    nameTw: string | null;
  };
  currentPrice: string | null;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
}

export interface PortfolioSummary {
  totalCostTWD: number;
  totalValueTWD: number;
  totalUnrealizedPnL: number;
  totalUnrealizedPnLPercent: number;
  twStockValue: number;
  usStockValue: number;
  usdToTwdRate: number;
  holdings: HoldingWithStock[];
}

// GET /api/portfolio - Get portfolio summary and holdings
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all holdings for the user
    const userHoldings = await db
      .select({
        holding: holdings,
        stock: stocks,
      })
      .from(holdings)
      .leftJoin(stocks, eq(holdings.stockId, stocks.id))
      .where(eq(holdings.userId, session.user.id));

    // Get latest exchange rate (USD to TWD)
    const latestRate = await db.query.exchangeRates.findFirst({
      where: and(
        eq(exchangeRates.fromCurrency, 'USD'),
        eq(exchangeRates.toCurrency, 'TWD')
      ),
      orderBy: [desc(exchangeRates.date)],
    });
    const usdToTwdRate = latestRate ? parseFloat(latestRate.rate) : 32.0; // Default rate

    // Process holdings and calculate values
    const holdingsWithDetails: HoldingWithStock[] = [];
    let totalCostTWD = 0;
    let totalValueTWD = 0;
    let twStockValue = 0;
    let usStockValue = 0;

    for (const { holding, stock } of userHoldings) {
      if (!stock) continue;

      // Get latest price for this stock
      const latestPrice = await db.query.stockPrices.findFirst({
        where: eq(stockPrices.stockId, stock.id),
        orderBy: [desc(stockPrices.date)],
      });

      const currentPrice = latestPrice?.close ?? null;
      const priceNum = currentPrice ? parseFloat(currentPrice) : parseFloat(holding.averageCost);

      // Calculate market value in original currency
      const marketValue = holding.quantity * priceNum;
      const totalCost = parseFloat(holding.totalCost);
      const unrealizedPnL = marketValue - totalCost;
      const unrealizedPnLPercent = totalCost > 0 ? (unrealizedPnL / totalCost) * 100 : 0;

      // Convert to TWD for totals
      const costInTWD = stock.market === 'US' ? totalCost * usdToTwdRate : totalCost;
      const valueInTWD = stock.market === 'US' ? marketValue * usdToTwdRate : marketValue;

      totalCostTWD += costInTWD;
      totalValueTWD += valueInTWD;

      if (stock.market === 'TW') {
        twStockValue += marketValue;
      } else {
        usStockValue += marketValue;
      }

      holdingsWithDetails.push({
        holding: {
          id: holding.id,
          quantity: holding.quantity,
          averageCost: holding.averageCost,
          totalCost: holding.totalCost,
          currency: holding.currency,
        },
        stock: {
          id: stock.id,
          symbol: stock.symbol,
          market: stock.market,
          name: stock.name,
          nameTw: stock.nameTw,
        },
        currentPrice,
        marketValue,
        unrealizedPnL,
        unrealizedPnLPercent,
      });
    }

    const totalUnrealizedPnL = totalValueTWD - totalCostTWD;
    const totalUnrealizedPnLPercent = totalCostTWD > 0 ? (totalUnrealizedPnL / totalCostTWD) * 100 : 0;

    const summary: PortfolioSummary = {
      totalCostTWD,
      totalValueTWD,
      totalUnrealizedPnL,
      totalUnrealizedPnLPercent,
      twStockValue,
      usStockValue,
      usdToTwdRate,
      holdings: holdingsWithDetails,
    };

    return NextResponse.json(summary);
  } catch (error) {
    console.error('Error fetching portfolio:', error);
    return NextResponse.json(
      { error: 'Failed to fetch portfolio' },
      { status: 500 }
    );
  }
}
