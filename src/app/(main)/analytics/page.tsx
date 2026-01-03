'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  PieChart as PieChartIcon,
  Info,
  Calendar,
} from 'lucide-react';
import { PageLoading, Spinner } from '@/components/ui/spinner';

// Lazy load recharts components - they're heavy
const LazyLineChart = dynamic(() => import('recharts').then(mod => mod.LineChart), { ssr: false });
const LazyAreaChart = dynamic(() => import('recharts').then(mod => mod.AreaChart), { ssr: false });
const LazyPieChart = dynamic(() => import('recharts').then(mod => mod.PieChart), { ssr: false });
const LazyResponsiveContainer = dynamic(
  () => import('recharts').then(mod => mod.ResponsiveContainer),
  { ssr: false, loading: () => <div className="h-[200px] flex items-center justify-center"><Spinner /></div> }
);

// These are lighter, can import directly
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Pie,
  Cell,
  Legend,
  Area,
} from 'recharts';

// ============ TYPES ============

interface PerformanceMetrics {
  totalReturn: number;
  ytdReturn: number;
  cagr: number;
  volatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPeriod?: { start: string; end: string };
  tradingDays: number;
  winRate: number;
  bestDay: { date: string; return: number } | null;
  worstDay: { date: string; return: number } | null;
}

interface PortfolioAllocation {
  symbol: string;
  name: string;
  market: 'TW' | 'US';
  value: number;
  percentage: number;
  color: string;
}

interface NetValuePoint {
  date: string;
  value: number;
  dailyReturn: number | null;
}

interface AnalyticsData {
  metrics: PerformanceMetrics;
  allocation: PortfolioAllocation[];
  netValueHistory: NetValuePoint[];
  summary: {
    totalValue: number;
    totalCost: number;
    totalPnL: number;
    totalPnLPercent: number;
  };
  availableYears: number[];
  selectedYear: number | null;
}

// ============ FETCH FUNCTION ============

async function fetchAnalytics(days: number = 90, year: number | null = null): Promise<AnalyticsData> {
  const params = new URLSearchParams();
  params.set('days', days.toString());
  if (year) {
    params.set('year', year.toString());
  }
  const response = await fetch(`/api/analytics?${params.toString()}`);
  if (!response.ok) {
    throw new Error('Failed to fetch analytics');
  }
  return response.json();
}

// ============ FORMATTING HELPERS ============

function formatCurrency(amount: number): string {
  return `NT$${amount.toLocaleString('zh-TW', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatPercent(value: number, showSign: boolean = true): string {
  const sign = showSign && value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatNumber(value: number, decimals: number = 2): string {
  return value.toFixed(decimals);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// ============ COMPONENTS ============

function MetricCard({
  title,
  value,
  subtitle,
  isPositive,
  tooltip,
}: {
  title: string;
  value: string;
  subtitle?: string;
  isPositive?: boolean;
  tooltip?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          {title}
          {tooltip && (
            <span title={tooltip}>
              <Info className="h-3 w-3 text-muted-foreground/50" />
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`text-2xl font-bold ${
            isPositive === undefined
              ? ''
              : isPositive
              ? 'text-green-600'
              : 'text-red-600'
          }`}
        >
          {value}
        </div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

function NetValueChart({ data }: { data: NetValuePoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center border border-dashed rounded-lg">
        <p className="text-sm text-muted-foreground">尚無淨值資料</p>
      </div>
    );
  }

  const chartData = data.map(d => ({
    date: formatDate(d.date),
    value: d.value,
    fullDate: d.date,
  }));

  return (
    <LazyResponsiveContainer width="100%" height={200}>
      <LazyAreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
        <defs>
          <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `${(value / 10000).toFixed(0)}萬`}
          width={40}
        />
        <Tooltip
          formatter={(value) => [formatCurrency(value as number), '淨值']}
          labelFormatter={(label, payload) => {
            if (payload && payload[0]) {
              return payload[0].payload.fullDate;
            }
            return label;
          }}
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: '1px solid #e5e7eb',
          }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#3b82f6"
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#colorValue)"
        />
      </LazyAreaChart>
    </LazyResponsiveContainer>
  );
}

function AllocationPieChart({ data }: { data: PortfolioAllocation[] }) {
  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center border border-dashed rounded-lg">
        <p className="text-sm text-muted-foreground">尚無持倉資料</p>
      </div>
    );
  }

  const chartData = data.map(d => ({
    name: d.symbol,
    value: d.value,
    percentage: d.percentage,
    color: d.color,
  }));

  return (
    <LazyResponsiveContainer width="100%" height={200}>
      <LazyPieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={70}
          paddingAngle={2}
          dataKey="value"
          label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(1)}%`}
          labelLine={{ stroke: '#9ca3af', strokeWidth: 1 }}
        >
          {chartData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => [formatCurrency(value as number), '市值']}
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: '1px solid #e5e7eb',
          }}
        />
      </LazyPieChart>
    </LazyResponsiveContainer>
  );
}

