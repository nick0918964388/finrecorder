import {
  pgTable,
  uuid,
  varchar,
  text,
  decimal,
  integer,
  timestamp,
  date,
  boolean,
  pgEnum,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============ ENUMS ============

export const marketEnum = pgEnum('market', ['TW', 'US']);
export const transactionTypeEnum = pgEnum('transaction_type', ['BUY', 'SELL']);
export const currencyEnum = pgEnum('currency', ['TWD', 'USD']);

// ============ USERS (NextAuth.js compatible) ============

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  image: text('image'),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 255 }).notNull(),
  provider: varchar('provider', { length: 255 }).notNull(),
  providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
  refresh_token: text('refresh_token'),
  access_token: text('access_token'),
  expires_at: integer('expires_at'),
  token_type: varchar('token_type', { length: 255 }),
  scope: varchar('scope', { length: 255 }),
  id_token: text('id_token'),
  session_state: varchar('session_state', { length: 255 }),
});

export const sessions = pgTable('sessions', {
  sessionToken: varchar('session_token', { length: 255 }).primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: varchar('identifier', { length: 255 }).notNull(),
    token: varchar('token', { length: 255 }).notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (table) => [unique().on(table.identifier, table.token)]
);

// ============ USER PREFERENCES ============

export const userPreferences = pgTable('user_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  defaultCurrency: currencyEnum('default_currency').default('TWD').notNull(),
  defaultMarket: marketEnum('default_market').default('TW').notNull(),
  theme: varchar('theme', { length: 20 }).default('system'),
  // Default fee rates for Taiwan stocks
  twBrokerFeeRate: decimal('tw_broker_fee_rate', { precision: 6, scale: 4 }).default('0.001425'), // 0.1425%
  twTaxRate: decimal('tw_tax_rate', { precision: 6, scale: 4 }).default('0.003'), // 0.3%
  // Default fee for US stocks
  usBrokerFee: decimal('us_broker_fee', { precision: 10, scale: 2 }).default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ============ STOCKS ============

export const stocks = pgTable(
  'stocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    symbol: varchar('symbol', { length: 20 }).notNull(),
    market: marketEnum('market').notNull(),
    name: varchar('name', { length: 255 }),
    nameTw: varchar('name_tw', { length: 255 }),
    industry: varchar('industry', { length: 100 }),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('stocks_symbol_market_idx').on(table.symbol, table.market),
    unique('stocks_symbol_market_unique').on(table.symbol, table.market),
  ]
);

// ============ STOCK PRICES ============

export const stockPrices = pgTable(
  'stock_prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stockId: uuid('stock_id')
      .notNull()
      .references(() => stocks.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    open: decimal('open', { precision: 12, scale: 4 }),
    high: decimal('high', { precision: 12, scale: 4 }),
    low: decimal('low', { precision: 12, scale: 4 }),
    close: decimal('close', { precision: 12, scale: 4 }).notNull(),
    volume: decimal('volume', { precision: 20, scale: 0 }),
    adjustedClose: decimal('adjusted_close', { precision: 12, scale: 4 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('stock_prices_stock_date_idx').on(table.stockId, table.date),
    index('stock_prices_date_idx').on(table.date),
    unique('stock_prices_stock_date_unique').on(table.stockId, table.date),
  ]
);

// ============ TRANSACTIONS ============

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stockId: uuid('stock_id')
      .notNull()
      .references(() => stocks.id),
    type: transactionTypeEnum('type').notNull(),
    quantity: integer('quantity').notNull(),
    price: decimal('price', { precision: 12, scale: 4 }).notNull(),
    currency: currencyEnum('currency').notNull(),
    transactionDate: date('transaction_date').notNull(),
    brokerFee: decimal('broker_fee', { precision: 12, scale: 2 }).default('0'),
    tax: decimal('tax', { precision: 12, scale: 2 }).default('0'),
    otherFees: decimal('other_fees', { precision: 12, scale: 2 }).default('0'),
    totalAmount: decimal('total_amount', { precision: 14, scale: 2 }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('transactions_user_id_idx').on(table.userId),
    index('transactions_date_idx').on(table.transactionDate),
    index('transactions_user_stock_idx').on(table.userId, table.stockId),
  ]
);

// ============ HOLDINGS ============

export const holdings = pgTable(
  'holdings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stockId: uuid('stock_id')
      .notNull()
      .references(() => stocks.id),
    quantity: integer('quantity').notNull(),
    averageCost: decimal('average_cost', { precision: 12, scale: 4 }).notNull(),
    totalCost: decimal('total_cost', { precision: 14, scale: 2 }).notNull(),
    currency: currencyEnum('currency').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('holdings_user_stock_unique').on(table.userId, table.stockId),
  ]
);

// ============ DAILY NET VALUES ============

export const dailyNetValues = pgTable(
  'daily_net_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    twStockValue: decimal('tw_stock_value', { precision: 16, scale: 2 }).default('0'),
    usStockValue: decimal('us_stock_value', { precision: 16, scale: 2 }).default('0'),
    totalValue: decimal('total_value', { precision: 16, scale: 2 }).notNull(),
    usdToTwdRate: decimal('usd_to_twd_rate', { precision: 8, scale: 4 }),
    dailyReturn: decimal('daily_return', { precision: 10, scale: 6 }),
    cumulativeReturn: decimal('cumulative_return', { precision: 10, scale: 6 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('daily_net_values_user_date_unique').on(table.userId, table.date),
    index('daily_net_values_user_date_idx').on(table.userId, table.date),
  ]
);

// ============ EXCHANGE RATES ============

export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromCurrency: currencyEnum('from_currency').notNull(),
    toCurrency: currencyEnum('to_currency').notNull(),
    rate: decimal('rate', { precision: 12, scale: 6 }).notNull(),
    date: date('date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('exchange_rates_pair_date_unique').on(table.fromCurrency, table.toCurrency, table.date),
    index('exchange_rates_date_idx').on(table.date),
  ]
);

// ============ RELATIONS ============

export const usersRelations = relations(users, ({ many, one }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  preferences: one(userPreferences),
  transactions: many(transactions),
  holdings: many(holdings),
  dailyNetValues: many(dailyNetValues),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
  user: one(users, {
    fields: [userPreferences.userId],
    references: [users.id],
  }),
}));

