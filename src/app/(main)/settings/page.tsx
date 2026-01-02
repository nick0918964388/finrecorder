'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Loader2, Check } from 'lucide-react';

interface UserPreferences {
  defaultMarket: 'TW' | 'US';
  defaultCurrency: 'TWD' | 'USD';
  twBrokerFeeRate: number;
  twTaxRate: number;
  usBrokerFee: number;
}

async function fetchSettings(): Promise<UserPreferences> {
  const response = await fetch('/api/settings');
  if (!response.ok) {
    throw new Error('Failed to fetch settings');
  }
  return response.json();
}

async function updateSettings(data: Partial<UserPreferences>): Promise<void> {
  const response = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to update settings');
  }
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  const [formData, setFormData] = useState<Partial<UserPreferences>>({});

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(formData);
  };

  const currentValues = {
    defaultMarket: formData.defaultMarket ?? settings?.defaultMarket ?? 'TW',
    defaultCurrency: formData.defaultCurrency ?? settings?.defaultCurrency ?? 'TWD',
    twBrokerFeeRate: formData.twBrokerFeeRate ?? settings?.twBrokerFeeRate ?? 0.001425,
    twTaxRate: formData.twTaxRate ?? settings?.twTaxRate ?? 0.003,
    usBrokerFee: formData.usBrokerFee ?? settings?.usBrokerFee ?? 0,
  };

  if (isLoading) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-lg mx-auto px-4 py-6 space-y-6">
      <h2 className="text-2xl font-bold">設定</h2>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">個人資料</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {session?.user?.image && (
              <img
                src={session.user.image}
                alt=""
                className="h-16 w-16 rounded-full"
              />
            )}
            <div>
              <p className="font-medium">{session?.user?.name}</p>
              <p className="text-sm text-muted-foreground">{session?.user?.email}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit}>
        {/* Preferences */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">偏好設定</CardTitle>
            <CardDescription>自訂預設選項</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>預設市場</Label>
              <Select
                value={currentValues.defaultMarket}
                onValueChange={(value: 'TW' | 'US') =>
                  setFormData((prev) => ({ ...prev, defaultMarket: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TW">台股</SelectItem>
                  <SelectItem value="US">美股</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>預設貨幣</Label>
              <Select
                value={currentValues.defaultCurrency}
                onValueChange={(value: 'TWD' | 'USD') =>
                  setFormData((prev) => ({ ...prev, defaultCurrency: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TWD">TWD (新台幣)</SelectItem>
                  <SelectItem value="USD">USD (美元)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Fee Settings */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">手續費設定</CardTitle>
            <CardDescription>設定預設手續費率</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>台股券商手續費率 (%)</Label>
              <Input
                type="number"
                step="0.0001"
                value={(currentValues.twBrokerFeeRate * 100).toFixed(4)}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    twBrokerFeeRate: parseFloat(e.target.value) / 100,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">預設 0.1425%</p>
            </div>

            <div className="space-y-2">
              <Label>台股交易稅 (%)</Label>
              <Input
                type="number"
                step="0.001"
                value={(currentValues.twTaxRate * 100).toFixed(3)}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    twTaxRate: parseFloat(e.target.value) / 100,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">賣出時課徵 0.3%</p>
            </div>

            <div className="space-y-2">
              <Label>美股手續費 (USD)</Label>
              <Input
                type="number"
                step="0.01"
                value={currentValues.usBrokerFee}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    usBrokerFee: parseFloat(e.target.value) || 0,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">每筆交易固定費用</p>
            </div>
          </CardContent>
        </Card>

        <Button
          type="submit"
          className="w-full"
          disabled={mutation.isPending || Object.keys(formData).length === 0}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              儲存中...
            </>
          ) : saved ? (
            <>
              <Check className="h-4 w-4 mr-2" />
              已儲存
            </>
          ) : (
            '儲存設定'
          )}
        </Button>
      </form>
    </div>
  );
}
