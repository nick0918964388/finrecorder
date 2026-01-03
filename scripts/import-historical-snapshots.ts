/**
 * 匯入歷史淨資產快照
 * 執行方式: npx tsx scripts/import-historical-snapshots.ts
 */

import 'dotenv/config';
import { db } from '../src/db';
import { dailyNetValues, users } from '../src/db/schema';
import { eq } from 'drizzle-orm';

interface HistoricalSnapshot {
  date: string;
  totalValue: number;
}

const snapshots: HistoricalSnapshot[] = [
  { date: '2022-03-17', totalValue: 3808000 },
  { date: '2022-05-21', totalValue: 3078040 },
  { date: '2022-07-23', totalValue: 3376830 },
  { date: '2023-01-01', totalValue: 2950117 },
  { date: '2023-06-30', totalValue: 3402247 },
  { date: '2024-01-01', totalValue: 3271505 },
  { date: '2024-02-21', totalValue: 4999140 },
  { date: '2024-05-16', totalValue: 13159296 },
  { date: '2024-07-27', totalValue: 10650878 },
  { date: '2024-12-26', totalValue: 10286843 },
];

async function importSnapshots() {
  console.log('Importing historical net value snapshots...\n');

  // 取得用戶
  const user = await db.query.users.findFirst();
  if (!user) {
    console.error('No user found');
    return;
  }
  console.log(`User: ${user.email}\n`);

  // 按日期排序
  const sortedSnapshots = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));

  let previousValue: number | null = null;
  let firstValue: number | null = null;

  for (const snapshot of sortedSnapshots) {
    // 計算日報酬率
    let dailyReturn: number | undefined;
    let cumulativeReturn: number | undefined;

    if (previousValue !== null && previousValue > 0) {
      dailyReturn = (snapshot.totalValue - previousValue) / previousValue;
    }

    if (firstValue === null) {
      firstValue = snapshot.totalValue;
    } else if (firstValue > 0) {
      cumulativeReturn = (snapshot.totalValue - firstValue) / firstValue;
    }

    await db.insert(dailyNetValues).values({
      userId: user.id,
      date: snapshot.date,
      twStockValue: snapshot.totalValue.toFixed(2), // 假設全部是台股
      usStockValue: '0',
      totalValue: snapshot.totalValue.toFixed(2),
      usdToTwdRate: '32.0000',
      dailyReturn: dailyReturn?.toFixed(6),
      cumulativeReturn: cumulativeReturn?.toFixed(6),
    }).onConflictDoUpdate({
      target: [dailyNetValues.userId, dailyNetValues.date],
      set: {
        twStockValue: snapshot.totalValue.toFixed(2),
        totalValue: snapshot.totalValue.toFixed(2),
        dailyReturn: dailyReturn?.toFixed(6),
        cumulativeReturn: cumulativeReturn?.toFixed(6),
      },
    });

    console.log(`  ${snapshot.date}: ${snapshot.totalValue.toLocaleString()} TWD`);
    previousValue = snapshot.totalValue;
  }

  console.log(`\nImported ${snapshots.length} historical snapshots`);
  console.log('\nDone!');
  process.exit(0);
}

importSnapshots().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
