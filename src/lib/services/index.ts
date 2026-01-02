// Stock Price Services
export {
  fetchTWSEStockPrice,
  fetchTWSEMultipleStockPrices,
  fetchUSStockPrice,
  fetchUSMultipleStockPrices,
  fetchTWStockPriceFromYahoo,
  updateStockPriceInDB,
  updateMultipleStockPricesInDB,
  updateAllUserStockPrices,
  getLatestStockPrice,
  searchStocks,
  type StockQuote,
  type FetchResult,
} from './stock-price';

// Exchange Rate Services
export {
  fetchLatestUSDToTWD,
  fetchUSDToTWDFromYahoo,
  fetchUSDToTWDFromExchangeRateAPI,
  fetchUSDToTWDFromTaiwanCBC,
  updateExchangeRate,
  getLatestUSDToTWDRate,
  getUSDToTWDRateByDate,
  getUSDToTWDRate,
  convertCurrency,
  type ExchangeRateData,
  type FetchRateResult,
} from './exchange-rate';

// Net Value Services
export {
  calculateUserNetValue,
  saveUserNetValue,
  snapshotAllUserNetValues,
  getUserNetValueHistory as getNetValueHistory,
  getUserLatestNetValue,
  type UserNetValue,
  type SnapshotResult,
} from './net-value';

// Analytics Services
export {
  calculateCAGR,
  calculateVolatility,
  calculateSharpeRatio,
  calculateMaxDrawdown,
  getUserPerformanceMetrics,
  getUserPortfolioAllocation,
  getUserNetValueHistory,
  getUserInvestmentSummary,
  getUserAnalytics,
  type PerformanceMetrics,
  type PortfolioAllocation,
  type NetValuePoint,
  type AnalyticsData,
} from './analytics';
