import { db } from '@/db';
import { dailyNetValues, holdings, transactions, stocks } from '@/db/schema';
import { eq, desc, and, gte, sql } from 'drizzle-orm';
import { getUSDToTWDRate } from './exchange-rate';
import { getLatestStockPrice } from './stock-price';

// ============ TYPES ============

export interface PerformanceMetrics {
  // 報酬率指標
  totalReturn: number; // 總報酬率 (%)
  ytdReturn: number; // 今年以來報酬率 (%)
  cagr: number; // 年化報酬率 (%)

  // 風險指標
  volatility: number; // 年化波動率 (%)
  sharpeRatio: number; // 夏普比率
  maxDrawdown: number; // 最大回撤 (%)
  maxDrawdownPeriod?: {
    start: string;
    end: string;
  };

  // 統計數據
  tradingDays: number; // 記錄天數
  winRate: number; // 正報酬天數比例 (%)
  bestDay: { date: string; return: number } | null;
  worstDay: { date: string; return: number } | null;
}

export interface PortfolioAllocation {
  symbol: string;
  name: string;
  market: 'TW' | 'US';
  value: number; // 市值 (TWD)
  percentage: number; // 佔比 (%)
  color: string;
}

export interface NetValuePoint {
  date: string;
  value: number;
  dailyReturn: number | null;
}

export interface AnalyticsData {
  metrics: PerformanceMetrics;
  allocation: PortfolioAllocation[];
  netValueHistory: NetValuePoint[];
  summary: {
    totalValue: number;
    totalCost: number;
    totalPnL: number;
    totalPnLPercent: number;
  };
  availableYears: number[]; // 有資料的年度列表
  selectedYear: number | null; // 當前選擇的年度
}

// ============ CONSTANTS ============

// 無風險利率 (使用台灣央行一年期定存利率約 1.5%)
const RISK_FREE_RATE = 0.015;

// 交易日天數 (一年約 252 個交易日)
const TRADING_DAYS_PER_YEAR = 252;

// 圖表顏色
const CHART_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1', // indigo
];

// ============ PERFORMANCE CALCULATIONS ============

/**
 * 計算年化報酬率 (CAGR)
 * CAGR = (終值 / 初值)^(1/年數) - 1
 */
export function calculateCAGR(startValue: number, endValue: number, years: number): number {
  if (startValue <= 0 || years <= 0) return 0;
  return (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
}

/**
 * 計算年化波動率
 * 年化波動率 = 日報酬標準差 × √252
 */
export function calculateVolatility(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0;

  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (dailyReturns.length - 1);
  const stdDev = Math.sqrt(variance);

  return stdDev * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;
}

/**
 * 計算夏普比率
 * Sharpe Ratio = (年化報酬率 - 無風險利率) / 年化波動率
 */
export function calculateSharpeRatio(annualizedReturn: number, volatility: number): number {
  if (volatility === 0) return 0;
  return (annualizedReturn / 100 - RISK_FREE_RATE) / (volatility / 100);
}

/**
 * 計算最大回撤
 * Max Drawdown = (峰值 - 谷值) / 峰值
 */
export function calculateMaxDrawdown(values: { date: string; value: number }[]): {
  maxDrawdown: number;
  period?: { start: string; end: string };
} {
  if (values.length < 2) return { maxDrawdown: 0 };

  let maxDrawdown = 0;
  let peak = values[0].value;
  let peakDate = values[0].date;
  let drawdownStart = values[0].date;
  let drawdownEnd = values[0].date;
  let currentDrawdownStart = values[0].date;

  for (const point of values) {
    if (point.value > peak) {
      peak = point.value;
      peakDate = point.date;
      currentDrawdownStart = point.date;
    }

    const drawdown = (peak - point.value) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      drawdownStart = currentDrawdownStart;
      drawdownEnd = point.date;
    }
  }

  return {
    maxDrawdown: maxDrawdown * 100,
    period:
      maxDrawdown > 0
        ? { start: drawdownStart, end: drawdownEnd }
        : undefined,
  };
}

/**
 * 計算勝率和最佳/最差日
 */
export function calculateDailyStats(dailyReturns: { date: string; return: number }[]): {
  winRate: number;
  bestDay: { date: string; return: number } | null;
  worstDay: { date: string; return: number } | null;
} {
  if (dailyReturns.length === 0) {
    return { winRate: 0, bestDay: null, worstDay: null };
  }

  const winningDays = dailyReturns.filter(d => d.return > 0).length;
  const winRate = (winningDays / dailyReturns.length) * 100;

  const sorted = [...dailyReturns].sort((a, b) => b.return - a.return);

  return {
    winRate,
    bestDay: sorted[0],
    worstDay: sorted[sorted.length - 1],
  };
}

// ============ DATA FETCHING ============

