import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { transactions, stocks, holdings } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { calculateUserNetValue, saveUserNetValue } from '@/lib/services/net-value';

// GET /api/transactions/[id] - Get a single transaction
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const result = await db
      .select({
        transaction: transactions,
        stock: stocks,
      })
      .from(transactions)
      .leftJoin(stocks, eq(transactions.stockId, stocks.id))
      .where(
        and(
          eq(transactions.id, id),
          eq(transactions.userId, session.user.id)
        )
      )
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    return NextResponse.json(result[0]);
  } catch (error) {
    console.error('Error fetching transaction:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transaction' },
      { status: 500 }
    );
  }
}

// PUT /api/transactions/[id] - Update a transaction
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    // Get the existing transaction
    const existingTransaction = await db.query.transactions.findFirst({
      where: and(
        eq(transactions.id, id),
        eq(transactions.userId, session.user.id)
      ),
    });

    if (!existingTransaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    // Get the stock info
    const stock = await db.query.stocks.findFirst({
      where: eq(stocks.id, existingTransaction.stockId),
    });

    // Reverse the old transaction's effect on holdings - use actual cost per share
    const oldCostPerShare = existingTransaction.type === 'BUY'
      ? parseFloat(existingTransaction.totalAmount) / existingTransaction.quantity
      : parseFloat(existingTransaction.price);
    await reverseHoldingEffect(
      session.user.id,
      existingTransaction.stockId,
      existingTransaction.type as 'BUY' | 'SELL',
      existingTransaction.quantity,
      oldCostPerShare,
      existingTransaction.currency as 'TWD' | 'USD'
    );

    // Calculate new values
    const currency = stock?.market === 'TW' ? 'TWD' : 'USD';
    const quantity = body.quantity ?? existingTransaction.quantity;
    const price = body.price ?? parseFloat(existingTransaction.price);
    const type = body.type ?? existingTransaction.type;
    const grossAmount = quantity * price;

    let brokerFee = body.brokerFee ?? 0;
    let tax = body.tax ?? 0;

    // Auto-calculate fees for Taiwan stocks if not provided
    if (stock?.market === 'TW' && !body.brokerFee) {
      brokerFee = Math.round(grossAmount * 0.001425);
      brokerFee = Math.max(brokerFee, 20);
    }

    if (stock?.market === 'TW' && type === 'SELL' && !body.tax) {
      tax = Math.round(grossAmount * 0.003);
    }

    const totalAmount =
      type === 'BUY'
        ? grossAmount + brokerFee + tax
        : grossAmount - brokerFee - tax;

    // Update the transaction
    const [updatedTransaction] = await db
      .update(transactions)
      .set({
        type,
        quantity,
        price: price.toString(),
        transactionDate: body.transactionDate ?? existingTransaction.transactionDate,
        brokerFee: brokerFee.toString(),
        tax: tax.toString(),
        totalAmount: totalAmount.toString(),
        notes: body.notes ?? existingTransaction.notes,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, id))
      .returning();

    // Apply the new transaction's effect on holdings - use actual cost per share
    const costPerShare = type === 'BUY'
      ? totalAmount / quantity  // Buy: total cost including fees
      : price;  // Sell: use original price
    await applyHoldingEffect(
      session.user.id,
      existingTransaction.stockId,
      type as 'BUY' | 'SELL',
      quantity,
      costPerShare,
      currency as 'TWD' | 'USD'
    );

    // Auto-generate daily net value snapshot
    try {
      const netValue = await calculateUserNetValue(session.user.id);
      if (netValue && netValue.totalValueTWD > 0) {
        await saveUserNetValue(netValue);
      }
    } catch (snapshotError) {
      console.error('Error creating net value snapshot:', snapshotError);
    }

    return NextResponse.json({ success: true, data: updatedTransaction });
  } catch (error) {
    console.error('Error updating transaction:', error);
    return NextResponse.json(
      { error: 'Failed to update transaction' },
      { status: 500 }
    );
  }
}

// DELETE /api/transactions/[id] - Delete a transaction
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Get the transaction first
    const transaction = await db.query.transactions.findFirst({
      where: and(
        eq(transactions.id, id),
        eq(transactions.userId, session.user.id)
      ),
    });

    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    // Reverse the transaction's effect on holdings
    await reverseHoldingEffect(
      session.user.id,
      transaction.stockId,
      transaction.type as 'BUY' | 'SELL',
      transaction.quantity,
      parseFloat(transaction.price),
      transaction.currency as 'TWD' | 'USD'
    );

    // Delete the transaction
    await db.delete(transactions).where(eq(transactions.id, id));

    // Auto-generate daily net value snapshot
    try {
      const netValue = await calculateUserNetValue(session.user.id);
      if (netValue && netValue.totalValueTWD > 0) {
        await saveUserNetValue(netValue);
      }
    } catch (snapshotError) {
      console.error('Error creating net value snapshot:', snapshotError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    return NextResponse.json(
      { error: 'Failed to delete transaction' },
      { status: 500 }
    );
  }
}

// Helper function to reverse a transaction's effect on holdings
async function reverseHoldingEffect(
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
    // Reverse a buy = reduce holdings
    if (existingHolding) {
      const newQuantity = existingHolding.quantity - quantity;
      if (newQuantity <= 0) {
        await db.delete(holdings).where(eq(holdings.id, existingHolding.id));
      } else {
        // Recalculate average cost (approximation)
        const newTotalCost = parseFloat(existingHolding.totalCost) - quantity * price;
        const newAverageCost = newTotalCost / newQuantity;
        await db
          .update(holdings)
          .set({
            quantity: newQuantity,
            averageCost: Math.max(0, newAverageCost).toString(),
            totalCost: Math.max(0, newTotalCost).toString(),
            updatedAt: new Date(),
          })
          .where(eq(holdings.id, existingHolding.id));
      }
    }
  } else {
    // Reverse a sell = increase holdings
    if (existingHolding) {
      const newQuantity = existingHolding.quantity + quantity;
      const newTotalCost = parseFloat(existingHolding.totalCost) + quantity * price;
      await db
        .update(holdings)
        .set({
          quantity: newQuantity,
          totalCost: newTotalCost.toString(),
          updatedAt: new Date(),
        })
        .where(eq(holdings.id, existingHolding.id));
    } else {
      // Create new holding if it doesn't exist
      await db.insert(holdings).values({
        userId,
        stockId,
        quantity,
        averageCost: price.toString(),
        totalCost: (quantity * price).toString(),
        currency,
      });
    }
  }
}

// Helper function to apply a transaction's effect on holdings
async function applyHoldingEffect(
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
      const newTotalCost = parseFloat(existingHolding.totalCost) + quantity * price;
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
        const newTotalCost = newQuantity * parseFloat(existingHolding.averageCost);
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
