import { useState, useEffect, useRef, useCallback } from 'react';
import KlineChart from './components/KlineChart';
import type { KlineChartHandle, EventLine } from './components/KlineChart';
import BacktestForm from './components/BacktestForm';
import AccountPanel from './components/AccountPanel';
import TradingPanel from './components/TradingPanel';
import { api } from './api/quantlab';
import type { Kline, BacktestResult, Favorite, Order } from './types';
import { EVENT_DURATION_SECONDS } from './constants';

type Tab = 'chart' | 'backtest' | 'accounts' | 'replay';
type Mode = 'spot' | 'perpetual' | 'event';

const MODES: { key: Mode; label: string }[] = [
  { key: 'spot', label: '现货' },
  { key: 'perpetual', label: '永续合约' },
  { key: 'event', label: '事件合约' },
];

const INTERVAL_GROUPS = [
  { label: '分钟', values: ['1m', '3m', '5m', '15m', '30m'] },
  { label: '小时', values: ['1h', '2h', '4h', '6h', '8h', '12h'] },
  { label: '天/周/月', values: ['1d', '3d', '1w', '1M'] },
];
const LOOKBACK_DAYS: Record<string, number> = {
  '1m': 7, '3m': 14, '5m': 30, '15m': 60, '30m': 90,
  '1h': 180, '2h': 180, '4h': 365, '6h': 365, '8h': 365, '12h': 365,
  '1d': 730, '3d': 730, '1w': 1095, '1M': 1095,
};

const DEFAULT_INTERVAL_FAVS = ['5m', '15m', '1h', '4h', '1d'];

function loadIntervalFavs(): string[] {
  try {
    const stored = localStorage.getItem('fav-intervals');
    return stored ? JSON.parse(stored) : DEFAULT_INTERVAL_FAVS;
  } catch {
    return DEFAULT_INTERVAL_FAVS;
  }
}

