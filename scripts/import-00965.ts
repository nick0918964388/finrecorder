/**
 * 匯入 00965 交易資料
 * 執行方式: npx tsx scripts/import-00965.ts
 */

import 'dotenv/config';
import { db } from '../src/db';
import { transactions, stocks, holdings, users } from '../src/db/schema';
import { eq, and } from 'drizzle-orm';

interface TransactionData {
  date: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: number;
}

const transactionsToImport: TransactionData[] = [
  { date: '2025-08-06', type: 'BUY', quantity: 48000, price: 20.86 },
  { date: '2025-08-06', type: 'BUY', quantity: 100000, price: 20.86 },
  { date: '2025-08-07', type: 'BUY', quantity: 9000, price: 20.86 },
  { date: '2025-08-18', type: 'BUY', quantity: 24000, price: 20.78 },
  { date: '2025-08-19', type: 'BUY', quantity: 4000, price: 20.64 },
  { date: '2025-08-19', type: 'BUY', quantity: 20000, price: 20.65 },
  { date: '2025-09-03', type: 'SELL', quantity: 14000, price: 20.81 },
  { date: '2025-09-12', type: 'BUY', quantity: 10000, price: 21.51 },
];

const SYMBOL = '00965';
const MARKET = 'TW' as const;

async function importTransactions() {
  console.log('Starting import of 00965 transactions...\n');

  // 取得用戶
  const user = await db.query.users.findFirst();
  if (!user) {
    console.error('No user found');
    return;
  }
  console.log(`User: ${user.email}`);

  // 找或建立股票
  let stock = await db.query.stocks.findFirst({
    where: and(eq(stocks.symbol, SYMBOL), eq(stocks.market, MARKET)),
  });

  if (!stock) {
    const [newStock] = await db.insert(stocks).values({
      symbol: SYMBOL,
      market: MARKET,
      name: '復華台灣科技優息',
      nameTw: '復華台灣科技優息',
    }).returning();
    stock = newStock;
    console.log(`Created stock: ${SYMBOL}`);
  } else {
    console.log(`Found existing stock: ${SYMBOL}`);
  }

  // 匯入交易
  let imported = 0;
  for (const tx of transactionsToImport) {
    const grossAmount = tx.quantity * tx.price;

    // 計算手續費
    let brokerFee = Math.round(grossAmount * 0.001425);
    brokerFee = Math.max(brokerFee, 20);

    // 賣出才有證交稅
    const tax = tx.type === 'SELL' ? Math.round(grossAmount * 0.003) : 0;

    // 計算總金額
    const totalAmount = tx.type === 'BUY'
      ? grossAmount + brokerFee + tax
      : grossAmount - brokerFee - tax;

    await db.insert(transactions).values({
      userId: user.id,
      stockId: stock.id,
      type: tx.type,
      quantity: tx.quantity,
      price: tx.price.toString(),
      currency: 'TWD',
      transactionDate: tx.date,
      brokerFee: brokerFee.toString(),
      tax: tax.toString(),
      totalAmount: totalAmount.toString(),
    });

    console.log(`  ${tx.date} ${tx.type} ${tx.quantity} @ ${tx.price} = ${totalAmount.toFixed(0)}`);
    imported++;
  }

  console.log(`\nImported ${imported} transactions`);

  // 更新持倉
  console.log('\nUpdating holdings...');

  // 計算最終持倉
  let totalQuantity = 0;
  let totalCost = 0;

  for (const tx of transactionsToImport) {
    const grossAmount = tx.quantity * tx.price;
    let brokerFee = Math.round(grossAmount * 0.001425);
    brokerFee = Math.max(brokerFee, 20);

    if (tx.type === 'BUY') {
      const costWithFee = grossAmount + brokerFee;
      totalCost += costWithFee;
      totalQuantity += tx.quantity;
    } else {
      // SELL - 按比例減少成本
      const avgCost = totalCost / totalQuantity;
      totalQuantity -= tx.quantity;
      totalCost = avgCost * totalQuantity;
    }
  }

  const avgCost = totalQuantity > 0 ? totalCost / totalQuantity : 0;

  // 檢查是否已有持倉
  const existingHolding = await db.query.holdings.findFirst({
    where: and(eq(holdings.userId, user.id), eq(holdings.stockId, stock.id)),
  });

  if (existingHolding) {
    // 更新現有持倉
    const newQuantity = existingHolding.quantity + totalQuantity;
    const newTotalCost = parseFloat(existingHolding.totalCost) + totalCost;
    const newAvgCost = newTotalCost / newQuantity;

    await db.update(holdings).set({
      quantity: newQuantity,
      averageCost: newAvgCost.toString(),
      totalCost: newTotalCost.toString(),
      updatedAt: new Date(),
    }).where(eq(holdings.id, existingHolding.id));

    console.log(`Updated holding: ${newQuantity} shares @ avg ${newAvgCost.toFixed(4)}`);
  } else {
    // 建立新持倉
    await db.insert(holdings).values({
      userId: user.id,
      stockId: stock.id,
      quantity: totalQuantity,
      averageCost: avgCost.toString(),
      totalCost: totalCost.toString(),
      currency: 'TWD',
    });

    console.log(`Created holding: ${totalQuantity} shares @ avg ${avgCost.toFixed(4)}`);
  }

  console.log('\nDone!');
  process.exit(0);
}

importTransactions().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
