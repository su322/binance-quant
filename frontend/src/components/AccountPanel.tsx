import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/quantlab';
import type { Account } from '../types';

export default function AccountPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('10000');

  const refresh = useCallback(() => {
    api.getAccounts().then(setAccounts);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreate = async () => {
    if (!name.trim()) { alert('请输入账户名称'); return; }
    const b = parseFloat(balance);
    if (isNaN(b) || b <= 0) { alert('请输入有效的初始资金'); return; }
    await api.createAccount(name.trim(), b);
    await refresh();
    setName('');
    setBalance('10000');
  };

  const handleActivate = async (id: number) => {
    await api.activateAccount(id);
    await refresh();
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`确认删除账户「${name}」？此操作不可恢复。`)) return;
    await api.deleteAccount(id);
    await refresh();
  };

  return (
    <div>
      <h3 style={{ fontSize: 13, color: '#7c7cff', marginBottom: 12, fontWeight: 500 }}>
        模拟账户
      </h3>

      <div className="inline-form">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="账户名称"
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          style={{ width: 140 }}
        />
        <input
          value={balance}
          onChange={e => setBalance(e.target.value)}
          placeholder="初始资金"
          type="number"
          min="1"
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          style={{ width: 100 }}
        />
        <button className="btn btn-primary" onClick={handleCreate}>
          新建
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="empty">还没有模拟账户，创建一个开始交易</div>
      ) : (
        <table className="data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: '200px' }}>名称</th>
              <th style={{ width: '130px' }} className="ta-right">总资产 (USDT)</th>
              <th style={{ width: '130px' }} className="ta-right">可用资金 (USDT)</th>
              <th style={{ width: '130px' }} className="ta-right">盈亏 (USDT)</th>
              <th style={{ width: '100px' }} className="ta-right">收益率</th>
              <th style={{ width: '90px' }} className="ta-center">状态</th>
              <th style={{ width: '90px' }} className="ta-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(a => {
              const pnlClass = a.total_pnl > 0 ? 'pnl-up' : a.total_pnl < 0 ? 'pnl-down' : '';
              const pctClass = a.pnl_percent > 0 ? 'pnl-up' : a.pnl_percent < 0 ? 'pnl-down' : '';
              return (
                <tr key={a.id} className={`account-row ${a.is_active ? 'active' : ''}`}>
                    <td>{a.name}</td>
                    <td className="ta-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {a.net_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="ta-right" style={{ fontVariantNumeric: 'tabular-nums', color: '#c8c8d4' }}>
                      {(a.available_balance ?? a.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className={`ta-right ${pnlClass}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {a.total_pnl >= 0 ? '+' : ''}{a.total_pnl.toFixed(2)}
                    </td>
                    <td className={`ta-right ${pctClass}`}>
                      {a.pnl_percent >= 0 ? '+' : ''}{a.pnl_percent.toFixed(2)}%
                    </td>
                    <td className="ta-center">
                      {a.is_active ? (
                        <span className="badge-active">使用中</span>
                      ) : (
                        <button className="btn btn-sm" onClick={() => handleActivate(a.id)}>切换</button>
                      )}
                    </td>
                    <td className="ta-center" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(a.id, a.name)}>
                        删除
                      </button>
                    </td>
                  </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
