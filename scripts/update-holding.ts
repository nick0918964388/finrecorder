import 'dotenv/config';
import { db } from '../src/db';
import { holdings, stocks } from '../src/db/schema';
import { eq, and } from 'drizzle-orm';

async function main() {
  const user = await db.query.users.findFirst();
  const stock = await db.query.stocks.findFirst({
    where: and(eq(stocks.symbol, '00631L'), eq(stocks.market, 'TW')),
  });

  if (!user || !stock) {
    console.error('User or stock not found');
    process.exit(1);
  }

  // Delete existing holding
  await db.delete(holdings).where(
    and(eq(holdings.userId, user.id), eq(holdings.stockId, stock.id))
  );

  // Create new holding with 29000 shares
  const avgCost = 250; // Estimate
  await db.insert(holdings).values({
    userId: user.id,
    stockId: stock.id,
    quantity: 29000,
    averageCost: avgCost.toString(),
    totalCost: (29000 * avgCost).toString(),
    currency: 'TWD',
  });

  console.log('Updated holding: 29,000 shares of 00631L @ avg NT$250');
  process.exit(0);
}

main().catch(console.error);
