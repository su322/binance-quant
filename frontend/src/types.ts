export interface Kline {
  timestamp: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestResult {
  total_trades: number;
  win_rate: number;
  total_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  equity_curve: Record<string, number>;
  signals: Record<string, number>;
}

export interface Account {
  id: number;
  name: string;
  balance: number;
  available_balance?: number;
  is_active: boolean;
  default_leverage: number;
  net_value: number;
  total_pnl: number;
  pnl_percent: number;
  positions?: Position[];
  position_history?: Position[];
}

export interface BalancePoint {
  balance: number;
  timestamp: string;
}

export interface Position {
  symbol: string;
  quantity: number;
  avg_entry: number;
  current_price: number;
  realized_pnl: number;
  take_profit?: number | null;
  stop_loss?: number | null;
  mode?: string;
  side?: string;
}

export interface Order {
  id: number;
  account_id: number;
  symbol: string;
  side: string;
  price: number | null;
  quantity: number;
  filled_qty: number;
  filled_price: number | null;
  status: string;
  type: string;
  duration: string | null;
  mode: string;
  created_at: string;
}

export interface Favorite {
  id: number;
  symbol: string;
  mode: string;
}

export interface ReplayState {
  current_index: number;
  total_klines: number;
  is_finished: boolean;
  status: string;
}

export type IndicatorName = 'none' | 'rsi' | 'macd' | 'kdj' | 'bb';

export interface IndicatorData {
  symbol: string;
  name: string;
  data: any[];
  params: Record<string, any>;
}
