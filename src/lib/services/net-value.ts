import { db } from '@/db';
import { holdings, dailyNetValues, stocks, stockPrices, users } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getUSDToTWDRate } from './exchange-rate';
import { getLatestStockPrice } from './stock-price';

// ============ TYPES ============

export interface UserNetValue {
  userId: string;
  date: string;
  twStockValue: number;
  usStockValue: number;
  totalValueTWD: number;
  usdToTwdRate: number;
  dailyReturn?: number;
  cumulativeReturn?: number;
}

export interface SnapshotResult {
  success: boolean;
  usersProcessed: number;
  errors: string[];
}

// ============ NET VALUE CALCULATION ============

/**
 * 計算單一用戶的資產淨值
 */
export async function calculateUserNetValue(userId: string): Promise<UserNetValue | null> {
  try {
    // 取得用戶所有持倉
    const userHoldings = await db.query.holdings.findMany({
      where: eq(holdings.userId, userId),
      with: {
        stock: true,
      },
    });

    if (userHoldings.length === 0) {
      return null;
    }

    // 取得當前匯率
    const usdToTwdRate = await getUSDToTWDRate();

    let twStockValue = 0;
    let usStockValue = 0;

    // 計算每檔股票的市值
    for (const holding of userHoldings) {
      if (holding.quantity <= 0) continue;

      // 優先使用最新市價，若無則使用持倉均價
      const latestPrice = await getLatestStockPrice(holding.stockId);
      const price = latestPrice ?? parseFloat(holding.averageCost);
      const marketValue = price * holding.quantity;

      if (holding.stock.market === 'TW') {
        twStockValue += marketValue;
      } else {
        usStockValue += marketValue;
      }
    }

    // 計算總市值 (以 TWD 為單位)
    const totalValueTWD = twStockValue + usStockValue * usdToTwdRate;

    const today = new Date().toISOString().split('T')[0];

    // 計算日報酬率
    const previousValue = await db.query.dailyNetValues.findFirst({
      where: eq(dailyNetValues.userId, userId),
      orderBy: [desc(dailyNetValues.date)],
    });

    let dailyReturn: number | undefined;
    let cumulativeReturn: number | undefined;

    if (previousValue && parseFloat(previousValue.totalValue) > 0) {
      const prevTotal = parseFloat(previousValue.totalValue);
      dailyReturn = (totalValueTWD - prevTotal) / prevTotal;

      // 累積報酬率需要從第一筆記錄計算
      const firstValue = await db.query.dailyNetValues.findFirst({
        where: eq(dailyNetValues.userId, userId),
        orderBy: [dailyNetValues.date],
      });

      if (firstValue) {
        const firstTotal = parseFloat(firstValue.totalValue);
        if (firstTotal > 0) {
          cumulativeReturn = (totalValueTWD - firstTotal) / firstTotal;
        }
      }
    }

    return {
      userId,
      date: today,
      twStockValue,
      usStockValue,
      totalValueTWD,
      usdToTwdRate,
      dailyReturn,
      cumulativeReturn,
    };
  } catch (error) {
    console.error(`Error calculating net value for user ${userId}:`, error);
    return null;
  }
}

/**
 * 儲存用戶淨值快照到資料庫
 */
export async function saveUserNetValue(netValue: UserNetValue): Promise<void> {
  await db.insert(dailyNetValues).values({
    userId: netValue.userId,
    date: netValue.date,
    twStockValue: netValue.twStockValue.toFixed(2),
    usStockValue: netValue.usStockValue.toFixed(2),
    totalValue: netValue.totalValueTWD.toFixed(2),
    usdToTwdRate: netValue.usdToTwdRate.toFixed(4),
    dailyReturn: netValue.dailyReturn?.toFixed(6),
    cumulativeReturn: netValue.cumulativeReturn?.toFixed(6),
  }).onConflictDoUpdate({
    target: [dailyNetValues.userId, dailyNetValues.date],
    set: {
      twStockValue: netValue.twStockValue.toFixed(2),
      usStockValue: netValue.usStockValue.toFixed(2),
      totalValue: netValue.totalValueTWD.toFixed(2),
      usdToTwdRate: netValue.usdToTwdRate.toFixed(4),
      dailyReturn: netValue.dailyReturn?.toFixed(6),
      cumulativeReturn: netValue.cumulativeReturn?.toFixed(6),
    },
  });
}

/**
 * 為所有有持倉的用戶建立淨值快照
 */
export async function snapshotAllUserNetValues(): Promise<SnapshotResult> {
  const errors: string[] = [];
  let usersProcessed = 0;

  try {
    // 取得所有有持倉的用戶 (通過 holdings 表)
    const usersWithHoldings = await db
      .selectDistinct({ userId: holdings.userId })
      .from(holdings)
      .where(eq(holdings.quantity, holdings.quantity)); // 基本上是 quantity > 0 的邏輯

    for (const { userId } of usersWithHoldings) {
      try {
        const netValue = await calculateUserNetValue(userId);

        if (netValue && netValue.totalValueTWD > 0) {
          await saveUserNetValue(netValue);
          usersProcessed++;
        }
      } catch (error) {
        errors.push(`User ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return {
      success: errors.length === 0,
      usersProcessed,
      errors,
    };
  } catch (error) {
    return {
      success: false,
      usersProcessed,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}

/**
 * 取得用戶的歷史淨值資料 (用於圖表)
 */
export async function getUserNetValueHistory(
  userId: string,
  days: number = 30
): Promise<{
  date: string;
  totalValue: number;
  twStockValue: number;
  usStockValue: number;
  dailyReturn: number | null;
}[]> {
  const history = await db.query.dailyNetValues.findMany({
    where: eq(dailyNetValues.userId, userId),
    orderBy: [desc(dailyNetValues.date)],
    limit: days,
  });

  return history
    .map(record => ({
      date: record.date,
      totalValue: parseFloat(record.totalValue),
      twStockValue: parseFloat(record.twStockValue || '0'),
      usStockValue: parseFloat(record.usStockValue || '0'),
      dailyReturn: record.dailyReturn ? parseFloat(record.dailyReturn) : null,
    }))
    .reverse(); // 按時間順序排列
}

/**
 * 取得用戶最新的淨值
 */
export async function getUserLatestNetValue(userId: string): Promise<{
  totalValue: number;
  twStockValue: number;
  usStockValue: number;
  date: string;
} | null> {
  const latest = await db.query.dailyNetValues.findFirst({
    where: eq(dailyNetValues.userId, userId),
    orderBy: [desc(dailyNetValues.date)],
  });

  if (!latest) return null;

  return {
    totalValue: parseFloat(latest.totalValue),
    twStockValue: parseFloat(latest.twStockValue || '0'),
    usStockValue: parseFloat(latest.usStockValue || '0'),
    date: latest.date,
  };
}
