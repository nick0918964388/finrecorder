'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Activity,
  ArrowRight,
  Loader2,
} from 'lucide-react';

interface PortfolioSummary {
  totalCostTWD: number;
  totalValueTWD: number;
  totalUnrealizedPnL: number;
  totalUnrealizedPnLPercent: number;
  twStockValue: number;
  usStockValue: number;
  usdToTwdRate: number;
  holdings: Array<{
    holding: { id: string; quantity: number; currency: 'TWD' | 'USD' };
    stock: { symbol: string; market: 'TW' | 'US'; name: string | null };
    marketValue: number;
    unrealizedPnL: number;
    unrealizedPnLPercent: number;
  }>;
}

interface AnalyticsData {
  metrics: {
    cagr: number;
    volatility: number;
    totalReturn: number;
  };
  summary: {
    totalValue: number;
    totalPnL: number;
    totalPnLPercent: number;
  };
}

interface Transaction {
  id: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: string;
  transactionDate: string;
  stock: { symbol: string; market: 'TW' | 'US' };
}

async function fetchPortfolio(): Promise<PortfolioSummary> {
  const res = await fetch('/api/portfolio');
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
}

async function fetchAnalytics(): Promise<AnalyticsData> {
  const res = await fetch('/api/analytics?days=30');
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
}

async function fetchTransactions(): Promise<Transaction[]> {
  const res = await fetch('/api/transactions?limit=5');
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
}

function formatCurrency(amount: number, currency: 'TWD' | 'USD' = 'TWD'): string {
  if (currency === 'USD') {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `NT$${amount.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export default function DashboardPage() {
  const { data: portfolio, isLoading: portfolioLoading } = useQuery({
    queryKey: ['portfolio'],
    queryFn: fetchPortfolio,
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['analytics-dashboard'],
    queryFn: fetchAnalytics,
  });

  const { data: transactions, isLoading: transactionsLoading } = useQuery({
    queryKey: ['transactions-recent'],
    queryFn: fetchTransactions,
  });

  const isLoading = portfolioLoading || analyticsLoading;
  const hasHoldings = portfolio && portfolio.holdings.length > 0;
  const isProfit = portfolio ? portfolio.totalUnrealizedPnL >= 0 : true;

  return (
    <div className="container max-w-lg mx-auto px-4 py-6 space-y-6">
      {/* Total Assets Card */}
      <Card className="bg-gradient-to-br from-slate-900 to-slate-800 text-white border-0">
        <CardContent className="pt-6 pb-6">
          <p className="text-sm text-slate-300 mb-1">總資產</p>
          {isLoading ? (
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          ) : (
            <>
              <div className="text-3xl font-bold tracking-tight">
                {formatCurrency(portfolio?.totalValueTWD || 0)}
              </div>
              {hasHoldings && (
                <div className={`flex items-center gap-1.5 mt-2 ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isProfit ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  <span className="text-sm font-medium">
                    {formatCurrency(portfolio?.totalUnrealizedPnL || 0)}
                  </span>
                  <span className="text-sm opacity-80">
                    ({formatPercent(portfolio?.totalUnrealizedPnLPercent || 0)})
                  </span>
                </div>
              )}
              {!hasHoldings && (
                <p className="text-sm text-slate-400 mt-2">尚無持倉</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" />
              <span className="text-xs">台股</span>
            </div>
            <div className="text-lg font-semibold mt-1">
              {isLoading ? '--' : formatCurrency(portfolio?.twStockValue || 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" />
              <span className="text-xs">美股</span>
            </div>
            <div className="text-lg font-semibold mt-1">
              {isLoading ? '--' : formatCurrency((portfolio?.usStockValue || 0) * (portfolio?.usdToTwdRate || 1))}
            </div>
            {portfolio && portfolio.usStockValue > 0 && (
              <p className="text-xs text-muted-foreground">
                ${portfolio.usStockValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" />
              <span className="text-xs">年化報酬</span>
            </div>
            <div className={`text-lg font-semibold mt-1 ${
              analytics?.metrics?.cagr !== undefined
                ? analytics.metrics.cagr >= 0 ? 'text-green-600' : 'text-red-600'
                : ''
            }`}>
              {analyticsLoading || analytics?.metrics?.cagr === undefined
                ? '-- %'
                : formatPercent(analytics.metrics.cagr)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Activity className="h-3.5 w-3.5" />
              <span className="text-xs">波動率</span>
            </div>
            <div className="text-lg font-semibold mt-1">
              {analyticsLoading || analytics?.metrics?.volatility === undefined
                ? '-- %'
                : `${analytics.metrics.volatility.toFixed(2)}%`}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Holdings */}
      {hasHoldings && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">持倉</CardTitle>
              <Link
                href="/portfolio"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                查看全部
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {portfolio.holdings.slice(0, 3).map((item) => {
              const pnlPositive = item.unrealizedPnL >= 0;
              return (
                <div key={item.holding.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{item.stock.symbol}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {item.stock.market === 'TW' ? '台' : '美'}
                    </Badge>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      {formatCurrency(item.marketValue, item.holding.currency)}
                    </p>
                    <p className={`text-xs ${pnlPositive ? 'text-green-600' : 'text-red-600'}`}>
                      {formatPercent(item.unrealizedPnLPercent)}
                    </p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Recent Transactions */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">最近交易</CardTitle>
            <Link
              href="/transactions"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              查看全部
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {transactionsLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : transactions && transactions.length > 0 ? (
            <div className="space-y-3">
              {transactions.slice(0, 3).map((tx) => (
                <div key={tx.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={tx.type === 'BUY' ? 'default' : 'secondary'}
                      className="text-[10px] px-1.5 py-0"
                    >
                      {tx.type === 'BUY' ? '買' : '賣'}
                    </Badge>
                    <span className="font-medium">{tx.stock.symbol}</span>
                    <span className="text-xs text-muted-foreground">
                      {tx.quantity}股
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm">{tx.transactionDate}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">
              尚無交易記錄
            </p>
          )}
        </CardContent>
      </Card>

      {/* Empty State CTA */}
      {!hasHoldings && !transactionsLoading && (!transactions || transactions.length === 0) && (
        <div className="text-center py-4">
          <Link
            href="/transactions/new"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            新增第一筆交易
          </Link>
        </div>
      )}
    </div>
  );
}
