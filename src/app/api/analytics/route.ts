import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getUserAnalytics, type AnalyticsData } from '@/lib/services/analytics';

/**
 * GET /api/analytics
 * 取得用戶的資產分析資料
 *
 * Query Parameters:
 * - days: 歷史資料天數 (預設 90)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const days = parseInt(searchParams.get('days') || '90', 10);

    const analytics = await getUserAnalytics(session.user.id, days);

    return NextResponse.json(analytics);
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}