function AllocationList({ data }: { data: PortfolioAllocation[] }) {
  if (data.length === 0) return null;

  return (
    <div className="space-y-2 mt-4">
      {data.map((item) => (
        <div key={item.symbol} className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: item.color }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium truncate">{item.symbol}</span>
              <span className="text-sm text-muted-foreground">
                {item.percentage.toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground truncate">
                {item.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatCurrency(item.value)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DailyReturnChart({ data }: { data: NetValuePoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center border border-dashed rounded-lg">
        <p className="text-sm text-muted-foreground">尚無日報酬資料</p>
      </div>
    );
  }

  const chartData = data
    .filter(d => d.dailyReturn !== null)
    .map(d => ({
      date: formatDate(d.date),
      return: d.dailyReturn,
      fullDate: d.date,
    }));

  return (
    <LazyResponsiveContainer width="100%" height={200}>
      <LazyAreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
        <defs>
          <linearGradient id="colorPositive" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorNegative" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `${value.toFixed(1)}%`}
          width={40}
        />
        <Tooltip
          formatter={(value) => [`${(value as number).toFixed(2)}%`, '日報酬']}
          labelFormatter={(label, payload) => {
            if (payload && payload[0]) {
              return payload[0].payload.fullDate;
            }
            return label;
          }}
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: '1px solid #e5e7eb',
          }}
        />
        <Area
          type="monotone"
          dataKey="return"
          stroke="#6366f1"
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#colorPositive)"
        />
      </LazyAreaChart>
    </LazyResponsiveContainer>
  );
}

// ============ MAIN PAGE ============

export default function AnalyticsPage() {
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['analytics', selectedYear],
    queryFn: () => fetchAnalytics(90, selectedYear),
  });

  // 當獲得可用年度後，自動選擇最新的年度 (如果尚未選擇)
  const availableYears = data?.availableYears || [];

  if (isLoading) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-6">
        <PageLoading message="載入分析資料..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-6">
        <Card>
          <CardContent className="py-12">
            <p className="text-sm text-destructive text-center">載入失敗，請重試</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const analytics = data!;
  const { metrics, allocation, netValueHistory, summary } = analytics;
  const hasData = netValueHistory.length > 0 || allocation.length > 0;

  return (
    <div className="container max-w-lg mx-auto px-4 py-6 space-y-6">
      {/* Header with Year Selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">資產分析</h2>
        {availableYears.length > 0 && (
          <Select
            value={selectedYear?.toString() || 'all'}
            onValueChange={(value) => setSelectedYear(value === 'all' ? null : parseInt(value, 10))}
          >
            <SelectTrigger className="w-[130px]">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue placeholder="選擇年度" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部期間</SelectItem>
              {availableYears.map((year) => (
                <SelectItem key={year} value={year.toString()}>
                  {year} 年
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Loading indicator for refetching */}
      {isFetching && !isLoading && (
        <div className="text-center text-sm text-muted-foreground">
          更新中...
        </div>
      )}

      {/* Summary Card */}
      {hasData && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {selectedYear ? `${selectedYear} 年度損益` : '投資損益'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {selectedYear ? formatCurrency(summary.totalValue) : formatCurrency(summary.totalValue)}
            </div>
            <div
              className={`flex items-center gap-2 mt-1 ${
                summary.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {summary.totalPnL >= 0 ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              <span className="text-sm font-medium">
                {summary.totalPnL >= 0 ? '+' : ''}
                {formatCurrency(summary.totalPnL)} ({formatPercent(summary.totalPnLPercent)})
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {selectedYear ? '期初淨值' : '投入成本'}：{formatCurrency(summary.totalCost)}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Performance Metrics */}
      <div className="grid grid-cols-2 gap-4">
        <MetricCard
          title={selectedYear ? `${selectedYear} 年報酬率` : '總報酬率'}
          value={formatPercent(metrics.totalReturn)}
          isPositive={metrics.totalReturn >= 0}
          tooltip={selectedYear ? `${selectedYear} 年度的累計報酬率` : '從開始記錄至今的累計報酬率'}
        />

        <MetricCard
          title="年化報酬率 (CAGR)"
          value={formatPercent(metrics.cagr)}
          isPositive={metrics.cagr >= 0}
          tooltip="複合年化成長率"
        />

        <MetricCard
          title="波動率"
          value={`${formatNumber(metrics.volatility)}%`}
          subtitle="年化標準差"
          tooltip="日報酬的年化標準差，衡量風險程度"
        />

        <MetricCard
          title="夏普比率"
          value={formatNumber(metrics.sharpeRatio)}
          isPositive={metrics.sharpeRatio >= 0}
          tooltip="(報酬率-無風險利率)/波動率，衡量風險調整後報酬"
        />

        <MetricCard
          title="最大回撤"
          value={`-${formatNumber(metrics.maxDrawdown)}%`}
          subtitle={
            metrics.maxDrawdownPeriod
              ? `${metrics.maxDrawdownPeriod.start} ~ ${metrics.maxDrawdownPeriod.end}`
              : undefined
          }
          isPositive={false}
          tooltip="從高點到低點的最大跌幅"
        />

        <MetricCard
          title="勝率"
          value={`${formatNumber(metrics.winRate)}%`}
          subtitle={`${metrics.tradingDays} 個交易日`}
          tooltip="正報酬天數佔比"
        />
      </div>

      {/* Best/Worst Day */}
      {(metrics.bestDay || metrics.worstDay) && (
        <div className="grid grid-cols-2 gap-4">
          {metrics.bestDay && (
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">最佳單日</p>
                <p className="text-lg font-bold text-green-600">
                  +{metrics.bestDay.return.toFixed(2)}%
                </p>
                <p className="text-xs text-muted-foreground">{metrics.bestDay.date}</p>
              </CardContent>
            </Card>
          )}
          {metrics.worstDay && (
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">最差單日</p>
                <p className="text-lg font-bold text-red-600">
                  {metrics.worstDay.return.toFixed(2)}%
                </p>
                <p className="text-xs text-muted-foreground">{metrics.worstDay.date}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Charts */}
      <Tabs defaultValue="trend">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="trend" className="flex items-center gap-1">
            <BarChart3 className="h-3 w-3" />
            <span>趨勢</span>
          </TabsTrigger>
          <TabsTrigger value="allocation" className="flex items-center gap-1">
            <PieChartIcon className="h-3 w-3" />
            <span>配置</span>
          </TabsTrigger>
          <TabsTrigger value="returns" className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            <span>報酬</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trend" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">資產趨勢</CardTitle>
            </CardHeader>
            <CardContent>
              <NetValueChart data={netValueHistory} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="allocation" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">持倉分布</CardTitle>
            </CardHeader>
            <CardContent>
              <AllocationPieChart data={allocation} />
              <AllocationList data={allocation} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="returns" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">日報酬率</CardTitle>
            </CardHeader>
            <CardContent>
              <DailyReturnChart data={netValueHistory} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Empty State */}
      {!hasData && (
        <Card>
          <CardContent className="py-12">
            <p className="text-sm text-muted-foreground text-center">
              需要更多交易記錄和淨值快照才能顯示完整分析
            </p>
            <p className="text-xs text-muted-foreground text-center mt-2">
              系統每日 22:00 會自動建立淨值快照
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
