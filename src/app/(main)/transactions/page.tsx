'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, ArrowUpCircle, ArrowDownCircle, Loader2 } from 'lucide-react';

interface Stock {
  id: string;
  symbol: string;
  market: 'TW' | 'US';
  name: string | null;
  nameTw: string | null;
}

interface Transaction {
  id: string;
  userId: string;
  stockId: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: string;
  currency: 'TWD' | 'USD';
  transactionDate: string;
  brokerFee: string;
  tax: string;
  totalAmount: string;
  notes: string | null;
  createdAt: string;
}

interface TransactionWithStock {
  transaction: Transaction;
  stock: Stock | null;
}

interface TransactionsResponse {
  data: TransactionWithStock[];
  page: number;
  limit: number;
}

async function fetchTransactions(): Promise<TransactionsResponse> {
  const response = await fetch('/api/transactions');
  if (!response.ok) {
    throw new Error('Failed to fetch transactions');
  }
  return response.json();
}

function formatCurrency(amount: string, currency: 'TWD' | 'USD'): string {
  const num = parseFloat(amount);
  if (currency === 'TWD') {
    return `NT$${num.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPrice(price: string, currency: 'TWD' | 'USD'): string {
  const num = parseFloat(price);
  if (currency === 'TWD') {
    return `NT$${num.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function TransactionsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['transactions'],
    queryFn: fetchTransactions,
  });

  if (isLoading) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
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

  const transactions = data?.data ?? [];

  return (
    <div className="container max-w-lg mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">交易記錄</h2>
        <Button asChild size="sm">
          <Link href="/transactions/new">
            <Plus className="h-4 w-4 mr-1" />
            新增
          </Link>
        </Button>
      </div>

      {transactions.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <p className="text-sm text-muted-foreground text-center">
              尚無交易記錄
            </p>
            <div className="flex justify-center mt-4">
              <Button asChild variant="outline">
                <Link href="/transactions/new">新增第一筆交易</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {transactions.map(({ transaction, stock }) => (
            <Card key={transaction.id} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {transaction.type === 'BUY' ? (
                      <ArrowDownCircle className="h-8 w-8 text-green-500 flex-shrink-0" />
                    ) : (
                      <ArrowUpCircle className="h-8 w-8 text-red-500 flex-shrink-0" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-lg">
                          {stock?.symbol ?? '未知'}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {stock?.market === 'TW' ? '台股' : '美股'}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {transaction.type === 'BUY' ? '買入' : '賣出'}{' '}
                        {transaction.quantity.toLocaleString()} 股 @{' '}
                        {formatPrice(transaction.price, transaction.currency)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p
                      className={`font-semibold ${
                        transaction.type === 'BUY'
                          ? 'text-green-600'
                          : 'text-red-600'
                      }`}
                    >
                      {transaction.type === 'BUY' ? '-' : '+'}
                      {formatCurrency(transaction.totalAmount, transaction.currency)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {transaction.transactionDate}
                    </p>
                  </div>
                </div>
                {transaction.notes && (
                  <p className="text-sm text-muted-foreground mt-2 pl-11">
                    {transaction.notes}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
