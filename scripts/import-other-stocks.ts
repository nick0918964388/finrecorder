/**
 * 匯入其他股票交易資料
 * 執行方式: npx tsx scripts/import-other-stocks.ts
 */

import 'dotenv/config';
import { db } from '../src/db';
import { transactions, stocks, holdings, users } from '../src/db/schema';
import { eq, and } from 'drizzle-orm';

interface StockInfo {
  symbol: string;
  name: string;
  market: 'TW' | 'US';
}

interface TransactionData {
  stock: string;
  date: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: number;
}

const stocksInfo: StockInfo[] = [
  { symbol: '00926', name: '凱基台灣ESG永續高股息', market: 'TW' },
  { symbol: '00703L', name: '中信中國正二', market: 'TW' },
  { symbol: '2308', name: '台達電', market: 'TW' },
];

const transactionsToImport: TransactionData[] = [
  // 00926
  { stock: '00926', date: '2025-01-08', type: 'BUY', quantity: 36000, price: 22.10 },
  { stock: '00926', date: '2025-01-08', type: 'BUY', quantity: 100000, price: 22.11 },
  { stock: '00926', date: '2025-01-09', type: 'BUY', quantity: 23000, price: 22.08 },
  { stock: '00926', date: '2025-01-09', type: 'BUY', quantity: 100000, price: 22.08 },
  { stock: '00926', date: '2025-01-10', type: 'BUY', quantity: 50000, price: 22.08 },
  { stock: '00926', date: '2025-01-13', type: 'BUY', quantity: 8000, price: 21.86 },
  { stock: '00926', date: '2025-01-13', type: 'BUY', quantity: 20000, price: 21.88 },
  { stock: '00926', date: '2025-01-13', type: 'BUY', quantity: 10000, price: 21.86 },
  { stock: '00926', date: '2025-01-13', type: 'BUY', quantity: 10000, price: 21.87 },
  { stock: '00926', date: '2025-08-06', type: 'SELL', quantity: 357000, price: 22.00 },

  // 中信中國正二
  { stock: '00703L', date: '2025-09-08', type: 'BUY', quantity: 10000, price: 12.47 },
  { stock: '00703L', date: '2025-09-12', type: 'BUY', quantity: 20000, price: 13.49 },
  { stock: '00703L', date: '2025-10-27', type: 'SELL', quantity: 30000, price: 13.89 },

  // 台達電
  { stock: '2308', date: '2025-09-10', type: 'BUY', quantity: 300, price: 839 },
  { stock: '2308', date: '2025-09-19', type: 'SELL', quantity: 300, price: 890 },
];

async function getOrCreateStock(info: StockInfo): Promise<string> {
  let stock = await db.query.stocks.findFirst({
    where: and(eq(stocks.symbol, info.symbol), eq(stocks.market, info.market)),
  });

  if (!stock) {
    const [newStock] = await db.insert(stocks).values({
      symbol: info.symbol,
      market: info.market,
      name: info.name,
      nameTw: info.name,
    }).returning();
    stock = newStock;
    console.log(`  Created stock: ${info.symbol} (${info.name})`);
  }

  return stock.id;
}

async function importTransactions() {
  console.log('Starting import of transactions...\n');

  // 取得用戶
  const user = await db.query.users.findFirst();
  if (!user) {
    console.error('No user found');
    return;
  }
  console.log(`User: ${user.email}\n`);

  // 建立股票
  console.log('Creating/finding stocks...');
  const stockIdMap = new Map<string, string>();
  for (const info of stocksInfo) {
    const stockId = await getOrCreateStock(info);
    stockIdMap.set(info.symbol, stockId);
  }

  // 匯入交易
  console.log('\nImporting transactions...');
  let imported = 0;

  for (const tx of transactionsToImport) {
    const stockId = stockIdMap.get(tx.stock);
    if (!stockId) {
      console.error(`  Stock not found: ${tx.stock}`);
      continue;
    }

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
      stockId: stockId,
      type: tx.type,
      quantity: tx.quantity,
      price: tx.price.toString(),
      currency: 'TWD',
      transactionDate: tx.date,
      brokerFee: brokerFee.toString(),
      tax: tax.toString(),
      totalAmount: totalAmount.toString(),
    });

    console.log(`  ${tx.date} ${tx.stock} ${tx.type} ${tx.quantity} @ ${tx.price}`);
    imported++;
  }

  console.log(`\nImported ${imported} transactions`);

  // 更新持倉
  console.log('\nUpdating holdings...');

  // 按股票分組計算持倉
  const holdingsByStock = new Map<string, { quantity: number; totalCost: number }>();

  for (const tx of transactionsToImport) {
    const current = holdingsByStock.get(tx.stock) || { quantity: 0, totalCost: 0 };
    const grossAmount = tx.quantity * tx.price;
    let brokerFee = Math.round(grossAmount * 0.001425);
    brokerFee = Math.max(brokerFee, 20);

    if (tx.type === 'BUY') {
      const costWithFee = grossAmount + brokerFee;
      current.totalCost += costWithFee;
      current.quantity += tx.quantity;
    } else {
      // SELL - 按比例減少成本
      if (current.quantity > 0) {
        const avgCost = current.totalCost / current.quantity;
        current.quantity -= tx.quantity;
        current.totalCost = avgCost * current.quantity;
      }
    }

    holdingsByStock.set(tx.stock, current);
  }

  // 更新資料庫中的持倉
  for (const [symbol, holding] of holdingsByStock) {
    const stockId = stockIdMap.get(symbol);
    if (!stockId) continue;

    const existingHolding = await db.query.holdings.findFirst({
      where: and(eq(holdings.userId, user.id), eq(holdings.stockId, stockId)),
    });

    if (holding.quantity <= 0) {
      // 已清倉
      if (existingHolding) {
        await db.delete(holdings).where(eq(holdings.id, existingHolding.id));
        console.log(`  ${symbol}: Cleared (sold all)`);
      } else {
        console.log(`  ${symbol}: No holding (all sold)`);
      }
    } else {
      const avgCost = holding.totalCost / holding.quantity;

      if (existingHolding) {
        const newQuantity = existingHolding.quantity + holding.quantity;
        const newTotalCost = parseFloat(existingHolding.totalCost) + holding.totalCost;
        const newAvgCost = newTotalCost / newQuantity;

        await db.update(holdings).set({
          quantity: newQuantity,
          averageCost: newAvgCost.toString(),
          totalCost: newTotalCost.toString(),
          updatedAt: new Date(),
        }).where(eq(holdings.id, existingHolding.id));

        console.log(`  ${symbol}: Updated to ${newQuantity} shares @ ${newAvgCost.toFixed(4)}`);
      } else {
        await db.insert(holdings).values({
          userId: user.id,
          stockId: stockId,
          quantity: holding.quantity,
          averageCost: avgCost.toString(),
          totalCost: holding.totalCost.toString(),
          currency: 'TWD',
        });

        console.log(`  ${symbol}: Created ${holding.quantity} shares @ ${avgCost.toFixed(4)}`);
      }
    }
  }

  console.log('\nDone!');
  process.exit(0);
}

importTransactions().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
