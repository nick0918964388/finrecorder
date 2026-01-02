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
 * 取得用戶的績效指標
 */
export async function getUserPerformanceMetrics(userId: string): Promise<PerformanceMetrics> {
  // 取得淨值歷史
  const netValues = await db.query.dailyNetValues.findMany({
    where: eq(dailyNetValues.userId, userId),
    orderBy: [dailyNetValues.date],
  });

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

  // 計算今年以來報酬率
  const currentYear = new Date().getFullYear();
  const ytdStartValue = values.find(v => v.date.startsWith(`${currentYear}-`))?.value || startValue;
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

    const latestPrice = await getLatestStockPrice(holding.stockId);
    if (!latestPrice) continue;

    let valueTWD = latestPrice * holding.quantity;
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
 */
export async function getUserNetValueHistory(
  userId: string,
  days: number = 90
): Promise<NetValuePoint[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

  const netValues = await db.query.dailyNetValues.findMany({
    where: and(
      eq(dailyNetValues.userId, userId),
      gte(dailyNetValues.date, cutoffDateStr)
    ),
    orderBy: [dailyNetValues.date],
  });

  return netValues.map(v => ({
    date: v.date,
    value: parseFloat(v.totalValue),
    dailyReturn: v.dailyReturn ? parseFloat(v.dailyReturn) * 100 : null,
  }));
}

/**
 * 取得投資摘要
 */
export async function getUserInvestmentSummary(userId: string): Promise<{
  totalValue: number;
  totalCost: number;
  totalPnL: number;
  totalPnLPercent: number;
}> {
  // 取得持倉
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
 */
export async function getUserAnalytics(userId: string, days: number = 90): Promise<AnalyticsData> {
  const [metrics, allocation, netValueHistory, summary] = await Promise.all([
    getUserPerformanceMetrics(userId),
    getUserPortfolioAllocation(userId),
    getUserNetValueHistory(userId, days),
    getUserInvestmentSummary(userId),
  ]);

  return {
    metrics,
    allocation,
    netValueHistory,
    summary,
  };
}
