'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { PageLoading } from '@/components/ui/spinner';

interface HoldingWithStock {
  holding: {
    id: string;
    quantity: number;
    averageCost: string;
    totalCost: string;
    currency: 'TWD' | 'USD';
  };
  stock: {
    id: string;
    symbol: string;
    market: 'TW' | 'US';
    name: string | null;
    nameTw: string | null;
  };
  currentPrice: string | null;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
}

interface PortfolioSummary {
  totalCostTWD: number;
  totalValueTWD: number;
  totalUnrealizedPnL: number;
  totalUnrealizedPnLPercent: number;
  twStockValue: number;
  usStockValue: number;
  usdToTwdRate: number;
  holdings: HoldingWithStock[];
}

async function fetchPortfolio(): Promise<PortfolioSummary> {
  const response = await fetch('/api/portfolio');
  if (!response.ok) {
    throw new Error('Failed to fetch portfolio');
  }
  return response.json();
}

function formatCurrency(amount: number, currency: 'TWD' | 'USD' = 'TWD'): string {
  if (currency === 'TWD') {
    return `NT$${amount.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPrice(price: string | number, currency: 'TWD' | 'USD'): string {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (currency === 'TWD') {
    return `NT$${num.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function HoldingCard({ item }: { item: HoldingWithStock }) {
  const { holding, stock, currentPrice, marketValue, unrealizedPnL, unrealizedPnLPercent } = item;
  const isProfit = unrealizedPnL >= 0;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-lg">{stock.symbol}</span>
              <Badge variant="outline" className="text-xs">
                {stock.market === 'TW' ? '台股' : '美股'}
              </Badge>
            </div>
            {(stock.nameTw || stock.name) && (
              <p className="text-sm text-muted-foreground">
                {stock.nameTw || stock.name}
              </p>
            )}
            <div className="mt-2 text-sm text-muted-foreground">
              <span>{holding.quantity.toLocaleString()} 股</span>
              <span className="mx-2">·</span>
              <span>均價 {formatPrice(holding.averageCost, holding.currency)}</span>
            </div>
          </div>
          <div className="text-right">
            <p className="font-semibold">
              {formatCurrency(marketValue, holding.currency)}
            </p>
            <div className={`flex items-center justify-end gap-1 text-sm ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
              {isProfit ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              <span>
                {isProfit ? '+' : ''}
                {formatCurrency(unrealizedPnL, holding.currency)}
              </span>
              <span className="text-xs">({formatPercent(unrealizedPnLPercent)})</span>
            </div>
            {currentPrice && (
              <p className="text-xs text-muted-foreground mt-1">
                現價 {formatPrice(currentPrice, holding.currency)}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HoldingsList({ holdings, market }: { holdings: HoldingWithStock[]; market?: 'TW' | 'US' }) {
  const filtered = market ? holdings.filter(h => h.stock.market === market) : holdings;

  if (filtered.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <p className="text-sm text-muted-foreground text-center">
            {market === 'TW' ? '尚無台股持倉' : market === 'US' ? '尚無美股持倉' : '尚無持倉'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {filtered.map((item) => (
        <HoldingCard key={item.holding.id} item={item} />
      ))}
    </div>
  );
}

export default function PortfolioPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['portfolio'],
    queryFn: fetchPortfolio,
  });

  if (isLoading) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-6">
        <PageLoading message="載入持倉資料..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-6">
        <Card>
          <CardContent className="py-12">
            <p className="text-sm text-destructive text-center">
              載入失敗，請重試
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const portfolio = data!;
  const isProfit = portfolio.totalUnrealizedPnL >= 0;

  return (
    <div className="container max-w-lg mx-auto px-4 py-6 space-y-6">
      <h2 className="text-2xl font-bold">持倉總覽</h2>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            總市值
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">
            {formatCurrency(portfolio.totalValueTWD)}
          </div>
          {portfolio.holdings.length > 0 && (
            <div className={`flex items-center gap-2 mt-1 ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
              {isProfit ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              <span className="text-sm font-medium">
                {isProfit ? '+' : ''}
                {formatCurrency(portfolio.totalUnrealizedPnL)} ({formatPercent(portfolio.totalUnrealizedPnLPercent)})
              </span>
            </div>
          )}
          {portfolio.usStockValue > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              匯率：1 USD = {portfolio.usdToTwdRate.toFixed(2)} TWD
            </p>
          )}
        </CardContent>
      </Card>

      {portfolio.holdings.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">台股</p>
              <p className="font-semibold">{formatCurrency(portfolio.twStockValue)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">美股</p>
              <p className="font-semibold">{formatCurrency(portfolio.usStockValue * portfolio.usdToTwdRate)}</p>
              {portfolio.usStockValue > 0 && (
                <p className="text-xs text-muted-foreground">
                  ${portfolio.usStockValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="all">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="all">全部</TabsTrigger>
          <TabsTrigger value="tw">台股</TabsTrigger>
          <TabsTrigger value="us">美股</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <HoldingsList holdings={portfolio.holdings} />
        </TabsContent>

        <TabsContent value="tw" className="mt-4">
          <HoldingsList holdings={portfolio.holdings} market="TW" />
        </TabsContent>

        <TabsContent value="us" className="mt-4">
          <HoldingsList holdings={portfolio.holdings} market="US" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
