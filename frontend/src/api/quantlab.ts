import type { Kline, BacktestResult, Account, Order, ReplayState, Favorite, IndicatorData, BalancePoint } from '../types';

const BASE = '/api/v1';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  getKlines(symbol: string, interval: string, start: string, end: string, mode = 'spot') {
    return fetchJson<{ symbol: string; interval: string; data: Kline[] }>(
      `${BASE}/klines?symbol=${symbol}&interval=${interval}&start=${start}&end=${end}&mode=${mode}`
    );
  },

  getAccounts() {
    return fetchJson<Account[]>(`${BASE}/accounts`);
  },

  getActiveAccount(mode?: string) {
    const qs = mode ? `?mode=${mode}` : '';
    return fetchJson<Account>(`${BASE}/accounts/active${qs}`);
  },

  activateAccount(accountId: number) {
    return fetchJson<{ ok: boolean }>(`${BASE}/accounts/${accountId}/activate`, { method: 'POST' });
  },

  deleteAccount(accountId: number) {
    return fetchJson<{ ok: boolean }>(`${BASE}/accounts/${accountId}`, { method: 'DELETE' });
  },

  createAccount(name: string, balance = 10000) {
    return fetchJson<Account>(`${BASE}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, balance }),
    });
  },

  placeOrder(accountId: number, symbol: string, side: string, quantity: number, price?: number, orderType = 'market', duration?: string, takeProfit?: number, stopLoss?: number, mode?: string, leverage?: number) {
    return fetchJson<{ order_id: number; status: string }>(
      `${BASE}/accounts/${accountId}/orders`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, symbol, side, quantity, price, order_type: orderType, duration, take_profit: takeProfit, stop_loss: stopLoss, mode, leverage }),
      }
    );
  },

  closePosition(accountId: number, symbol: string, quantity: number, price: number, mode: string) {
    return fetchJson<{ order_id: number; status: string }>(
      `${BASE}/accounts/${accountId}/close-position`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, symbol, quantity, price, mode }),
      }
    );
  },

  cancelOrder(accountId: number, orderId: number) {
    return fetchJson<{ ok: boolean }>(
      `${BASE}/accounts/${accountId}/orders/${orderId}/cancel`,
      { method: 'POST' }
    );
  },

  updateTpSl(accountId: number, symbol: string, mode: string, takeProfit?: number, stopLoss?: number) {
    return fetchJson<{ ok: boolean; take_profit: number | null; stop_loss: number | null }>(
      `${BASE}/accounts/${accountId}/positions/tp-sl`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, symbol, mode, take_profit: takeProfit, stop_loss: stopLoss }),
      }
    );
  },

  getAccount(accountId: number) {
    return fetchJson<Account>(`${BASE}/accounts/${accountId}`);
  },

  getOrders(accountId: number) {
    return fetchJson<Order[]>(`${BASE}/accounts/${accountId}/orders`);
  },

  runBacktest(params: Record<string, unknown>) {
    return fetchJson<BacktestResult>(`${BASE}/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  },

  searchSymbols(q: string, mode = 'spot') {
    return fetchJson<string[]>(`${BASE}/exchange-info?q=${encodeURIComponent(q)}&mode=${mode}`);
  },

  getMinNotional(symbol: string, mode = 'perpetual') {
    return fetchJson<{ symbol: string; min_notional: number }>(
      `${BASE}/exchange-info?symbol=${symbol}&mode=${mode}`
    );
  },

  getFavorites(mode = 'spot') {
    return fetchJson<Favorite[]>(`${BASE}/symbol-favorites?mode=${mode}`);
  },

  getBalanceHistory(accountId: number) {
    return fetchJson<{ points: BalancePoint[] }>(`${BASE}/accounts/${accountId}/balance-history`);
  },

  addFavorite(symbol: string, mode = 'spot') {
    return fetchJson<Favorite>(`${BASE}/symbol-favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, mode }),
    });
  },

  deleteFavorite(id: number) {
    return fetchJson<{ ok: boolean }>(`${BASE}/symbol-favorites/${id}`, { method: 'DELETE' });
  },

  getIndicators(symbol: string, interval: string, start: string, end: string, name: string, mode = 'spot') {
    return fetchJson<IndicatorData>(
      `${BASE}/indicators?symbol=${symbol}&interval=${interval}&start=${start}&end=${end}&name=${name}&mode=${mode}`
    );
  },

  startReplay(accountId: number, symbol: string, interval: string, dataRange: Record<string, string>) {
    return fetchJson<{ session_id: number }>(`${BASE}/replay/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: accountId, symbol, interval, data_range: dataRange }),
    });
  },

  replayStep(sessionId: number) {
    return fetchJson(`${BASE}/replay/${sessionId}/step`, { method: 'POST' });
  },

  replayState(sessionId: number) {
    return fetchJson<ReplayState>(`${BASE}/replay/${sessionId}/state`);
  },

  replaySeek(sessionId: number, index: number) {
    return fetchJson<{ ok: boolean }>(`${BASE}/replay/${sessionId}/seek?index=${index}`, { method: 'POST' });
  },

  replayPause(sessionId: number) {
    return fetchJson<{ ok: boolean }>(`${BASE}/replay/${sessionId}/pause`, { method: 'POST' });
  },

  replayResume(sessionId: number) {
    return fetchJson<{ ok: boolean }>(`${BASE}/replay/${sessionId}/resume`, { method: 'POST' });
  },

  setLeverage(accountId: number, leverage: number) {
    return fetchJson<{ ok: boolean; default_leverage: number }>(
      `${BASE}/accounts/${accountId}/leverage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leverage }),
      }
    );
  },
};
