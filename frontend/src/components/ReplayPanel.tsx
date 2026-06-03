import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/quantlab';
import KlineChart from './KlineChart';
import type { Kline, ReplayState, Account } from '../types';

const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d'];
const SPEEDS = [1, 2, 5, 10];

const now = new Date();
const defaultEnd = now.toISOString().slice(0, 16);
const defaultStart = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 16);

export default function ReplayPanel() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('1h');
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState(0);
  const [sessionId, setSessionId] = useState(0);
  const [rs, setRs] = useState<ReplayState | null>(null);
  const [klines, setKlines] = useState<Kline[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api.getAccounts().then(setAccounts).catch(() => {});
  }, []);

  const doStep = useCallback(async (sid: number) => {
    try {
      const result: any = await api.replayStep(sid);
      if (result && result.kline) {
        const k: Kline = {
          timestamp: result.kline.timestamp,
          open: result.kline.open,
          high: result.kline.high,
          low: result.kline.low,
          close: result.kline.close,
          volume: result.kline.volume,
        };
        setKlines(prev => [...prev, k]);
      }
      const st = await api.replayState(sid);
      setRs(st as ReplayState);
      if ((st as ReplayState).is_finished) setPlaying(false);
      return result;
    } catch {
      return null;
    }
  }, []);

  // Auto-step timer
  useEffect(() => {
    if (!playing || !sessionId) return;
    const ms = Math.max(100, 1000 / speed);
    const tick = () => {
      timerRef.current = setTimeout(async () => {
        await doStep(sessionId);
        tick();
      }, ms);
    };
    tick();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [playing, sessionId, speed, doStep]);

  const handleStart = async () => {
    if (!accountId) { alert('请选择账户'); return; }
    setLoading(true);
    try {
      const res = await api.startReplay(accountId, symbol, interval, { start: startDate, end: endDate });
      setSessionId(res.session_id);
      setStarted(true);
      setKlines([]);
      setPlaying(false);
      setRs(null);
      // First step
      await doStep(res.session_id);
    } catch (e: any) {
      alert(e.message || '启动失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSeek = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!sessionId) return;
    const idx = parseInt(e.target.value);
    await api.replaySeek(sessionId, idx);
    const st = await api.replayState(sessionId);
    setRs(st as ReplayState);
    setKlines([]);
    // Step from the new position
    await doStep(sessionId);
  };

  const handlePauseResume = async () => {
    if (!sessionId) return;
    if (playing) {
      await api.replayPause(sessionId);
      setPlaying(false);
    } else {
      await api.replayResume(sessionId);
      setPlaying(true);
    }
  };

  const progress = rs ? (rs.total_klines > 0 ? (rs.current_index / rs.total_klines) * 100 : 0) : 0;

  const baseAsset = symbol.replace('USDT', '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {!started ? (
        <div style={{ padding: 24, maxWidth: 480 }}>
          <h3 style={{ margin: '0 0 16px', color: '#e0e0e0' }}>K线回放</h3>
          <div className="form-row" style={{ marginBottom: 12 }}>
            <label>交易对</label>
            <input type="text" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="BTCUSDT" />
          </div>
          <div className="form-row" style={{ marginBottom: 12 }}>
            <label>时间级别</label>
            <select value={interval} onChange={e => setInterval(e.target.value)} style={{ background: '#14142a', border: '1px solid #2a2a44', borderRadius: 6, color: '#e0e0e0', padding: '6px 10px', fontSize: 13 }}>
              {INTERVALS.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div className="form-row" style={{ flex: 1, marginBottom: 0 }}>
              <label>开始时间</label>
              <input type="datetime-local" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="form-row" style={{ flex: 1, marginBottom: 0 }}>
              <label>结束时间</label>
              <input type="datetime-local" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="form-row" style={{ marginBottom: 16 }}>
            <label>模拟账户</label>
            <select value={accountId} onChange={e => setAccountId(parseInt(e.target.value))} style={{ background: '#14142a', border: '1px solid #2a2a44', borderRadius: 6, color: '#e0e0e0', padding: '6px 10px', fontSize: 13 }}>
              <option value={0}>请选择</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <button className="btn" style={{ width: '100%', padding: 10, fontWeight: 600 }} disabled={loading} onClick={handleStart}>
            {loading ? '启动中...' : '开始回放'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 8 }}>
          {/* Controls bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid #1e1e3a', marginBottom: 4, flexShrink: 0 }}>
            <span style={{ fontSize: 12, color: '#7c7cff', fontWeight: 500 }}>{symbol} · {interval}</span>
            <span style={{ fontSize: 11, color: '#4a4a6a' }}>|</span>
            <button className="mode-btn" style={{ fontSize: 11, padding: '4px 10px' }} onClick={handlePauseResume}>
              {playing ? '⏸ 暂停' : '▶ 播放'}
            </button>
            <button className="mode-btn" style={{ fontSize: 11, padding: '4px 8px' }} onClick={async () => { if (sessionId) await doStep(sessionId); }}>
              ⏭ 单步
            </button>
            <span style={{ fontSize: 11, color: '#4a4a6a' }}>|</span>
            <span style={{ fontSize: 11, color: '#6a6a80' }}>速度</span>
            {SPEEDS.map(s => (
              <button
                key={s}
                className="mode-btn"
                style={{ fontSize: 10, padding: '2px 8px', ...(speed === s ? { background: '#1e1e3f', color: '#7c7cff' } : {}) }}
                onClick={() => setSpeed(s)}
              >{s}x</button>
            ))}
            <span style={{ fontSize: 11, color: '#4a4a6a' }}>|</span>
            <span style={{ fontSize: 11, color: '#6a6a80' }}>
              {rs ? `${rs.current_index} / ${rs.total_klines}` : '-'}
            </span>
            <button className="mode-btn" style={{ fontSize: 10, marginLeft: 'auto', color: '#ef5350', padding: '2px 8px' }} onClick={() => { setStarted(false); setSessionId(0); setKlines([]); setRs(null); }}>
              结束回放
            </button>
          </div>
          {/* Progress bar */}
          <div style={{ width: '100%', height: 3, background: '#14142a', borderRadius: 2, marginBottom: 4, flexShrink: 0 }}>
            <div style={{ width: `${progress}%`, height: '100%', background: '#7c7cff', borderRadius: 2, transition: 'width 0.2s' }} />
          </div>
          <input
            type="range" min="0" max={rs?.total_klines || 100} value={rs?.current_index || 0}
            onChange={handleSeek}
            style={{ width: '100%', height: 4, accentColor: '#7c7cff', marginBottom: 4, flexShrink: 0 }}
          />
          {/* Chart */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <KlineChart
              data={klines}
              height={600}
              symbol={symbol}
              key={`replay-${sessionId}`}
            />
          </div>
          {/* Account / kline info */}
          <div style={{ fontSize: 10, color: '#4a4a6a', padding: '4px 8px', borderTop: '1px solid #1e1e3a', flexShrink: 0 }}>
            {rs?.is_finished ? '回放完成' : `回放中 · ${baseAsset} 现价 ${klines.length > 0 ? klines[klines.length - 1].close.toFixed(2) : '-'}`}
          </div>
        </div>
      )}
    </div>
  );
}
