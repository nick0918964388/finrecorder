/**
 * 定時任務調度器
 *
 * 可以通過以下方式運行:
 * 1. 作為獨立的 Node.js 腳本: npx tsx src/lib/cron/scheduler.ts
 * 2. 通過 Docker 容器運行
 * 3. 通過外部 cron 服務 (如 Vercel Cron, GitHub Actions) 調用 API
 *
 * 排程:
 * - 台股收盤價: 每日 14:30 (週一至週五)
 * - 美股收盤價: 每日 05:00 (週二至週六，因美股為台北時間前一天)
 * - 匯率更新: 每日 10:00, 16:00
 * - 淨值快照: 每日 22:00
 */

import { schedule, ScheduledTask } from 'node-cron';

// API 基礎 URL
const API_BASE_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET;

// 任務記錄
interface TaskLog {
  task: string;
  startTime: Date;
  endTime?: Date;
  success: boolean;
  result?: unknown;
  error?: string;
}

const taskLogs: TaskLog[] = [];

/**
 * 調用 API 端點
 */
async function callAPI(endpoint: string): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const log: TaskLog = {
    task: endpoint,
    startTime: new Date(),
    success: false,
  };

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (CRON_SECRET) {
      headers['Authorization'] = `Bearer ${CRON_SECRET}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers,
    });

    const data = await response.json();

    log.success = response.ok && data.success;
    log.result = data;
    log.endTime = new Date();

    if (!log.success) {
      log.error = data.error || 'Request failed';
    }

    console.log(`[${new Date().toISOString()}] ${endpoint}: ${log.success ? 'SUCCESS' : 'FAILED'}`);
    if (data.data) {
      console.log(`  Data:`, JSON.stringify(data.data, null, 2));
    }

    return {
      success: log.success,
      data: data.data,
      error: log.error,
    };
  } catch (error) {
    log.success = false;
    log.error = error instanceof Error ? error.message : 'Unknown error';
    log.endTime = new Date();

    console.error(`[${new Date().toISOString()}] ${endpoint}: ERROR - ${log.error}`);

    return {
      success: false,
      error: log.error,
    };
  } finally {
    taskLogs.push(log);
    // 只保留最近 100 條記錄
    if (taskLogs.length > 100) {
      taskLogs.shift();
    }
  }
}

/**
 * 更新台股收盤價
 */
async function updateTWStockPrices() {
  console.log('\n=== Updating TW Stock Prices ===');
  return callAPI('/api/cron/update-prices');
}

/**
 * 更新美股收盤價
 */
async function updateUSStockPrices() {
  console.log('\n=== Updating US Stock Prices ===');
  return callAPI('/api/cron/update-prices');
}

/**
 * 更新匯率
 */
async function updateExchangeRates() {
  console.log('\n=== Updating Exchange Rates ===');
  return callAPI('/api/cron/update-rates');
}

/**
 * 建立淨值快照
 */
async function snapshotNetValues() {
  console.log('\n=== Creating Net Value Snapshots ===');
  return callAPI('/api/cron/snapshot-values');
}

/**
 * 初始化定時任務
 */
export function initScheduler(): ScheduledTask[] {
  const tasks: ScheduledTask[] = [];

  console.log('Initializing scheduler...');
  console.log(`API Base URL: ${API_BASE_URL}`);
  console.log(`CRON_SECRET: ${CRON_SECRET ? 'Set' : 'Not set'}`);

  // 台股收盤價更新: 每日 14:30 (週一至週五)
  // Cron: 分 時 日 月 週
  tasks.push(
    schedule('30 14 * * 1-5', async () => {
      await updateTWStockPrices();
    }, {
      timezone: 'Asia/Taipei',
    })
  );
  console.log('Scheduled: TW Stock Prices - 14:30 Mon-Fri (Taipei Time)');

  // 美股收盤價更新: 每日 05:00 (週二至週六)
  // 美股收盤時間約為台北時間 04:00-05:00
  tasks.push(
    schedule('0 5 * * 2-6', async () => {
      await updateUSStockPrices();
    }, {
      timezone: 'Asia/Taipei',
    })
  );
  console.log('Scheduled: US Stock Prices - 05:00 Tue-Sat (Taipei Time)');

  // 匯率更新: 每日 10:00
  tasks.push(
    schedule('0 10 * * *', async () => {
      await updateExchangeRates();
    }, {
      timezone: 'Asia/Taipei',
    })
  );
  console.log('Scheduled: Exchange Rates - 10:00 Daily (Taipei Time)');

  // 匯率更新: 每日 16:00
  tasks.push(
    schedule('0 16 * * *', async () => {
      await updateExchangeRates();
    }, {
      timezone: 'Asia/Taipei',
    })
  );
  console.log('Scheduled: Exchange Rates - 16:00 Daily (Taipei Time)');

  // 淨值快照: 每日 22:00
  tasks.push(
    schedule('0 22 * * *', async () => {
      await snapshotNetValues();
    }, {
      timezone: 'Asia/Taipei',
    })
  );
  console.log('Scheduled: Net Value Snapshots - 22:00 Daily (Taipei Time)');

  console.log('\nScheduler initialized. Waiting for scheduled tasks...\n');

  return tasks;
}

/**
 * 停止所有定時任務
 */
export function stopScheduler(tasks: ScheduledTask[]) {
  tasks.forEach(task => task.stop());
  console.log('Scheduler stopped.');
}

/**
 * 手動執行所有任務 (用於測試)
 */
export async function runAllTasksNow() {
  console.log('Running all tasks manually...');

  await updateExchangeRates();
  await updateTWStockPrices();
  await updateUSStockPrices();
  await snapshotNetValues();

  console.log('All tasks completed.');
}

/**
 * 取得任務執行記錄
 */
export function getTaskLogs(): TaskLog[] {
  return [...taskLogs];
}

// 如果直接執行此腳本，啟動調度器
if (require.main === module) {
  console.log('Starting FinRecorder Cron Scheduler...\n');

  const tasks = initScheduler();

  // 優雅關閉
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT. Shutting down...');
    stopScheduler(tasks);
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM. Shutting down...');
    stopScheduler(tasks);
    process.exit(0);
  });

  // 保持進程運行
  console.log('Scheduler is running. Press Ctrl+C to stop.\n');
}
