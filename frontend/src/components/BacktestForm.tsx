import { useState, useEffect, useRef } from 'react';
import { api } from '../api/quantlab';

type Mode = 'spot' | 'perpetual' | 'event';

const MODES: { key: Mode; label: string }[] = [
  { key: 'spot', label: '现货' },
  { key: 'perpetual', label: '永续合约' },
  { key: 'event', label: '事件合约' },
];

interface Props {
  onRun: (params: Record<string, any>) => void;
  loading?: boolean;
}

export default function BacktestForm({ onRun, loading }: Props) {
  const [mode, setMode] = useState<Mode>('spot');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [symbolInput, setSymbolInput] = useState('BTCUSDT');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [hlIdx, setHlIdx] = useState(0);
  const [capital, setCapital] = useState('10000');
  const [start, setStart] = useState('2024-01-01');
  const [end, setEnd] = useState('2024-06-01');
  const comboRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node))
        setShowDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDropdown]);

  const changeSymbol = (s: string) => {
    const upper = s.toUpperCase();
    setSymbol(upper);
    setSymbolInput(upper);
    setShowDropdown(false);
  };

  const handleModeChange = (m: Mode) => {
    setMode(m);
    if (m === 'event' && symbol !== 'BTCUSDT' && symbol !== 'ETHUSDT')
      changeSymbol('BTCUSDT');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const c = parseFloat(capital);
    if (isNaN(c) || c <= 0) { alert('请输入有效的初始资金'); return; }
    onRun({
      symbol,
      interval: '1h',
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      initial_capital: c,
      product_type: 'event_contract',
      product_params: { direction: 'up' },
      features: [],
      strategy_params: {},
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <h3 style={{ fontSize: 13, color: '#7c7cff', marginBottom: 12, fontWeight: 500 }}>
        回测参数
      </h3>

      {/* Mode */}
      <div className="form-row">
        <label>交易品类</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {MODES.map(m => (
            <button
              key={m.key}
              type="button"
              className={`mode-btn ${mode === m.key ? 'active' : ''}`}
              onClick={() => handleModeChange(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Symbol */}
      {mode === 'event' ? (
        <div className="form-row">
          <label>交易对</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {['BTCUSDT', 'ETHUSDT'].map(s => (
              <button
                key={s}
                type="button"
                className={`event-sym-btn ${symbol === s ? 'active' : ''}`}
                onClick={() => changeSymbol(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="form-row">
          <label>交易对</label>
          <div className="sym-combo" ref={comboRef}>
            <div className="sym-search-row">
              <span className="search-icon">🔍</span>
              <input
                className="symbol-input"
                style={{ width: '100%' }}
                value={symbolInput}
                onChange={e => { setSymbolInput(e.currentTarget.value); setHlIdx(0); }}
                onFocus={() => setShowDropdown(true)}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHlIdx(i => Math.min(i + 1, searchResults.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHlIdx(i => Math.max(i - 1, 0));
                  } else if (e.key === 'Enter') {
                    const hl = searchResults[hlIdx];
                    if (hl) changeSymbol(hl);
                    else if (symbolInput.trim()) changeSymbol(symbolInput);
                  } else if (e.key === 'Escape') {
                    setShowDropdown(false);
                  }
                }}
                placeholder="搜索交易对"
              />
            </div>
            {showDropdown && searchResults.length > 0 && (
              <div className="sym-dropdown" style={{ width: '100%' }}>
                {searchResults.map((s, i) => (
                  <div
                    key={s}
                    className={`sym-option ${i === hlIdx ? 'hl' : ''} ${s === symbol ? 'active' : ''}`}
                    onMouseDown={() => changeSymbol(s)}
                    onMouseEnter={() => setHlIdx(i)}
                  >
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            )}
            {showDropdown && searchResults.length === 0 && (
              <div className="sym-dropdown" style={{ width: '100%' }}>
                <div className="sym-empty">无匹配交易对</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Strategy */}
      <div className="form-row">
        <label>策略</label>
        <select
          disabled
          style={{ color: '#6a6a80', cursor: 'not-allowed' }}
        >
          <option value="">请先创建策略</option>
        </select>
      </div>

      {/* Initial capital */}
      <div className="form-row">
        <label>初始资金 (USDT)</label>
        <input
          type="number"
          min="1"
          value={capital}
          onChange={e => setCapital(e.target.value)}
        />
      </div>

      <div className="form-row">
        <label>开始日期</label>
        <input type="date" value={start} onChange={e => setStart(e.target.value)} />
      </div>
      <div className="form-row">
        <label>结束日期</label>
        <input type="date" value={end} onChange={e => setEnd(e.target.value)} />
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled>
          运行回测
        </button>
      </div>
    </form>
  );
}
