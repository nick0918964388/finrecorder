/**
 * Script to import transactions from the screenshot data
 * Run with: npx tsx scripts/import-transactions.ts
 *
 * Note: 負股數 = 買入, 正股數 = 賣出
 */

import 'dotenv/config';
import { db } from '../src/db';
import { transactions, stocks, holdings } from '../src/db/schema';
import { eq, and } from 'drizzle-orm';

// Data from screenshot - 00631L transactions
// quantity: negative = BUY, positive = SELL
const transactionData = [
  { date: '2025-01-06', quantity: 49000, price: 182.63 },   // 49000 正 = SELL
  { date: '2025-01-07', quantity: -1000, price: 256.6 },    // -1000 負 = BUY
  { date: '2025-01-07', quantity: -1000, price: 256.65 },
  { date: '2025-01-07', quantity: -2000, price: 256.75 },
  { date: '2025-01-07', quantity: -3000, price: 256.85 },
  { date: '2025-01-09', quantity: -1000, price: 245.45 },
  { date: '2025-01-10', quantity: -1000, price: 238.6 },
  { date: '2025-01-10', quantity: -2000, price: 238.55 },
  { date: '2025-01-10', quantity: -1000, price: 241.45 },
  { date: '2025-01-16', quantity: -3000, price: 239.95 },
  { date: '2025-01-16', quantity: -2000, price: 236.8 },
  { date: '2025-01-16', quantity: -2000, price: 237.5 },
  { date: '2025-01-16', quantity: -2000, price: 237.6 },
  { date: '2025-01-16', quantity: -3000, price: 237.85 },
  { date: '2025-02-03', quantity: -1000, price: 228.95 },
  { date: '2025-02-05', quantity: -1000, price: 240.3 },
  { date: '2025-02-13', quantity: 500, price: 241.4 },      // 500 正 = SELL
  { date: '2025-03-03', quantity: -1000, price: 227.6 },
  { date: '2025-03-04', quantity: 1000, price: 222.2 },     // 正 = SELL
  { date: '2025-03-04', quantity: 1000, price: 222.3 },
  { date: '2025-03-04', quantity: 1000, price: 222.25 },
  { date: '2025-03-04', quantity: 1000, price: 222.1 },
  { date: '2025-03-04', quantity: 1000, price: 222.15 },
  { date: '2025-03-04', quantity: 3000, price: 222.2 },
  { date: '2025-03-04', quantity: 4000, price: 221.55 },
  { date: '2025-04-08', quantity: -2000, price: 140.25 },
  { date: '2025-04-08', quantity: -1000, price: 148.25 },
  { date: '2025-04-08', quantity: -1000, price: 145.85 },
  { date: '2025-04-08', quantity: -100, price: 141.3 },
  { date: '2025-04-11', quantity: -500, price: 147.95 },
  { date: '2025-04-11', quantity: -1000, price: 155.1 },
  { date: '2025-04-11', quantity: -900, price: 149.6 },
  { date: '2025-04-16', quantity: -1000, price: 158.6 },
  { date: '2025-04-23', quantity: -1000, price: 159.55 },
  { date: '2025-04-25', quantity: -1000, price: 166.5 },
  { date: '2025-04-29', quantity: -1000, price: 170.4 },
  { date: '2025-04-29', quantity: -2000, price: 170.35 },
  { date: '2025-05-13', quantity: -2000, price: 192.3 },
  { date: '2025-09-19', quantity: 1000, price: 289.2 },     // 正 = SELL
  { date: '2025-09-19', quantity: 9000, price: 289 },
  { date: '2025-09-19', quantity: 1000, price: 288.95 },
  { date: '2025-09-19', quantity: 3000, price: 290.85 },
  { date: '2025-09-23', quantity: -1000, price: 299.25 },
  { date: '2025-09-24', quantity: -2000, price: 300.1 },
  { date: '2025-09-24', quantity: -3000, price: 301 },
  { date: '2025-09-26', quantity: -2000, price: 287.6 },
  { date: '2025-09-26', quantity: -3000, price: 289.15 },
  { date: '2025-10-07', quantity: -2000, price: 161.95 },   // 金額 -323900 / 股數 -2000
  { date: '2025-10-13', quantity: -2000, price: 318.5 },
  { date: '2025-10-27', quantity: 2000, price: 347.65 },    // 正 = SELL
];

