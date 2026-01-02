import { NextRequest, NextResponse } from 'next/server';
import { updateAllUserStockPrices } from '@/lib/services/stock-price';

// 用於驗證 cron 請求的 secret
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * POST /api/cron/update-prices
 * 更新所有股票的最新收盤價
 *
 * 排程:
 * - 台股: 每日 14:30 (收盤後)
 * - 美股: 每日 05:00 台北時間 (美股收盤後)
 */
export async function POST(request: NextRequest) {
  try {
    // 驗證請求來源 (如果設置了 CRON_SECRET)
    if (CRON_SECRET) {
      const authHeader = request.headers.get('authorization');
      if (authHeader !== `Bearer ${CRON_SECRET}`) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
    }

    const startTime = Date.now();

    // 執行股價更新
    const result = await updateAllUserStockPrices();

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      message: 'Stock prices updated',
      data: {
        twUpdated: result.twUpdated,
        usUpdated: result.usUpdated,
        totalUpdated: result.twUpdated + result.usUpdated,
        errors: result.errors,
        durationMs: duration,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error updating stock prices:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/cron/update-prices
 * 取得上次更新狀態 (用於監控)
 */
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/cron/update-prices',
    method: 'POST',
    description: 'Updates stock prices for all active stocks',
    schedule: {
      tw: 'Daily at 14:30 Taipei Time (after market close)',
      us: 'Daily at 05:00 Taipei Time (after US market close)',
    },
    authentication: CRON_SECRET ? 'Bearer token required' : 'No authentication',
  });
}
