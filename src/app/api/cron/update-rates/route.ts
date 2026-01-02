import { NextRequest, NextResponse } from 'next/server';
import { updateExchangeRate, getLatestUSDToTWDRate } from '@/lib/services/exchange-rate';

// 用於驗證 cron 請求的 secret
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * POST /api/cron/update-rates
 * 更新 USD/TWD 匯率
 *
 * 排程:
 * - 每日 10:00 + 16:00 台北時間
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

    // 執行匯率更新
    const result = await updateExchangeRate();

    const duration = Date.now() - startTime;

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          timestamp: new Date().toISOString(),
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Exchange rate updated',
      data: {
        usdToTwd: result.rate,
        source: result.source,
        durationMs: duration,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error updating exchange rate:', error);

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
 * GET /api/cron/update-rates
 * 取得當前匯率資訊
 */
export async function GET() {
  try {
    const currentRate = await getLatestUSDToTWDRate();

    return NextResponse.json({
      endpoint: '/api/cron/update-rates',
      method: 'POST',
      description: 'Updates USD/TWD exchange rate',
      schedule: 'Daily at 10:00 and 16:00 Taipei Time',
      authentication: CRON_SECRET ? 'Bearer token required' : 'No authentication',
      currentRate: currentRate,
    });
  } catch (error) {
    return NextResponse.json({
      endpoint: '/api/cron/update-rates',
      method: 'POST',
      description: 'Updates USD/TWD exchange rate',
      schedule: 'Daily at 10:00 and 16:00 Taipei Time',
      error: 'Could not fetch current rate',
    });
  }
}
