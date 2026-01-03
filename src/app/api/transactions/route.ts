import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { transactions, stocks, holdings } from '@/db/schema';
import { createTransactionSchema } from '@/lib/validators';
import { eq, and, desc } from 'drizzle-orm';
import { calculateUserNetValue, saveUserNetValue } from '@/lib/services/net-value';

// GET /api/transactions - Get all transactions for the current user
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const market = searchParams.get('market');

    const userTransactions = await db
      .select({
        transaction: transactions,
        stock: stocks,
      })
      .from(transactions)
      .leftJoin(stocks, eq(transactions.stockId, stocks.id))
      .where(eq(transactions.userId, session.user.id))
      .orderBy(desc(transactions.transactionDate))
      .limit(limit)
      .offset((page - 1) * limit);

    return NextResponse.json({
      data: userTransactions,
      page,
      limit,
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transactions' },
      { status: 500 }
    );
  }
}

// POST /api/transactions - Create a new transaction
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validation = createTransactionSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues },
        { status: 400 }
      );
    }

    const data = validation.data;
    const currency = data.market === 'TW' ? 'TWD' : 'USD';

    // Find or create stock
    let stock = await db.query.stocks.findFirst({
      where: and(
        eq(stocks.symbol, data.symbol.toUpperCase()),
        eq(stocks.market, data.market)
      ),
    });

    if (!stock) {
      const [newStock] = await db
        .insert(stocks)
        .values({
          symbol: data.symbol.toUpperCase(),
          market: data.market,
        })
        .returning();
      stock = newStock;
    }

    // Calculate fees
    const grossAmount = data.quantity * data.price;
    let brokerFee = data.brokerFee ?? 0;
    let tax = data.tax ?? 0;

    // Auto-calculate fees for Taiwan stocks if not provided
    if (data.market === 'TW' && !data.brokerFee) {
      brokerFee = Math.round(grossAmount * 0.001425); // 0.1425%
      brokerFee = Math.max(brokerFee, 20); // Minimum fee
    }

    if (data.market === 'TW' && data.type === 'SELL' && !data.tax) {
      tax = Math.round(grossAmount * 0.003); // 0.3% tax on sell
    }

    const totalAmount =
      data.type === 'BUY'
        ? grossAmount + brokerFee + tax
        : grossAmount - brokerFee - tax;

    // Create transaction
    const [newTransaction] = await db
      .insert(transactions)
      .values({
        userId: session.user.id,
        stockId: stock.id,
        type: data.type,
        quantity: data.quantity,
        price: data.price.toString(),
        currency,
        transactionDate: data.transactionDate,
        brokerFee: brokerFee.toString(),
        tax: tax.toString(),
        totalAmount: totalAmount.toString(),
        notes: data.notes,
      })
      .returning();

    // Update holdings - use actual cost per share (including fees) for average cost calculation
    const costPerShare = data.type === 'BUY'
      ? totalAmount / data.quantity  // Buy: total cost including fees
      : data.price;  // Sell: use original price (doesn't affect average cost)
    await updateHoldings(session.user.id, stock.id, data.type, data.quantity, costPerShare, currency);

    // Auto-generate daily net value snapshot
    try {
      const netValue = await calculateUserNetValue(session.user.id);
      if (netValue && netValue.totalValueTWD > 0) {
        await saveUserNetValue(netValue);
      }
    } catch (snapshotError) {
      console.error('Error creating net value snapshot:', snapshotError);
      // Don't fail the transaction if snapshot fails
    }

    return NextResponse.json({ success: true, data: newTransaction });
  } catch (error) {
    console.error('Error creating transaction:', error);
    return NextResponse.json(
      { error: 'Failed to create transaction' },
      { status: 500 }
    );
  }
}

async function updateHoldings(
  userId: string,
  stockId: string,
  type: 'BUY' | 'SELL',
  quantity: number,
  price: number,
  currency: 'TWD' | 'USD'
) {
  const existingHolding = await db.query.holdings.findFirst({
    where: and(eq(holdings.userId, userId), eq(holdings.stockId, stockId)),
  });

  if (type === 'BUY') {
    if (existingHolding) {
      const newQuantity = existingHolding.quantity + quantity;
      const newTotalCost =
        parseFloat(existingHolding.totalCost) + quantity * price;
      const newAverageCost = newTotalCost / newQuantity;

      await db
        .update(holdings)
        .set({
          quantity: newQuantity,
          averageCost: newAverageCost.toString(),
          totalCost: newTotalCost.toString(),
          updatedAt: new Date(),
        })
        .where(eq(holdings.id, existingHolding.id));
    } else {
      await db.insert(holdings).values({
        userId,
        stockId,
        quantity,
        averageCost: price.toString(),
        totalCost: (quantity * price).toString(),
        currency,
      });
    }
  } else {
    // SELL
    if (existingHolding) {
      const newQuantity = existingHolding.quantity - quantity;

      if (newQuantity <= 0) {
        await db.delete(holdings).where(eq(holdings.id, existingHolding.id));
      } else {
        const newTotalCost =
          newQuantity * parseFloat(existingHolding.averageCost);
        await db
          .update(holdings)
          .set({
            quantity: newQuantity,
            totalCost: newTotalCost.toString(),
            updatedAt: new Date(),
          })
          .where(eq(holdings.id, existingHolding.id));
      }
    }
  }
}