export default function App() {
  const [klines, setKlines] = useState<Kline[]>([]);
  const [latestPrice, setLatestPrice] = useState(0);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('chart');
  const [mode, setMode] = useState<Mode>('spot');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('1h');
  const [btInterval, setBtInterval] = useState('1h');
  const [intervalFavs, setIntervalFavs] = useState<string[]>(loadIntervalFavs);
  const [showPicker, setShowPicker] = useState(false);
  const [favSymbols, setFavSymbols] = useState<Favorite[]>([]);
  const [symbolInput, setSymbolInput] = useState('BTCUSDT');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [showSymDropdown, setShowSymDropdown] = useState(false);
  const [symHighlightIdx, setSymHighlightIdx] = useState(0);
  const chartRef = useRef<KlineChartHandle>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const symComboRef = useRef<HTMLDivElement>(null);
  const lastBtRef = useRef<Record<string, any> | null>(null);
  const [rightWidth, setRightWidth] = useState(320);
  const dragRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const noMoreDataRef = useRef(false);
  const [eventOrders, setEventOrders] = useState<Order[]>([]);
  const [tick, setTick] = useState(0);
  const [priceLines, setPriceLines] = useState<EventLine[]>([]);

  const getRemainingSeconds = (createdAt: string, dur: string) => {
    const secs = EVENT_DURATION_SECONDS[dur] || 1800;
    const ts = createdAt.endsWith('Z') ? createdAt : createdAt + 'Z';
    const elapsed = (Date.now() - new Date(ts).getTime()) / 1000;
    return Math.max(0, Math.ceil(secs - elapsed));
  };

  const handleEventOrdersChange = useCallback((orders: Order[]) => {
    setEventOrders(orders);
  }, []);

  const handlePriceLinesChange = useCallback((lines: EventLine[]) => {
    setPriceLines(lines);
  }, []);

  // Tick every second for countdown updates
  useEffect(() => {
    const timer = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => { window.clearInterval(timer); };
  }, []);

  const handleLoadMore = useCallback(async (oldestTimestamp: number) => {
    if (loadingMoreRef.current || noMoreDataRef.current) return;
    loadingMoreRef.current = true;
    try {
      const oldestDate = new Date(oldestTimestamp * 1000);
      const days = LOOKBACK_DAYS[interval] || 30;
      const start = new Date(oldestDate.getTime() - days * 86_400_000).toISOString();
      const end = oldestDate.toISOString();
      const res = await api.getKlines(symbol, interval, start, end, mode);
      if (!res.data || res.data.length === 0) {
        noMoreDataRef.current = true;
        return;
      }
      chartRef.current?.loadMoreData(res.data);
      setKlines(prev => [...res.data, ...prev]);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [symbol, interval, mode]);

  // Load symbol favorites for current mode
  useEffect(() => {
    noMoreDataRef.current = false;
    api.getFavorites(mode).then(favs => {
      setFavSymbols(favs);
      setSearchResults(favs.map(f => f.symbol));
    }).catch(() => {});
  }, [mode]);

  // Update search results when favorites change (while input is empty)
  useEffect(() => {
    if (!symbolInput.trim()) {
      setSearchResults(favSymbols.map(f => f.symbol));
    }
  }, [favSymbols]);

  // Debounced auto-search — updates dropdown only, does NOT change chart
  useEffect(() => {
    if (!symbolInput.trim()) return;
    const timer = setTimeout(async () => {
      try {
        const res = await api.searchSymbols(symbolInput, mode);
        setSearchResults(res);
      } catch { /* ignore */ }
    }, 200);
    return () => clearTimeout(timer);
  }, [symbolInput, mode]);

  const favIds = new Set(favSymbols.map(f => f.symbol));
  const sortedSymbols = [
    ...favSymbols.filter(f => searchResults.includes(f.symbol)).map(f => f.symbol),
    ...searchResults.filter(s => !favIds.has(s)),
  ];

  // Persist interval favorites
  useEffect(() => {
    localStorage.setItem('fav-intervals', JSON.stringify(intervalFavs));
  }, [intervalFavs]);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!showSymDropdown && !showPicker) return;
    const handler = (e: MouseEvent) => {
      if (showPicker && pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
      if (showSymDropdown && symComboRef.current && !symComboRef.current.contains(e.target as Node)) {
        setShowSymDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSymDropdown, showPicker]);

  const toggleIntervalFav = useCallback((intv: string) => {
    setIntervalFavs(prev =>
      prev.includes(intv) ? prev.filter(i => i !== intv) : prev.length >= 8 ? prev : [...prev, intv]
    );
  }, []);

  const selectInterval = useCallback((intv: string) => {
    setInterval(intv);
    setIntervalFavs(prev => prev.includes(intv) ? prev : prev.length >= 8 ? prev : [...prev, intv]);
  }, []);

  const changeSymbol = useCallback((s: string) => {
    const upper = s.toUpperCase();
    if (upper && upper !== symbol) {
      setSymbol(upper);
      setSymbolInput(upper);
    } else {
      setSymbolInput(symbol);
    }
  }, [symbol]);

  const handleModeChange = useCallback((m: Mode) => {
    setMode(m);
    if (m === 'event' && symbol !== 'BTCUSDT' && symbol !== 'ETHUSDT') {
      changeSymbol('BTCUSDT');
    }
  }, [symbol, changeSymbol]);

  const toggleSymbolFav = useCallback(async () => {
    const existing = favSymbols.find(f => f.symbol === symbol);
    if (existing) {
      await api.deleteFavorite(existing.id);
      setFavSymbols(prev => prev.filter(f => f.id !== existing.id));
    } else {
      const fav = await api.addFavorite(symbol, mode);
      setFavSymbols(prev => [...prev, fav]);
    }
  }, [symbol, mode, favSymbols]);

  // Load history & connect WS when symbol, interval or mode changes
  useEffect(() => {
    let cancelled = false;

    const connectWs = () => {
      if (cancelled) return;
      wsRef.current?.close();
      const ws = new WebSocket(`ws://localhost:8000/ws/klines?symbol=${symbol}&interval=${interval}&mode=${mode}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'kline') {
          chartRef.current?.updateKline(msg.data);
          setLatestPrice(msg.data.close);
        }
      };

      ws.onclose = () => {
        if (!cancelled) setTimeout(connectWs, 3000);
      };
    };

    const loadHistory = async () => {
      try {
        const days = LOOKBACK_DAYS[interval] || 30;
        const start = new Date(Date.now() - days * 86_400_000).toISOString();
        const end = new Date().toISOString();
        const res = await api.getKlines(symbol, interval, start, end, mode);
        if (cancelled) return;
        setKlines(res.data || []);
      } catch (e) {
        console.error('Failed to load klines:', e);
      }
      // Connect WS after history loads (chart is ready)
      if (!cancelled) connectWs();
    };

    wsRef.current?.close();
    loadHistory();

    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, [symbol, interval, mode]);

  // Reset refs when mode changes
  useEffect(() => {
    noMoreDataRef.current = false;
    loadingMoreRef.current = false;
  }, [mode]);

  const handleBacktest = async (params: Record<string, any>) => {
    setLoading(true);
    setResult(null);
    lastBtRef.current = params;
    try {
      const res = await api.runBacktest(params) as BacktestResult;
      setResult(res);
      const data = await api.getKlines(
        params.symbol, btInterval,
        params.start, params.end,
      );
      setKlines(data.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Reload backtest klines when interval changes
  useEffect(() => {
    const p = lastBtRef.current;
    if (!p) return;
    api.getKlines(p.symbol, btInterval, p.start, p.end)
      .then(res => setKlines(res.data || []))
      .catch(() => {});
  }, [btInterval]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'accounts', label: '模拟账户' },
    { key: 'chart', label: '模拟交易' },
    { key: 'backtest', label: '策略回测' },
    { key: 'replay', label: 'K线回放' },
  ];

  const isFavSymbol = favSymbols.some(f => f.symbol === symbol);

  // Compute event price lines with countdowns
  const eventLines: EventLine[] = [];
  if (mode === 'event' && eventOrders.length > 0) {
    const pending = eventOrders.filter(o => o.status === 'pending' && o.symbol === symbol);
    pending.forEach(o => {
      const isUp = o.side === 'buy';
      const remaining = getRemainingSeconds(o.created_at, o.duration || '30m');
      const countdown = remaining > 0
        ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
        : '结算中';
      eventLines.push({
        price: o.price || 0,
        title: `${isUp ? '看涨' : '看跌'} ${countdown}`,
        side: o.side,
      });
    });
  }

  return (
    <div className="app">
      <header className="header">
        <h1>QUANT LAB</h1>
        <nav className="tabs">
          {tabs.map(t => (
            <button
              key={t.key}
              className={activeTab === t.key ? 'active' : ''}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {activeTab === 'chart' && (
          <div className="mode-bar">
            {MODES.map(m => (
              <button
                key={m.key}
                className={`mode-btn ${mode === m.key ? 'active' : ''}`}
                onClick={() => handleModeChange(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
        {activeTab === 'chart' && (
          <div className="chart-controls">
            <div className="interval-bar">
              {intervalFavs.slice(0, 5).map(f => (
                <button
                  key={f}
                  className={`fav-btn ${interval === f ? 'active' : ''}`}
                  onClick={() => setInterval(f)}
                  onContextMenu={e => {
                    e.preventDefault();
                    setIntervalFavs(prev => prev.filter(i => i !== f));
                  }}
                  title={`${f} — 右键取消收藏`}
                >
                  {f}
                </button>
              ))}
              <div className="picker-wrapper" ref={pickerRef}>
                <button
                  className="picker-btn"
                  onClick={() => setShowPicker(v => !v)}
                  title="选择其他时间级别"
                >
                  ···
                </button>
                {showPicker && (
                  <div className="picker-dropdown">
                    {INTERVAL_GROUPS.map(g => (
                      <div key={g.label}>
                        <div className="picker-group-label">{g.label}</div>
                        {g.values.map(v => {
                          const isFav = intervalFavs.includes(v);
                          return (
                            <div
                              key={v}
                              className={`picker-item ${interval === v ? 'active' : ''}`}
                              onClick={() => { selectInterval(v); setShowPicker(false); }}
                            >
                              <span>{v}</span>
                              <span
                                className={`star ${isFav ? 'on' : ''}`}
                                onClick={e => {
                                  e.stopPropagation();
                                  toggleIntervalFav(v);
                                }}
                              >
                                {isFav ? '★' : '☆'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {mode === 'event' ? (
              <div className="event-symbols" style={{ marginLeft: 'auto' }}>
                {['BTCUSDT', 'ETHUSDT'].map(s => (
                  <button
                    key={s}
                    className={`event-sym-btn ${symbol === s ? 'active' : ''}`}
                    onClick={() => changeSymbol(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="sym-combo" ref={symComboRef} style={{ marginLeft: 'auto' }}>
                  <div className="sym-search-row">
                    <span className="search-icon">🔍</span>
                    <input
                      className="symbol-input"
                      value={symbolInput}
                      onChange={e => {
                        setSymbolInput(e.currentTarget.value);
                        setSymHighlightIdx(0);
                      }}
                      onFocus={() => setShowSymDropdown(true)}
                      onKeyDown={e => {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setSymHighlightIdx(i => Math.min(i + 1, sortedSymbols.length - 1));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setSymHighlightIdx(i => Math.max(i - 1, 0));
                        } else if (e.key === 'Enter') {
                          const highlighted = sortedSymbols[symHighlightIdx];
                          const pick = (highlighted?.startsWith(symbolInput.toUpperCase()))
                            ? highlighted : symbolInput;
                          if (!pick) return;
                          api.searchSymbols(pick, mode).then(res => {
                            if (res.includes(pick)) {
                              changeSymbol(pick);
                              setShowSymDropdown(false);
                            } else {
                              setSymbolInput(symbol);
                              setSearchResults([]);
                            }
                          }).catch(() => { changeSymbol(pick); setShowSymDropdown(false); });
                        } else if (e.key === 'Escape') {
                          setShowSymDropdown(false);
                        }
                      }}
                      placeholder="搜索交易对"
                    />
                  </div>
                  {showSymDropdown && sortedSymbols.length > 0 && (
                    <div className="sym-dropdown">
                      {sortedSymbols.map((s, i) => (
                        <div
                          key={s}
                          className={`sym-option ${i === symHighlightIdx ? 'hl' : ''} ${s === symbol ? 'active' : ''}`}
                          onMouseDown={() => { changeSymbol(s); setShowSymDropdown(false); }}
                          onMouseEnter={() => setSymHighlightIdx(i)}
                        >
                          <span>{s}</span>
                          {favIds.has(s) && <span className="star on">★</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {showSymDropdown && sortedSymbols.length === 0 && (
                    <div className="sym-dropdown">
                      <div className="sym-empty">无匹配交易对</div>
                    </div>
                  )}
                </div>
                <button
                  className={`star-btn ${isFavSymbol ? 'on' : ''}`}
                  onClick={toggleSymbolFav}
                  title={isFavSymbol ? '取消收藏' : '收藏'}
                >
                  {isFavSymbol ? '★' : '☆'}
                </button>
                <select
                  className="fav-select"
                  defaultValue=""
                  onChange={e => { if (e.target.value) changeSymbol(e.target.value); }}
                >
                  <option value="" disabled>收藏交易对</option>
                  {favSymbols.map(f => (
                    <option key={f.id} value={f.symbol}>{f.symbol}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}
      </header>

      <div className="main">
        {activeTab === 'chart' && (
          <div className="content-row">
            <div className="chart-area" style={{ flex: 1, minWidth: 0 }}>
              <KlineChart ref={chartRef} data={klines} height={600} symbol={symbol} key={`${symbol}-${interval}-${mode}`} onLoadMore={handleLoadMore} eventLines={[...eventLines, ...priceLines]} />
            </div>
            <div
              style={{ width: 4, cursor: 'col-resize', flexShrink: 0, background: '#1e1e3a', position: 'relative' }}
              onMouseDown={e => {
                e.preventDefault();
                dragRef.current = true;
                const startX = e.clientX;
                const startW = rightWidth;
                const onMove = (ev: MouseEvent) => {
                  if (!dragRef.current) return;
                  const newW = Math.max(200, Math.min(600, startW - (ev.clientX - startX)));
                  setRightWidth(newW);
                };
                const onUp = () => { dragRef.current = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }}
            />
            <div style={{ width: rightWidth, flexShrink: 0 }}>
              <TradingPanel symbol={symbol} lastPrice={latestPrice || (klines.length > 0 ? klines[klines.length - 1].close : 0)} mode={mode} onEventOrdersChange={handleEventOrdersChange} onPriceLinesChange={handlePriceLinesChange} />
            </div>
          </div>
        )}

        {activeTab === 'backtest' && (
          <div className="content-row">
            <div style={{ width: 280, flexShrink: 0, padding: 16, borderRight: '1px solid #1e1e3a', overflowY: 'auto' }}>
              <BacktestForm onRun={handleBacktest} loading={loading} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e1e3a', fontSize: 13, color: '#7c7cff', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                策略回测
                <span style={{ fontSize: 10, color: '#4a4a6a', background: '#14142a', padding: '2px 6px', borderRadius: 4, fontWeight: 400 }}>未实现</span>
              </div>
              {result && klines.length > 0 && (
                <>
                  <div style={{ display: 'flex', gap: 3, padding: '8px 12px', borderBottom: '1px solid #1e1e3a', alignItems: 'center' }}>
                    {DEFAULT_INTERVAL_FAVS.map(f => (
                      <button
                        key={f}
                        className={`fav-btn ${btInterval === f ? 'active' : ''}`}
                        onClick={() => setBtInterval(f)}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                  <div style={{ flex: 1, padding: 12 }}>
                    <KlineChart data={klines} height={400} />
                  </div>
                </>
              )}
              {result && (
                <div className="results" style={{ margin: '0 12px 12px' }}>
                  <h4>回测结果</h4>
                  <div className="metrics">
                    <div className="metric">
                      <div className="val">{result.total_trades}</div>
                      <div className="label">总交易次数</div>
                    </div>
                    <div className="metric">
                      <div className={`val ${result.win_rate >= 0.5 ? 'win' : 'loss'}`}>
                        {(result.win_rate * 100).toFixed(1)}%
                      </div>
                      <div className="label">胜率</div>
                    </div>
                    <div className="metric">
                      <div className={`val ${result.total_return >= 0 ? 'win' : 'loss'}`}>
                        {(result.total_return * 100).toFixed(2)}%
                      </div>
                      <div className="label">总收益率</div>
                    </div>
                    <div className="metric">
                      <div className="val">{result.sharpe_ratio.toFixed(2)}</div>
                      <div className="label">夏普比率</div>
                    </div>
                    <div className="metric">
                      <div className="val loss">{(result.max_drawdown * 100).toFixed(2)}%</div>
                      <div className="label">最大回撤</div>
                    </div>
                  </div>
                </div>
              )}
              {!result && (
                <div className="empty">运行回测后在这里查看结果</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'replay' && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: '#4a4a6a', marginTop: 40 }}>未实现</div>
          </div>
        )}
        {activeTab === 'accounts' && (
          <div style={{ padding: 24 }}>
            <AccountPanel />
          </div>
        )}
      </div>
    </div>
  );
}