export const stocksRelations = relations(stocks, ({ many }) => ({
  prices: many(stockPrices),
  transactions: many(transactions),
  holdings: many(holdings),
}));

export const stockPricesRelations = relations(stockPrices, ({ one }) => ({
  stock: one(stocks, {
    fields: [stockPrices.stockId],
    references: [stocks.id],
  }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, {
    fields: [transactions.userId],
    references: [users.id],
  }),
  stock: one(stocks, {
    fields: [transactions.stockId],
    references: [stocks.id],
  }),
}));

export const holdingsRelations = relations(holdings, ({ one }) => ({
  user: one(users, {
    fields: [holdings.userId],
    references: [users.id],
  }),
  stock: one(stocks, {
    fields: [holdings.stockId],
    references: [stocks.id],
  }),
}));

export const dailyNetValuesRelations = relations(dailyNetValues, ({ one }) => ({
  user: one(users, {
    fields: [dailyNetValues.userId],
    references: [users.id],
  }),
}));

// ============ TYPE EXPORTS ============

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Stock = typeof stocks.$inferSelect;
export type NewStock = typeof stocks.$inferInsert;
export type StockPrice = typeof stockPrices.$inferSelect;
export type NewStockPrice = typeof stockPrices.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Holding = typeof holdings.$inferSelect;
export type NewHolding = typeof holdings.$inferInsert;
export type DailyNetValue = typeof dailyNetValues.$inferSelect;
export type NewDailyNetValue = typeof dailyNetValues.$inferInsert;
export type UserPreference = typeof userPreferences.$inferSelect;
export type NewUserPreference = typeof userPreferences.$inferInsert;
export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type NewExchangeRate = typeof exchangeRates.$inferInsert;
