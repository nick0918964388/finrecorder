import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { transactions, holdings, stocks } from '@/db/schema';
import { eq, and, asc } from 'drizzle-orm';

/**
 * POST /api/holdings/recalculate
 * 重新計算用戶的持倉均價（基於實際交易成本，包含手續費和稅）
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // 取得用戶所有交易記錄，按時間排序
    const userTransactions = await db
      .select({
        transaction: transactions,
        stock: stocks,
      })
      .from(transactions)
      .leftJoin(stocks, eq(transactions.stockId, stocks.id))
      .where(eq(transactions.userId, userId))
      .orderBy(asc(transactions.transactionDate), asc(transactions.createdAt));

    // 按股票分組計算
    const holdingsMap = new Map<string, {
      stockId: string;
      quantity: number;
      totalCost: number;
      currency: 'TWD' | 'USD';
    }>();

    for (const { transaction, stock } of userTransactions) {
      const stockId = transaction.stockId;
      const existing = holdingsMap.get(stockId);

      if (transaction.type === 'BUY') {
        // 買入：使用總金額（包含手續費和稅）計算成本
        const costPerShare = parseFloat(transaction.totalAmount) / transaction.quantity;
        const transactionCost = costPerShare * transaction.quantity;

        if (existing) {
          existing.quantity += transaction.quantity;
          existing.totalCost += transactionCost;
        } else {
          holdingsMap.set(stockId, {
            stockId,
            quantity: transaction.quantity,
            totalCost: transactionCost,
            currency: transaction.currency as 'TWD' | 'USD',
          });
        }
      } else {
        // 賣出：減少持倉數量，成本按比例減少
        if (existing && existing.quantity > 0) {
          const avgCost = existing.totalCost / existing.quantity;
          existing.quantity -= transaction.quantity;
          existing.totalCost = existing.quantity * avgCost;

          if (existing.quantity <= 0) {
            holdingsMap.delete(stockId);
          }
        }
      }
    }

    // 更新資料庫中的持倉
    let updated = 0;
    let deleted = 0;

    // 先刪除該用戶的所有持倉
    await db.delete(holdings).where(eq(holdings.userId, userId));

    // 重新插入計算後的持倉
    for (const [stockId, holding] of holdingsMap) {
      if (holding.quantity > 0) {
        const averageCost = holding.totalCost / holding.quantity;

        await db.insert(holdings).values({
          userId,
          stockId: holding.stockId,
          quantity: holding.quantity,
          averageCost: averageCost.toString(),
          totalCost: holding.totalCost.toString(),
          currency: holding.currency,
        });
        updated++;
      }
    }

    return NextResponse.json({
      success: true,
      message: '持倉均價已重新計算',
      data: {
        holdingsUpdated: updated,
        transactionsProcessed: userTransactions.length,
      },
    });
  } catch (error) {
    console.error('Error recalculating holdings:', error);
    return NextResponse.json(
      { error: 'Failed to recalculate holdings' },
      { status: 500 }
    );
  }
}