/**
 * 取得用戶有淨值資料的年度列表
 */
export async function getUserAvailableYears(userId: string): Promise<number[]> {
  const netValues = await db.query.dailyNetValues.findMany({
    where: eq(dailyNetValues.userId, userId),
    columns: { date: true },
    orderBy: [dailyNetValues.date],
  });

  if (netValues.length === 0) return [];

  const years = new Set<number>();
  for (const v of netValues) {
    years.add(parseInt(v.date.split('-')[0], 10));
  }

  return Array.from(years).sort((a, b) => b - a); // 降序排列
}

/**
 * 取得用戶的績效指標
 * @param userId 用戶 ID
 * @param year 指定年度，null 表示全部資料
 */
export async function getUserPerformanceMetrics(userId: string, year: number | null = null): Promise<PerformanceMetrics> {
  // 取得淨值歷史
  let netValues;
  if (year) {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    netValues = await db.query.dailyNetValues.findMany({
      where: and(
        eq(dailyNetValues.userId, userId),
        gte(dailyNetValues.date, startDate),
        sql`${dailyNetValues.date} <= ${endDate}`
      ),
      orderBy: [dailyNetValues.date],
    });
  } else {
    netValues = await db.query.dailyNetValues.findMany({
      where: eq(dailyNetValues.userId, userId),
      orderBy: [dailyNetValues.date],
    });
  }

  if (netValues.length === 0) {
    return {
      totalReturn: 0,
      ytdReturn: 0,
      cagr: 0,
      volatility: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      tradingDays: 0,
      winRate: 0,
      bestDay: null,
      worstDay: null,
    };
  }

  // 準備數據
  const values = netValues.map(v => ({
    date: v.date,
    value: parseFloat(v.totalValue),
    dailyReturn: v.dailyReturn ? parseFloat(v.dailyReturn) : null,
  }));

  const dailyReturns = values
    .filter(v => v.dailyReturn !== null)
    .map(v => ({
      date: v.date,
      return: v.dailyReturn! * 100,
    }));

  // 計算總報酬率
  const startValue = values[0].value;
  const endValue = values[values.length - 1].value;
  const totalReturn = startValue > 0 ? ((endValue - startValue) / startValue) * 100 : 0;

  // 計算今年以來報酬率 (如果有指定年度，則為該年度報酬率)
  const targetYear = year || new Date().getFullYear();
  const ytdStartValue = values.find(v => v.date.startsWith(`${targetYear}-`))?.value || startValue;
  const ytdReturn = ytdStartValue > 0 ? ((endValue - ytdStartValue) / ytdStartValue) * 100 : 0;

  // 計算年數
  const startDate = new Date(values[0].date);
  const endDate = new Date(values[values.length - 1].date);
  const years = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  // 計算各項指標
  const cagr = calculateCAGR(startValue, endValue, years);
  const volatility = calculateVolatility(dailyReturns.map(d => d.return / 100));
  const sharpeRatio = calculateSharpeRatio(cagr, volatility);
  const { maxDrawdown, period } = calculateMaxDrawdown(values);
  const { winRate, bestDay, worstDay } = calculateDailyStats(dailyReturns);

  return {
    totalReturn,
    ytdReturn,
    cagr,
    volatility,
    sharpeRatio,
    maxDrawdown,
    maxDrawdownPeriod: period,
    tradingDays: values.length,
    winRate,
    bestDay,
    worstDay,
  };
}

/**
 * 取得持倉分布
 */
export async function getUserPortfolioAllocation(userId: string): Promise<PortfolioAllocation[]> {
  // 取得用戶持倉
  const userHoldings = await db.query.holdings.findMany({
    where: eq(holdings.userId, userId),
    with: {
      stock: true,
    },
  });

  if (userHoldings.length === 0) return [];

  const usdToTwd = await getUSDToTWDRate();
  const allocations: PortfolioAllocation[] = [];
  let totalValue = 0;

  // 計算每個持倉的市值
  for (const holding of userHoldings) {
    if (holding.quantity <= 0) continue;

    // 優先使用最新市價，若無則使用持倉均價
    const latestPrice = await getLatestStockPrice(holding.stockId);
    const price = latestPrice ?? parseFloat(holding.averageCost);
    let valueTWD = price * holding.quantity;
    if (holding.stock.market === 'US') {
      valueTWD *= usdToTwd;
    }

    totalValue += valueTWD;

    allocations.push({
      symbol: holding.stock.symbol,
      name: holding.stock.nameTw || holding.stock.name || holding.stock.symbol,
      market: holding.stock.market,
      value: valueTWD,
      percentage: 0, // 待計算
      color: CHART_COLORS[allocations.length % CHART_COLORS.length],
    });
  }

  // 計算百分比
  for (const alloc of allocations) {
    alloc.percentage = totalValue > 0 ? (alloc.value / totalValue) * 100 : 0;
  }

  // 按市值排序
  return allocations.sort((a, b) => b.value - a.value);
}

