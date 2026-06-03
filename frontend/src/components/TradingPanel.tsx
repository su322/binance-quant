import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/quantlab';
import type { Account, Order } from '../types';

interface Props {
  symbol: string;
  lastPrice: number;
  mode: 'spot' | 'perpetual' | 'event';
  onEventUpdate?: (entryPrice: number, created_at: string, duration: string) => void;
}

const MMR = 0.004;

export default function TradingPanel({ symbol, lastPrice, mode, onEventUpdate }: Props) {
  const [account, setAccount] = useState<Account | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [placing, setPlacing] = useState(false);

  // Shared order state
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');

  // Spot / Perpetual
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [isLimit, setIsLimit] = useState(false);
  const [limitPrice, setLimitPrice] = useState('');
  const [useUsdt, setUseUsdt] = useState(true);
  const [sellPct, setSellPct] = useState('');

  // Perpetual
  const [leverage, setLeverage] = useState('10');
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');

  // Event
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [duration, setDuration] = useState<'10m' | '30m' | '1h' | '1d'>('30m');
  const [bottomTab, setBottomTab] = useState('positions');
  const [closingSymbol, setClosingSymbol] = useState<string | null>(null);
  const [closePct, setClosePct] = useState('');
  const [editingTpSl, setEditingTpSl] = useState<string | null>(null);
  const [editTp, setEditTp] = useState('');
  const [editSl, setEditSl] = useState('');
  const [showCurrentSymbol, setShowCurrentSymbol] = useState(false);
  const [editingLev, setEditingLev] = useState(false);
  const [levInput, setLevInput] = useState('');
  const [minNotional, setMinNotional] = useState(5);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const acc = await api.getActiveAccount(mode);
      if (acc && 'error' in acc) { setAccount(null); return; }
      setAccount(acc as Account);
      if (acc && (acc as Account).id) {
        api.getOrders((acc as Account).id).then(newOrders => {
          setOrders(newOrders);
          if (onEventUpdate && mode === 'event') {
            const eventPending = (newOrders as Order[]).filter((o: Order) => o.type === 'event' && o.status === 'pending');
            if (eventPending.length > 0) {
              const o = eventPending[0];
              onEventUpdate(o.price || 0, o.created_at, o.duration || '30m');
            } else {
              onEventUpdate(0, '', '');
            }
          }
        }).catch(() => {});
      }
    } catch {
      setAccount(null);
    }
  }, [mode]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setBottomTab(mode === 'event' ? 'open' : 'positions');
  }, [mode]);

  useEffect(() => {
    if (mode === 'perpetual' && symbol) {
      api.getMinNotional(symbol, 'perpetual').then(r => setMinNotional(r.min_notional)).catch(() => setMinNotional(5));
    } else {
      setMinNotional(5);
    }
  }, [mode, symbol]);
  useEffect(() => {
    if (account?.default_leverage) setLeverage(String(account.default_leverage));
  }, [account?.default_leverage]);

  const handlePlaceOrder = async () => {
    if (!account) return;

    if (mode === 'event') {
      const a = parseFloat(amount);
      if (isNaN(a) || a <= 0) { alert('请输入有效金额'); return; }
      if (a < 5) { alert('最低投入 5 USDT'); return; }
      setPlacing(true);
      try {
        const p = lastPrice;
        const side2 = direction === 'up' ? 'buy' : 'sell';
        await api.placeOrder(account.id, symbol, side2, a, p, 'event', duration, undefined, undefined, 'event');
        await refresh();
        setAmount('');
      } catch (e: any) {
        alert(e.message || '下单失败');
      } finally {
        setPlacing(false);
      }
      return;
    }

    let q = parseFloat(quantity);
    if (isNaN(q) || q <= 0) { alert('请输入有效数量'); return; }
    const p = isLimit ? parseFloat(limitPrice) : lastPrice;
    if (isLimit && (isNaN(p) || p <= 0)) { alert('请输入有效价格'); return; }
    if (mode === 'spot') {
      if (side === 'buy') {
        const cost = useUsdt ? q : q * p;
        if (cost < 5) { alert('最低买入 5 USDT'); return; }
        if (cost > account.balance) { alert('可用余额不足'); return; }
      }
      if (side === 'sell') {
        const qty = useUsdt ? q / p : q;
        const pos = account?.positions?.find(x => x.symbol === symbol);
        const maxSell = pos ? pos.quantity : 0;
        if (qty > maxSell) {
          if (qty - maxSell < 1e-6) {
            // Tiny rounding epsilon, use exact maxSell to avoid dust
            q = useUsdt ? maxSell * p : maxSell;
          } else {
            alert('可卖数量不足'); return;
          }
        }
      }
    }
    if (mode === 'perpetual') {
      if (useUsdt && q < minNotional) { alert(`最低开仓 ${minNotional} USDT`); return; }
      if (!useUsdt && q * p < minNotional) { alert(`最低开仓 ${minNotional} USDT`); return; }
      const max = useUsdt ? account.balance * lev : account.balance * lev / p;
      if (q > max) { alert(`${useUsdt ? '金额' : '数量'}超出可开范围`); return; }
    }
    if (useUsdt) q = q / p;
    setPlacing(true);
    try {
      const tp = parseFloat(takeProfit) || undefined;
      const sl = parseFloat(stopLoss) || undefined;
      const lev = mode === 'perpetual' ? parseFloat(leverage) : undefined;
      await api.placeOrder(account.id, symbol, side, q, p, isLimit ? 'limit' : 'market', undefined, tp, sl, mode, lev);
      await refresh();
      setQuantity('');
      setSellPct('');
      setTakeProfit('');
      setStopLoss('');
    } catch (e: any) {
      alert(e.message || '下单失败');
    } finally {
      setPlacing(false);
    }
  };

  const handleClosePosition = async (sym: string, qty: number) => {
    if (!account) return;
    if (qty <= 0) { alert('请输入有效数量'); return; }
    const msg = qty >= (account.positions?.find(p => p.symbol === sym)?.quantity || 0)
      ? `确认全平 ${sym}?` : `确认平仓 ${sym} ${((qty / (account.positions?.find(p => p.symbol === sym)?.quantity || 1)) * 100).toFixed(0)}%?`;
    if (!window.confirm(msg)) return;
    setPlacing(true);
    try {
      await api.closePosition(account.id, sym, qty, lastPrice, 'perpetual');
      await refresh();
      setClosingSymbol(null);
      setClosePct('');
    } catch (e: any) {
      alert(e.message || '平仓失败');
    } finally {
      setPlacing(false);
    }
  };

  const handleUpdateTpSl = async (sym: string) => {
    if (!account) return;
    try {
      const tp = parseFloat(editTp) || undefined;
      const sl = parseFloat(editSl) || undefined;
      await api.updateTpSl(account.id, sym, mode, tp, sl);
      setEditingTpSl(null);
      setEditTp('');
      setEditSl('');
      await refresh();
    } catch (e: any) {
      alert(e.message || '修改失败');
    }
  };

  const handleCancelOrder = async (orderId: number) => {
    if (!account) return;
    if (!window.confirm('确认撤单？')) return;
    try {
      await api.cancelOrder(account.id, orderId);
      await refresh();
    } catch (e: any) {
      alert(e.message || '撤单失败');
    }
  };

  const baseAsset = symbol.replace('USDT', '');
  const price = isLimit ? (parseFloat(limitPrice) || lastPrice) : lastPrice;
  const lev = parseFloat(leverage) || 10;

  // Perpetual calculations
  let hasQty = false;
  let margin = 0;
  let liqPrice = 0;
  let liqText = '';
  let availOpen = 0;
  if (account && mode === 'perpetual') {
    availOpen = useUsdt ? account.balance * lev : account.balance * lev / price;
    if (quantity && parseFloat(quantity) > 0) {
      hasQty = true;
      const q = parseFloat(quantity);
      const qty = useUsdt ? q / price : q;
      margin = useUsdt ? q / lev : q * price / lev;
      // Cross margin liquidation price
      if (side === 'buy') {
        const num = price * qty - account.balance;
        if (num <= 0) {
          liqText = '永不';
        } else {
          liqPrice = num / (qty * (1 - MMR));
        }
      } else {
        liqPrice = (account.balance + price * qty) / (qty * (1 + MMR));
      }
    }
  }

  return (
    <div className="sidebar" style={{ width: '100%', border: 'none', borderLeft: '1px solid #1e1e3a', height: '100%', padding: 12, display: 'flex', flexDirection: 'column' }}>
      {!account ? (
        <div className="empty" style={{ padding: '40px 0' }}>
          请先在"模拟账户"中创建并启用一个账户
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          <div style={{ flexShrink: 0 }}>
          {/* Account name */}
          <div style={{ fontSize: 11, color: '#6a6a80', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            {account.name}
            {mode === 'perpetual' && (
              editingLev ? (
                <>
                  <span style={{ color: '#7c7cff' }}>杠杆 </span>
                  <input type="number" min="1" max="150" value={levInput}
                    onChange={e => setLevInput(e.target.value)}
                    style={{ width: 40, padding: '1px 3px', fontSize: 10, background: '#14142a', border: '1px solid #2a2a44', borderRadius: 3, color: '#e0e0e0' }}
                  />
                  <button className="mode-btn" style={{ fontSize: 9, color: '#26a69a', padding: '1px 4px' }} onClick={async () => {
                    const n = parseInt(levInput);
                    if (isNaN(n) || n < 1 || n > 150) { alert('杠杆范围 1-150x'); return; }
                    try { await api.setLeverage(account.id, n); setLeverage(String(n)); setEditingLev(false); } catch {}
                  }}>确认</button>
                  <button className="mode-btn" style={{ fontSize: 9, color: '#6a6a80', padding: '1px 4px' }} onClick={() => setEditingLev(false)}>取消</button>
                </>
              ) : (
                <span style={{ color: '#7c7cff', cursor: 'pointer', background: '#14142a', padding: '1px 6px', borderRadius: 4, fontSize: 10 }} onClick={() => { setLevInput(leverage); setEditingLev(true); }}>
                  默认杠杆 {leverage}x
                </span>
              )
            )}
          </div>

          {/* ---- Spot order form ---- */}
          {mode === 'spot' && (
            <div style={{ border: '1px solid #2a2a44', borderRadius: 8, padding: 10, marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                <button
                  className={`mode-btn`}
                  style={side === 'buy' ? { flex: 1, background: '#1a3a2a', color: '#26a69a', fontWeight: 600 } : { flex: 1 }}
                  onClick={() => { setSide('buy'); setSellPct(''); }}
                >买入</button>
                <button
                  className={`mode-btn`}
                  style={side === 'sell' ? { flex: 1, background: '#3a1a1a', color: '#ef5350', fontWeight: 600 } : { flex: 1 }}
                  onClick={() => { setSide('sell'); setSellPct(''); }}
                >卖出</button>
              </div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                <button className={`mode-btn ${!isLimit ? 'active' : ''}`} onClick={() => setIsLimit(false)}>市价</button>
                <button className={`mode-btn ${isLimit ? 'active' : ''}`} onClick={() => setIsLimit(true)}>限价</button>
              </div>
              <div className="form-row" style={{ marginBottom: 4 }}>
                <label>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{useUsdt ? '金额' : `数量`}</span>
                    <span style={{ cursor: 'pointer', color: '#7c7cff', fontSize: 10 }} onClick={() => { setUseUsdt(!useUsdt); setQuantity(''); setSellPct(''); }}>
                      {useUsdt ? `切到 ${baseAsset}` : `切到 USDT`}
                    </span>
                  </div>
                </label>
                <input type="number" step="any" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder={useUsdt ? 'USDT' : baseAsset} />
              </div>
              <div style={{ fontSize: 11, color: '#6a6a80', marginBottom: 8 }}>
                可用 {side === 'sell'
                  ? `${(account?.positions?.find(x => x.symbol === symbol)?.quantity || 0).toFixed(6)} ${baseAsset}`
                  : `${account.balance.toFixed(2)} USDT`
                }
              </div>
              {isLimit && (
                <div className="form-row" style={{ marginBottom: 8 }}>
                  <label>价格 (USDT)</label>
                  <input type="number" step="any" min="0" value={limitPrice} onChange={e => setLimitPrice(e.target.value)} placeholder={lastPrice.toFixed(2)} />
                </div>
              )}
              {quantity && parseFloat(quantity) > 0 && (
                <div style={{ fontSize: 11, color: '#6a6a80', marginBottom: 8 }}>
                  {useUsdt
                    ? `≈ ${(parseFloat(quantity) / price).toFixed(6)} ${baseAsset}`
                    : `≈ ${(parseFloat(quantity) * price).toFixed(2)} USDT`}
                </div>
              )}
              {mode === 'spot' && quantity && parseFloat(quantity) > 0 && (() => {
                const q = useUsdt ? parseFloat(quantity) / price : parseFloat(quantity);
                const cost = q * price;
                const pos = account?.positions?.find(p => p.symbol === symbol);
                const maxSell = pos ? pos.quantity : 0;
                const maxBuy = account.balance / price;
                if (side === 'buy' && cost < 5) return <div style={{ fontSize: 11, color: '#ef5350', marginBottom: 8 }}>最低买入 5 USDT</div>;
                if (side === 'buy' && cost > account.balance) return <div style={{ fontSize: 11, color: '#ef5350', marginBottom: 8 }}>可用余额不足 · 最多买 {(useUsdt ? account.balance : maxBuy).toFixed(useUsdt ? 2 : 6)} {useUsdt ? 'USDT' : baseAsset}</div>;
                if (side === 'sell' && q > maxSell) return <div style={{ fontSize: 11, color: '#ef5350', marginBottom: 8 }}>可卖数量不足 · 最多卖 {maxSell.toFixed(8)} {baseAsset}</div>;
                return null;
              })()}
              {mode === 'spot' && side === 'sell' && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                    {[25, 50, 75, 100].map(pct => {
                      const pos = account?.positions?.find(p => p.symbol === symbol);
                      const pctQty = pos ? (pos.quantity * pct) / 100 : 0;
                      return (
                        <button
                          key={pct}
                          className="mode-btn"
                          style={{ flex: 1, fontSize: 10, padding: '3px 0', background: quantity && parseFloat(quantity) > 0 && Math.abs(parseFloat(quantity) - pctQty) / (pctQty || 1) < 0.001 ? '#1e1e3f' : undefined }}
                          onClick={() => { setUseUsdt(false); setQuantity(pct === 100 && pos ? pos.quantity.toString() : (Math.floor(pctQty * 1e6) / 1e6).toFixed(6)); }}
                        >{pct}%</button>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                      type="number" min="0" max="100" placeholder="百分比"
                      value={sellPct}
                      onChange={e => {
                        setSellPct(e.target.value);
                        const pos = account?.positions?.find(p => p.symbol === symbol);
                        const v = parseFloat(e.target.value);
                        if (pos && !isNaN(v) && v > 0) {
                          setUseUsdt(false);
                          if (v >= 100) {
                            setQuantity(pos.quantity.toString());
                          } else {
                            setQuantity((Math.floor(pos.quantity * v / 100 * 1e6) / 1e6).toFixed(6));
                          }
                        }
                      }}
                      style={{ width: 70, background: '#14142a', border: '1px solid #2a2a44', borderRadius: 4, color: '#e0e0e0', padding: '4px 6px', fontSize: 11 }}
                    />
                    <span style={{ fontSize: 11, color: '#6a6a80' }}>%</span>
                  </div>
                </div>
              )}
              <button
                className="btn" style={{ width: '100%', background: side === 'buy' ? '#26a69a' : '#ef5350', color: '#fff', fontWeight: 600, opacity: placing ? 0.6 : 1 }}
                disabled={placing || !quantity} onClick={handlePlaceOrder}
              >
                {placing ? '委托中...' : `${side === 'buy' ? '买入' : '卖出'} ${baseAsset}`}
              </button>
            </div>
          )}

          {/* ---- Perpetual order form ---- */}
          {mode === 'perpetual' && (
            <div style={{ border: '1px solid #2a2a44', borderRadius: 8, padding: 10, marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                <button
                  className={`mode-btn`}
                  style={side === 'buy' ? { flex: 1, background: '#1a3a2a', color: '#26a69a', fontWeight: 600 } : { flex: 1 }}
                  onClick={() => setSide('buy')}
                >做多</button>
                <button
                  className={`mode-btn`}
                  style={side === 'sell' ? { flex: 1, background: '#3a1a1a', color: '#ef5350', fontWeight: 600 } : { flex: 1 }}
                  onClick={() => setSide('sell')}
                >做空</button>
              </div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                <button className={`mode-btn ${!isLimit ? 'active' : ''}`} onClick={() => setIsLimit(false)}>市价</button>
                <button className={`mode-btn ${isLimit ? 'active' : ''}`} onClick={() => setIsLimit(true)}>限价</button>
              </div>
              <div className="form-row" style={{ marginBottom: 4 }}>
                <label>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{useUsdt ? '金额' : `数量`}</span>
                    <span style={{ cursor: 'pointer', color: '#7c7cff', fontSize: 10 }} onClick={() => { setUseUsdt(!useUsdt); setQuantity(''); }}>
                      {useUsdt ? `切到 ${baseAsset}` : `切到 USDT`}
                    </span>
                  </div>
                </label>
                <input type="number" step="any" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder={useUsdt ? 'USDT' : baseAsset} />
              </div>
              <div style={{ fontSize: 11, color: '#6a6a80', marginBottom: 8 }}>
                可用 {account.balance.toFixed(2)} USDT
              </div>
              {isLimit && (
                <div className="form-row" style={{ marginBottom: 8 }}>
                  <label>价格 (USDT)</label>
                  <input type="number" step="any" min="0" value={limitPrice} onChange={e => setLimitPrice(e.target.value)} placeholder={lastPrice.toFixed(2)} />
                </div>
              )}
              <div className="form-row" style={{ marginBottom: 8 }}>
                <label>止盈 <span style={{ color: '#6a6a80', fontWeight: 400 }}>(市价)</span></label>
                <input
                  type="number" step="any" min="0"
                  value={takeProfit} onChange={e => setTakeProfit(e.target.value)}
                  placeholder="可选"
                />
              </div>
              <div className="form-row" style={{ marginBottom: 8 }}>
                <label>止损 <span style={{ color: '#6a6a80', fontWeight: 400 }}>(市价)</span></label>
                <input
                  type="number" step="any" min="0"
                  value={stopLoss} onChange={e => setStopLoss(e.target.value)}
                  placeholder="可选"
                />
              </div>
              <div style={{ fontSize: 11, color: '#6a6a80', marginBottom: 8, lineHeight: 1.6 }}>
                {hasQty && <div>强平价格 {liqText || `${liqPrice.toFixed(2)} USDT`}</div>}
                <div>可开 {availOpen.toFixed(useUsdt ? 2 : 6)} {useUsdt ? 'USDT' : baseAsset}</div>
                <div>保证金 {margin.toFixed(2)} USDT <span style={{ color: '#4a4a6a' }}>全仓</span>
                </div>
              </div>
              {quantity && parseFloat(quantity) > 0 && (() => {
                const v = useUsdt ? parseFloat(quantity) : parseFloat(quantity) * price;
                if (v < minNotional) return <div style={{ fontSize: 11, color: '#ef5350', marginBottom: 8 }}>最低开仓 {minNotional} USDT</div>;
                if (v > availOpen) return <div style={{ fontSize: 11, color: '#ef5350', marginBottom: 8 }}>超出可开范围</div>;
                return null;
              })()}
              <button
                className="btn" style={{ width: '100%', background: side === 'buy' ? '#26a69a' : '#ef5350', color: '#fff', fontWeight: 600, opacity: placing ? 0.6 : 1 }}
                disabled={placing || !quantity} onClick={handlePlaceOrder}
              >
                {placing ? '委托中...' : `${side === 'buy' ? '做多' : '做空'} ${baseAsset}`}
              </button>
            </div>
          )}

          {/* ---- Event contract order form ---- */}
          {mode === 'event' && (
            <div style={{ border: '1px solid #2a2a44', borderRadius: 8, padding: 10, marginBottom: 12 }}>
              {/* Duration selector */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                {(['10m', '30m', '1h', '1d'] as const).map(d => (
                  <button
                    key={d}
                    className="mode-btn"
                    style={duration === d ? { flex: 1, background: '#1e1e3f', color: '#7c7cff', fontWeight: 600 } : { flex: 1 }}
                    onClick={() => setDuration(d)}
                  >
                    {d === '10m' ? '10分钟' : d === '30m' ? '30分钟' : d === '1h' ? '1小时' : '1天'}
                  </button>
                ))}
              </div>
              <div className="form-row" style={{ marginBottom: 4 }}>
                <label>投入金额 (USDT)</label>
                <input type="number" step="any" min="5" value={amount} onChange={e => setAmount(e.target.value)} placeholder="USDT" />
              </div>
              <div style={{ fontSize: 11, color: '#6a6a80', marginBottom: 10 }}>
                可用 {account.balance.toFixed(2)} USDT
              </div>
              {amount && parseFloat(amount) > 0 && parseFloat(amount) < 5 && (
                <div style={{ fontSize: 11, color: '#ef5350', marginBottom: 6 }}>最低投入 5 USDT</div>
              )}
              <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                <button
                  className="mode-btn"
                  style={direction === 'up' ? { flex: 1, height: 44, background: '#1a3a2a', color: '#26a69a', fontWeight: 700, fontSize: 15 } : { flex: 1, height: 44, fontSize: 15 }}
                  onClick={() => setDirection('up')}
                >↑ 涨</button>
                <button
                  className="mode-btn"
                  style={direction === 'down' ? { flex: 1, height: 44, background: '#3a1a1a', color: '#ef5350', fontWeight: 700, fontSize: 15 } : { flex: 1, height: 44, fontSize: 15 }}
                  onClick={() => setDirection('down')}
                >↓ 跌</button>
              </div>
              <div style={{ fontSize: 11, color: '#6a6a80', marginBottom: 10, textAlign: 'center' }}>
                支付率 {(duration === '10m' ? 0.8 : 0.85) * 100}%
                {amount && parseFloat(amount) > 0 && (
                  <span> &middot; 支付金额 {(parseFloat(amount) * (duration === '10m' ? 0.8 : 0.85)).toFixed(2)} USDT</span>
                )}
              </div>
              <button
                className="btn" style={{ width: '100%', background: direction === 'up' ? '#26a69a' : '#ef5350', color: '#fff', fontWeight: 600, opacity: placing ? 0.6 : 1 }}
                disabled={placing || !amount} onClick={handlePlaceOrder}
              >
                {placing ? '委托中...' : `预测${direction === 'up' ? '上涨' : '下跌'}`}
              </button>
            </div>
          )}
          </div>

          {/* Bottom tabs */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {(() => {
            const isEvent = mode === 'event';
            const tabs = isEvent
              ? [{ key: 'open', label: '已开仓' }, { key: 'settled', label: '已平仓' }]
              : [
                  { key: 'positions', label: mode === 'spot' ? '持有币种' : '持有仓位' },
                  { key: 'pending', label: '当前委托' },
                  { key: 'history', label: '历史成交' },
                ];

            const getRemainingSeconds = (createdAt: string, dur: string | null) => {
              const map: Record<string, number> = { '10m': 600, '30m': 1800, '1h': 3600, '1d': 86400 };
              const secs = map[dur || '30m'];
              const ts = createdAt.endsWith('Z') ? createdAt : createdAt + 'Z';
              const elapsed = (Date.now() - new Date(ts).getTime()) / 1000;
              return Math.max(0, Math.ceil(secs - elapsed));
            };

            const formatTime = (ts: string) => {
              const d = new Date(ts.endsWith('Z') ? ts : ts + 'Z');
              return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            };

            const renderContent = () => {
              if (isEvent && bottomTab === 'open') {
                const eventOpen = orders.filter(o => o.type === 'event' && o.status === 'pending');
                if (eventOpen.length === 0) return <div style={{ fontSize: 11, color: '#4a4a6a', textAlign: 'center', padding: '16px 0' }}>暂无数据</div>;
                return eventOpen.map(o => {
                  const remaining = getRemainingSeconds(o.created_at, o.duration);
                  const payoutRate = o.duration === '10m' ? 0.8 : 0.85;
                  return (
                    <div key={o.id} style={{ fontSize: 12, padding: '8px 0', borderBottom: '1px solid #14142a' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ color: o.side === 'buy' ? '#26a69a' : '#ef5350', fontWeight: 600 }}>
                          {o.side === 'buy' ? '看涨' : '看跌'} · {o.duration}
                        </span>
                        <span style={{ color: remaining > 60 ? '#7c7cff' : '#ef5350', fontWeight: 500 }}>
                          {remaining > 0 ? `${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}` : '00:00'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6a6a80', fontSize: 11, marginBottom: 2 }}>
                        <span>投入 {o.quantity?.toFixed(2)} USDT</span>
                        <span>入场价 {o.price?.toFixed(2)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4a4a6a', fontSize: 10 }}>
                        <span>支付率 {(payoutRate * 100).toFixed(0)}%</span>
                        <span>开仓 {formatTime(o.created_at)}</span>
                      </div>
                    </div>
                  );
                });
              }

              if (isEvent && bottomTab === 'settled') {
                const eventSettled = orders.filter(o => o.type === 'event' && o.status !== 'pending');
                if (eventSettled.length === 0) return <div style={{ fontSize: 11, color: '#4a4a6a', textAlign: 'center', padding: '16px 0' }}>暂无数据</div>;
                const wins = eventSettled.filter(o => o.status === 'filled');
                const totalQty = eventSettled.reduce((s, o) => s + (o.quantity || 0), 0);
                const totalProfit = wins.reduce((s, o) => {
                  const rate = o.duration === '10m' ? 0.8 : 0.85;
                  return s + (o.quantity || 0) * rate;
                }, 0);
                const totalLoss = eventSettled.filter(o => o.status !== 'filled').reduce((s, o) => s + (o.quantity || 0), 0);
                const netPnl = totalProfit - totalLoss;
                const winRate = eventSettled.length > 0 ? wins.length / eventSettled.length : 0;
                return (
                  <>
                    <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e1e3a', fontSize: 11 }}>
                      <div style={{ display: 'flex', marginBottom: 6 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#4a4a6a', marginBottom: 2 }}>总盈亏</div>
                          <div style={{ color: netPnl >= 0 ? '#26a69a' : '#ef5350', fontWeight: 600 }}>{netPnl >= 0 ? '+' : ''}{netPnl.toFixed(2)}</div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#4a4a6a', marginBottom: 2 }}>合约张数</div>
                          <div style={{ color: '#e0e0e0', fontWeight: 600 }}>{eventSettled.length}</div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#4a4a6a', marginBottom: 2 }}>胜率</div>
                          <div style={{ color: winRate >= 0.5 ? '#26a69a' : '#ef5350', fontWeight: 600 }}>{(winRate * 100).toFixed(1)}%</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#4a4a6a', marginBottom: 2 }}>合约金额</div>
                          <div style={{ color: '#e0e0e0', fontWeight: 600 }}>{totalQty.toFixed(2)}</div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#4a4a6a', marginBottom: 2 }}>总收益</div>
                          <div style={{ color: '#26a69a', fontWeight: 600 }}>+{totalProfit.toFixed(2)}</div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#4a4a6a', marginBottom: 2 }}>总亏损</div>
                          <div style={{ color: '#ef5350', fontWeight: 600 }}>-{totalLoss.toFixed(2)}</div>
                        </div>
                      </div>
                    </div>
                    {eventSettled.slice().reverse().map(o => {
                  const isWin = o.status === 'filled';
                  const payoutRate = o.duration === '10m' ? 0.8 : 0.85;
                  const profit = isWin ? o.quantity * payoutRate : -o.quantity;
                  // created_at is open time, updated_at not stored, use close time from trade — approximate with current
                  return (
                    <div key={o.id} style={{ fontSize: 12, padding: '8px 0', borderBottom: '1px solid #14142a' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ color: o.side === 'buy' ? '#26a69a' : '#ef5350', fontWeight: 600 }}>
                          {o.side === 'buy' ? '看涨' : '看跌'} · {o.duration}
                        </span>
                        <span style={{ color: isWin ? '#26a69a' : '#ef5350', fontWeight: 600 }}>
                          {isWin ? '+' : ''}{profit.toFixed(2)} USDT
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6a6a80', fontSize: 11, marginBottom: 2 }}>
                        <span>投入 {o.quantity?.toFixed(2)} USDT</span>
                        <span>支付率 {(payoutRate * 100).toFixed(0)}%</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6a6a80', fontSize: 11, marginBottom: 2 }}>
                        <span>开仓 {o.price?.toFixed(2)}</span>
                        <span>平仓 {o.filled_price?.toFixed(2)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4a4a6a', fontSize: 10 }}>
                        <span>开仓 {formatTime(o.created_at)}</span>
                        <span>{isWin ? '已盈利' : '已亏损'}</span>
                      </div>
                    </div>
                  );
                })}
                </>
              );
              }

              if (bottomTab === 'positions') {
                const activePositions = (account?.positions || []).filter(p => p.quantity > 0 && (!showCurrentSymbol || p.symbol === symbol));
                if (activePositions.length === 0) return <div style={{ fontSize: 11, color: '#4a4a6a', textAlign: 'center', padding: '16px 0' }}>暂无数据</div>;
                return activePositions.map(p => (
                  <div key={p.symbol} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid #14142a' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 500 }}>
                        {p.symbol}
                        {mode === 'perpetual' && (
                          <span style={{ fontSize: 10, marginLeft: 4, color: p.side === 'short' ? '#ef5350' : '#26a69a' }}>
                            {p.side === 'short' ? '空' : '多'}
                          </span>
                        )}
                      </span>
                      <span>{p.quantity.toFixed(8)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6a6a80', fontSize: 11 }}>
                      <span>均价 {p.avg_entry.toFixed(2)}</span>
                      <span>现价 {p.current_price.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4a4a6a', fontSize: 10, marginTop: 1 }}>
                      <span>≈ {(p.quantity * p.current_price).toFixed(2)} USDT</span>
                      <span>{p.current_price > 0 ? (((p.current_price - p.avg_entry) / p.avg_entry) * 100).toFixed(2) : '0.00'}%</span>
                    </div>
                    {mode === 'perpetual' && (
                      <>
                        <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 10, color: '#6a6a80' }}>
                            已实现盈亏 {p.realized_pnl >= 0 ? '+' : ''}{p.realized_pnl?.toFixed(2)}
                          </span>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            {closingSymbol === p.symbol ? (
                              <>
                                <input
                                  type="number" min="0" max="100"
                                  value={closePct}
                                  onChange={e => {
                                    let v = e.target.value;
                                    if (v) { const n = parseFloat(v); if (n > 100) v = '100'; if (n < 0) v = '0'; }
                                    setClosePct(v);
                                  }}
                                  placeholder="百分比"
                                  style={{ width: 56, padding: '2px 4px', fontSize: 11, background: '#14142a', border: '1px solid #2a2a44', borderRadius: 4, color: '#e0e0e0' }}
                                />
                                <span style={{ fontSize: 10, color: '#6a6a80' }}>%</span>
                                <button
                                  className="mode-btn" style={{ fontSize: 10, color: '#ef5350', padding: '2px 6px' }}
                                  onClick={() => {
                                    const pct = parseFloat(closePct);
                                    if (!isNaN(pct) && pct > 0) handleClosePosition(p.symbol, p.quantity * pct / 100);
                                  }}
                                >平仓</button>
                                <button
                                  className="mode-btn" style={{ fontSize: 10, color: '#ef5350', padding: '2px 6px' }}
                                  onClick={() => handleClosePosition(p.symbol, p.quantity)}
                                >全平</button>
                                <button
                                  className="mode-btn" style={{ fontSize: 10, color: '#6a6a80', padding: '2px 6px' }}
                                  onClick={() => { setClosingSymbol(null); setClosePct(''); }}
                                >取消</button>
                              </>
                            ) : (
                              <button
                                className="mode-btn" style={{ fontSize: 10, color: '#ef5350', padding: '2px 8px' }}
                                onClick={() => setClosingSymbol(p.symbol)}
                              >平仓</button>
                            )}
                          </div>
                        </div>
                        {/* TP/SL */}
                        <div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
                          {editingTpSl === p.symbol ? (
                            <>
                              <input type="number" step="any" value={editTp} onChange={e => setEditTp(e.target.value)} placeholder="止盈价" style={{ width: 72, padding: '2px 4px', fontSize: 11, background: '#14142a', border: '1px solid #2a2a44', borderRadius: 4, color: '#e0e0e0' }} />
                              <input type="number" step="any" value={editSl} onChange={e => setEditSl(e.target.value)} placeholder="止损价" style={{ width: 72, padding: '2px 4px', fontSize: 11, background: '#14142a', border: '1px solid #2a2a44', borderRadius: 4, color: '#e0e0e0' }} />
                              <button className="mode-btn" style={{ fontSize: 10, color: '#26a69a', padding: '2px 6px' }} onClick={() => handleUpdateTpSl(p.symbol)}>确认</button>
                              <button className="mode-btn" style={{ fontSize: 10, color: '#6a6a80', padding: '2px 6px' }} onClick={() => setEditingTpSl(null)}>取消</button>
                            </>
                          ) : (
                            <>
                              <span style={{ color: '#4a4a6a' }}>止盈 <span style={{ color: p.take_profit ? '#26a69a' : '#3a3a5a' }}>{p.take_profit ? p.take_profit.toFixed(2) : '--'}</span></span>
                              <span style={{ color: '#4a4a6a' }}>止损 <span style={{ color: p.stop_loss ? '#ef5350' : '#3a3a5a' }}>{p.stop_loss ? p.stop_loss.toFixed(2) : '--'}</span></span>
                              <button className="mode-btn" style={{ fontSize: 10, color: '#7c7cff', padding: '2px 6px' }} onClick={() => { setEditingTpSl(p.symbol); setEditTp(p.take_profit?.toString() || ''); setEditSl(p.stop_loss?.toString() || ''); }}>修改</button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ));
              }

              if (bottomTab === 'pending') {
                const pendingOrders = orders.filter(o => o.status === 'pending' && o.type !== 'event' && o.mode === mode);
                if (pendingOrders.length === 0) return <div style={{ fontSize: 11, color: '#4a4a6a', textAlign: 'center', padding: '16px 0' }}>暂无数据</div>;
                return pendingOrders.slice().reverse().map(o => (
                  <div key={o.id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid #14142a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ color: o.side === 'buy' ? '#26a69a' : '#ef5350', fontWeight: 500 }}>
                        {o.side === 'buy' ? '买入' : '卖出'}
                      </span>
                      <span style={{ color: '#6a6a80', marginLeft: 4 }}>{o.symbol}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>{o.quantity}</span>
                      <span style={{ color: '#6a6a80' }}>@{o.price?.toFixed(2)}</span>
                      <button
                        onClick={() => handleCancelOrder(o.id)}
                        style={{
                          padding: '1px 6px', fontSize: 10, borderRadius: 3,
                          background: 'none', border: '1px solid #ef5350', color: '#ef5350',
                          cursor: 'pointer',
                        }}
                      >撤单</button>
                    </div>
                  </div>
                ));
              }

              if (bottomTab === 'history') {
                const historyOrders = orders.filter(o => o.status !== 'pending' && o.type !== 'event' && o.mode === mode);
                if (historyOrders.length === 0) return <div style={{ fontSize: 11, color: '#4a4a6a', textAlign: 'center', padding: '16px 0' }}>暂无数据</div>;
                return historyOrders.slice(-20).reverse().map(o => (
                  <div key={o.id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid #14142a', display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      {o.status === 'canceled' ? (
                        <>
                          <span style={{ color: '#6a6a80', fontWeight: 500 }}>撤销</span>
                          <span style={{ color: '#6a6a80', marginLeft: 4 }}>{o.symbol}</span>
                        </>
                      ) : (
                        <>
                          <span style={{ color: o.side === 'buy' ? '#26a69a' : '#ef5350', fontWeight: 500 }}>
                            {o.side === 'buy' ? '买入' : '卖出'}
                          </span>
                          <span style={{ color: '#6a6a80', marginLeft: 4 }}>{o.symbol}</span>
                        </>
                      )}
                    </div>
                    <div>
                      {(() => {
                        const qty = o.status === 'canceled' ? o.quantity : (o.filled_qty || o.quantity);
                        const fmtQty = typeof qty === 'number' && qty < 0.001 ? qty.toFixed(8) : qty.toFixed(6);
                        const price = o.filled_price || o.price;
                        return (
                          <>
                            <span>{fmtQty}</span>
                            <span style={{ color: '#6a6a80', marginLeft: 4 }}>@{price?.toFixed(2)}</span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                ));
              }

              return null;
            };

            return (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, paddingLeft: 2 }}>
                  <span style={{ fontSize: 10, color: '#4a4a6a' }}>
                    {mode === 'perpetual' ? 'Taker 0.05% / Maker 0.02% 手续费' : mode === 'event' ? '' : '默认无手续费'}
                  </span>
                  {mode !== 'event' && (
                    <label style={{ fontSize: 10, color: '#6a6a80', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                      <input type="checkbox" checked={showCurrentSymbol} onChange={e => setShowCurrentSymbol(e.target.checked)} style={{ accentColor: '#7c7cff' }} />
                      只显示当前交易对
                    </label>
                  )}
                </div>
                <div style={{ display: 'flex', borderBottom: '1px solid #1e1e3a', marginBottom: 8 }}>
                  {tabs.map(t => (
                    <button
                      key={t.key}
                      onClick={() => setBottomTab(t.key)}
                      style={{
                        flex: 1, padding: '6px 0', fontSize: 11, background: 'none', border: 'none',
                        color: bottomTab === t.key ? '#7c7cff' : '#4a4a6a',
                        fontWeight: bottomTab === t.key ? 600 : 400,
                        borderBottom: bottomTab === t.key ? '2px solid #7c7cff' : '2px solid transparent',
                        cursor: 'pointer',
                      }}
                    >{t.label}</button>
                  ))}
                </div>
                {renderContent()}
              </div>
            );
          })()}
          </div>
        </div>
      )}
    </div>
  );
}
