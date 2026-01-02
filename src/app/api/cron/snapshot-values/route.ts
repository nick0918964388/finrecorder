import { NextRequest, NextResponse } from 'next/server';
import { snapshotAllUserNetValues } from '@/lib/services/net-value';

// 用於驗證 cron 請求的 secret
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * POST /api/cron/snapshot-values
 * 為所有用戶建立每日淨值快照
 *
 * 排程:
 * - 每日 22:00 台北時間 (股市收盤、匯率更新後)
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

    // 執行淨值快照
    const result = await snapshotAllUserNetValues();

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: result.success,
      message: result.success
        ? 'Net value snapshots created'
        : 'Completed with errors',
      data: {
        usersProcessed: result.usersProcessed,
        errors: result.errors,
        durationMs: duration,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error creating net value snapshots:', error);

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
 * GET /api/cron/snapshot-values
 * 取得快照任務資訊
 */
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/cron/snapshot-values',
    method: 'POST',
    description: 'Creates daily net value snapshots for all users with holdings',
    schedule: 'Daily at 22:00 Taipei Time',
    authentication: CRON_SECRET ? 'Bearer token required' : 'No authentication',
    note: 'Should run after stock prices and exchange rates are updated',
  });
}