/**
 * 取得淨值歷史 (用於圖表)
 * @param userId 用戶 ID
 * @param days 歷史天數 (如果指定 year 則忽略此參數)
 * @param year 指定年度，null 表示使用 days 參數
 */
export async function getUserNetValueHistory(
  userId: string,
  days: number = 90,
  year: number | null = null
): Promise<NetValuePoint[]> {
  let netValues;

  if (year) {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    netValues = await db.query.dailyNetValues.findMany({
      where: and(
        eq(dailyNetValues.userId, userId),
        gte(dailyNetValues.date, startDate),
        sql`${dailyNetValues.date} <= ${endDate}`
      ),
      orderBy: [dailyNetValues.date],
    });
  } else {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    netValues = await db.query.dailyNetValues.findMany({
      where: and(
        eq(dailyNetValues.userId, userId),
        gte(dailyNetValues.date, cutoffDateStr)
      ),
      orderBy: [dailyNetValues.date],
    });
  }

  return netValues.map(v => ({
    date: v.date,
    value: parseFloat(v.totalValue),
    dailyReturn: v.dailyReturn ? parseFloat(v.dailyReturn) * 100 : null,
  }));
}

/**
 * 取得投資摘要
 * @param userId 用戶 ID
 * @param year 指定年度，null 表示使用當前持倉計算
 */
export async function getUserInvestmentSummary(userId: string, year: number | null = null): Promise<{
  totalValue: number;
  totalCost: number;
  totalPnL: number;
  totalPnLPercent: number;
}> {
  // 如果指定年度，從淨值快照計算該年度的投資損益
  if (year) {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    // 取得該年度的淨值快照
    const yearSnapshots = await db.query.dailyNetValues.findMany({
      where: and(
        eq(dailyNetValues.userId, userId),
        gte(dailyNetValues.date, startDate),
        sql`${dailyNetValues.date} <= ${endDate}`
      ),
      orderBy: [dailyNetValues.date],
    });

    if (yearSnapshots.length === 0) {
      return { totalValue: 0, totalCost: 0, totalPnL: 0, totalPnLPercent: 0 };
    }

    // 期初值和期末值
    const startValue = parseFloat(yearSnapshots[0].totalValue);
    const endValue = parseFloat(yearSnapshots[yearSnapshots.length - 1].totalValue);

    // 對於歷史年度，損益 = 期末值 - 期初值
    const totalPnL = endValue - startValue;
    const totalPnLPercent = startValue > 0 ? (totalPnL / startValue) * 100 : 0;

    return {
      totalValue: endValue,
      totalCost: startValue, // 使用期初值作為「成本」
      totalPnL,
      totalPnLPercent,
    };
  }

  // 如果沒有指定年度，使用當前持倉計算
  const userHoldings = await db.query.holdings.findMany({
    where: eq(holdings.userId, userId),
    with: {
      stock: true,
    },
  });

  if (userHoldings.length === 0) {
    return { totalValue: 0, totalCost: 0, totalPnL: 0, totalPnLPercent: 0 };
  }

  const usdToTwd = await getUSDToTWDRate();
  let totalValue = 0;
  let totalCost = 0;

  for (const holding of userHoldings) {
    if (holding.quantity <= 0) continue;

    const latestPrice = await getLatestStockPrice(holding.stockId);
    const cost = parseFloat(holding.totalCost);
    let valueTWD = (latestPrice || parseFloat(holding.averageCost)) * holding.quantity;
    let costTWD = cost;

    if (holding.stock.market === 'US') {
      valueTWD *= usdToTwd;
      costTWD *= usdToTwd;
    }

    totalValue += valueTWD;
    totalCost += costTWD;
  }

  const totalPnL = totalValue - totalCost;
  const totalPnLPercent = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

  return { totalValue, totalCost, totalPnL, totalPnLPercent };
}

/**
 * 取得完整的分析資料
 * @param userId 用戶 ID
 * @param days 歷史天數 (如果指定 year 則忽略此參數)
 * @param year 指定年度，null 表示使用 days 參數
 */
export async function getUserAnalytics(userId: string, days: number = 90, year: number | null = null): Promise<AnalyticsData> {
  const [metrics, allocation, netValueHistory, summary, availableYears] = await Promise.all([
    getUserPerformanceMetrics(userId, year),
    getUserPortfolioAllocation(userId),
    getUserNetValueHistory(userId, days, year),
    getUserInvestmentSummary(userId, year),
    getUserAvailableYears(userId),
  ]);

  return {
    metrics,
    allocation,
    netValueHistory,
    summary,
    availableYears,
    selectedYear: year,
  };
}
