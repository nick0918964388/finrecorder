'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { PageLoading } from '@/components/ui/spinner';

interface Stock {
  id: string;
  symbol: string;
  market: 'TW' | 'US';
  name: string | null;
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
}

interface TransactionWithStock {
  transaction: Transaction;
  stock: Stock | null;
}

async function fetchTransaction(id: string): Promise<TransactionWithStock> {
  const response = await fetch(`/api/transactions/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch transaction');
  }
  return response.json();
}

async function updateTransaction(id: string, data: Record<string, unknown>): Promise<void> {
  const response = await fetch(`/api/transactions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to update transaction');
  }
}

export default function EditTransactionPage() {
  const router = useRouter();
  const params = useParams();
  const queryClient = useQueryClient();
  const transactionId = params.id as string;

  const { data, isLoading, error } = useQuery({
    queryKey: ['transaction', transactionId],
    queryFn: () => fetchTransaction(transactionId),
  });

  const updateMutation = useMutation({
    mutationFn: (formData: Record<string, unknown>) => updateTransaction(transactionId, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['transaction', transactionId] });
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      router.push('/transactions');
    },
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const submitData = {
      type: formData.get('type'),
      quantity: Number(formData.get('quantity')),
      price: Number(formData.get('price')),
      transactionDate: formData.get('transactionDate'),
      notes: formData.get('notes') || null,
    };
    updateMutation.mutate(submitData);
  };

  if (isLoading) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-6">
        <PageLoading message="載入交易資料..." />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-6">
        <Card>
          <CardContent className="py-12">
            <p className="text-sm text-destructive text-center">
              載入失敗，請重試
            </p>
            <div className="flex justify-center mt-4">
              <Button asChild variant="outline">
                <Link href="/transactions">返回列表</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { transaction, stock } = data;

  return (
    <div className="container max-w-lg mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/transactions">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <h2 className="text-2xl font-bold">編輯交易</h2>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>市場</Label>
                <Input
                  value={stock?.market === 'TW' ? '台股' : '美股'}
                  disabled
                  className="bg-muted"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">類型</Label>
                <Select name="type" defaultValue={transaction.type}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BUY">買入</SelectItem>
                    <SelectItem value="SELL">賣出</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>股票代號</Label>
              <Input
                value={stock?.symbol ?? '未知'}
                disabled
                className="bg-muted"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="quantity">股數</Label>
                <Input
                  id="quantity"
                  name="quantity"
                  type="number"
                  min="1"
                  defaultValue={transaction.quantity}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="price">價格</Label>
                <Input
                  id="price"
                  name="price"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={parseFloat(transaction.price)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="transactionDate">交易日期</Label>
              <Input
                id="transactionDate"
                name="transactionDate"
                type="date"
                defaultValue={transaction.transactionDate}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">備註 (選填)</Label>
              <Input
                id="notes"
                name="notes"
                placeholder="備註..."
                defaultValue={transaction.notes ?? ''}
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  儲存中...
                </>
              ) : (
                '儲存變更'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
