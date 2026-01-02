import { z } from 'zod';

export const createTransactionSchema = z.object({
  symbol: z.string().min(1).max(20),
  market: z.enum(['TW', 'US']),
  type: z.enum(['BUY', 'SELL']),
  quantity: z.number().int().positive(),
  price: z.number().positive(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  brokerFee: z.number().min(0).optional(),
  tax: z.number().min(0).optional(),
  notes: z.string().optional(),
});

export const updateTransactionSchema = createTransactionSchema.partial();

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