async function main() {
  console.log('Starting transaction import...');
  console.log('Rule: 負股數 = 買入 (BUY), 正股數 = 賣出 (SELL)\n');

  // First, get the user (assuming there's only one user for now)
  const user = await db.query.users.findFirst();
  if (!user) {
    console.error('No user found! Please login first to create a user.');
    process.exit(1);
  }
  console.log(`Found user: ${user.email}`);

  // Find or create the stock
  let stock = await db.query.stocks.findFirst({
    where: and(eq(stocks.symbol, '00631L'), eq(stocks.market, 'TW')),
  });

  if (!stock) {
    const [newStock] = await db
      .insert(stocks)
      .values({
        symbol: '00631L',
        market: 'TW',
        name: 'Yuanta Daily Taiwan 50 Bull 2X ETF',
        nameTw: '元大台灣50正2',
      })
      .returning();
    stock = newStock;
    console.log('Created stock: 00631L');
  } else {
    console.log('Stock 00631L already exists');
  }

  // Insert transactions
  let successCount = 0;
  let totalQuantityBuy = 0;
  let totalQuantitySell = 0;
  let totalCostBuy = 0;

  for (const tx of transactionData) {
    // 負股數 = 買入, 正股數 = 賣出
    const type = tx.quantity < 0 ? 'BUY' : 'SELL';
    const absQuantity = Math.abs(tx.quantity);
    const grossAmount = absQuantity * tx.price;

    // Calculate fees for Taiwan stocks
    let brokerFee = Math.round(grossAmount * 0.001425);
    brokerFee = Math.max(brokerFee, 20);

    let tax = 0;
    if (type === 'SELL') {
      tax = Math.round(grossAmount * 0.001); // ETF tax is 0.1%
    }

    const totalAmount =
      type === 'BUY'
        ? grossAmount + brokerFee + tax
        : grossAmount - brokerFee - tax;

    try {
      await db.insert(transactions).values({
        userId: user.id,
        stockId: stock.id,
        type: type,
        quantity: absQuantity,
        price: tx.price.toString(),
        currency: 'TWD',
        transactionDate: tx.date,
        brokerFee: brokerFee.toString(),
        tax: tax.toString(),
        totalAmount: totalAmount.toString(),
        notes: 'Imported from spreadsheet',
      });

      if (type === 'BUY') {
        totalQuantityBuy += absQuantity;
        totalCostBuy += grossAmount;
      } else {
        totalQuantitySell += absQuantity;
      }
      successCount++;
      console.log(`✓ ${tx.date} ${type.padEnd(4)} ${absQuantity.toString().padStart(5)} @ ${tx.price}`);
    } catch (error) {
      console.error(`✗ Failed: ${tx.date} ${type} ${absQuantity}`, error);
    }
  }

  // Calculate net position
  const netQuantity = totalQuantityBuy - totalQuantitySell;
  const avgCost = totalQuantityBuy > 0 ? totalCostBuy / totalQuantityBuy : 0;

  console.log(`\n--- Summary ---`);
  console.log(`Total BUY:  ${totalQuantityBuy.toLocaleString()} shares`);
  console.log(`Total SELL: ${totalQuantitySell.toLocaleString()} shares`);
  console.log(`Net Position: ${netQuantity.toLocaleString()} shares`);
  console.log(`Avg Buy Cost: NT$${avgCost.toFixed(2)}`);
  console.log(`Imported: ${successCount}/${transactionData.length} transactions`);

  // Update or create holding
  const existingHolding = await db.query.holdings.findFirst({
    where: and(
      eq(holdings.userId, user.id),
      eq(holdings.stockId, stock.id)
    ),
  });

  if (netQuantity > 0) {
    if (existingHolding) {
      await db.update(holdings)
        .set({
          quantity: netQuantity,
          averageCost: avgCost.toFixed(2),
          totalCost: (netQuantity * avgCost).toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(holdings.id, existingHolding.id));
      console.log(`\nUpdated holding: ${netQuantity} shares @ avg NT$${avgCost.toFixed(2)}`);
    } else {
      await db.insert(holdings).values({
        userId: user.id,
        stockId: stock.id,
        quantity: netQuantity,
        averageCost: avgCost.toFixed(2),
        totalCost: (netQuantity * avgCost).toFixed(2),
        currency: 'TWD',
      });
      console.log(`\nCreated holding: ${netQuantity} shares @ avg NT$${avgCost.toFixed(2)}`);
    }
  } else if (netQuantity === 0) {
    if (existingHolding) {
      await db.delete(holdings).where(eq(holdings.id, existingHolding.id));
      console.log(`\nPosition closed (0 shares) - holding deleted`);
    }
  } else {
    console.log(`\nWarning: Net position is negative (${netQuantity}), something might be wrong`);
  }

  console.log('\nDone!');
  process.exit(0);
}

main().catch(console.error);
