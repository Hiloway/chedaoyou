import React, { useEffect, useState } from 'react';

const getAuthHeader = () => {
  const token = localStorage.getItem('lane_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const ProfileModal: React.FC<{ open: boolean; onClose: () => void; onSaved: (acct?: any) => void }> = ({ open, onClose, onSaved }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [account, setAccount] = useState<any>(null);
  const [username, setUsername] = useState('');
  const [profile, setProfile] = useState<any>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch('/api/me', { headers: { 'Content-Type': 'application/json', ...getAuthHeader() } })
      .then(async res => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.message || `${res.status} ${res.statusText}`);
        const acc = json && json.account ? json.account : json;
        setAccount(acc);
        setUsername(acc.username || '');
        setProfile(acc.profile || {});
      })
      .catch(err => {
        console.error('fetch /api/me failed', err);
        setError('无法读取账户信息');
      })
      .finally(() => setLoading(false));
  }, [open]);

  const save = async () => {
    if (!account) return;
    setSaving(true);
    setError(null);
    try {
      const body: any = { username, profile };
      const resp = await fetch(`/api/account/${account.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeader() }, body: JSON.stringify(body) });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(data?.message || `${resp.status} ${resp.statusText}`);
      setMessage('保存成功');
      // update local lane_user if username changed
      try {
        const lu = JSON.parse(localStorage.getItem('lane_user') || '{}');
        if (lu && lu.username !== username) {
          localStorage.setItem('lane_user', JSON.stringify({ role: lu.role || account.role, username }));
        }
      } catch (e) { /* ignore */ }
      onSaved && onSaved({ ...account, username, profile });
      setTimeout(() => { onClose(); }, 700);
    } catch (err: any) {
      console.error('save account failed', err);
      setError(err.message || '保存失败');
    } finally { setSaving(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-bold">账户资料</h3>
          <div className="text-sm text-slate-500">{account?.role || ''}</div>
        </div>
        <div className="p-6">
          {loading ? <div>加载中...</div> : (
            <div className="space-y-3">
              {message && <div className="p-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded">{message}</div>}
              {error && <div className="p-2 bg-red-50 border border-red-200 text-red-700 rounded">{error}</div>}
              <div className="grid grid-cols-1 gap-2">
                <label className="text-xs text-slate-500">用户名</label>
                <input value={username} onChange={e => setUsername(e.target.value)} className="border rounded px-3 py-2 text-black" />
              </div>

              {/* role specific fields */}
              {account?.role === 'user' && (
                <div className="grid grid-cols-1 gap-2">
                  <label className="text-xs text-slate-500">姓名</label>
                  <input value={profile.full_name || ''} onChange={e => setProfile((p:any) => ({ ...p, full_name: e.target.value }))} className="border rounded px-3 py-2 text-black" />
                  <label className="text-xs text-slate-500">电话</label>
                  <input value={profile.contact_phone || ''} onChange={e => setProfile((p:any) => ({ ...p, contact_phone: e.target.value }))} className="border rounded px-3 py-2 text-black" />
                  <label className="text-xs text-slate-500">邮箱</label>
                  <input value={profile.email || ''} onChange={e => setProfile((p:any) => ({ ...p, email: e.target.value }))} className="border rounded px-3 py-2 text-black" />
                  <label className="text-xs text-slate-500">地址</label>
                  <input value={profile.address || ''} onChange={e => setProfile((p:any) => ({ ...p, address: e.target.value }))} className="border rounded px-3 py-2 text-black" />
                </div>
              )}

              {account?.role === 'maintainer' && (
                <div className="grid grid-cols-1 gap-2">
                  <label className="text-xs text-slate-500">单位</label>
                  <input value={profile.organization || ''} onChange={e => setProfile((p:any) => ({ ...p, organization: e.target.value }))} className="border rounded px-3 py-2 text-black" />
                  <label className="text-xs text-slate-500">联系人</label>
                  <input value={profile.contact_person || ''} onChange={e => setProfile((p:any) => ({ ...p, contact_person: e.target.value }))} className="border rounded px-3 py-2 text-black" />
                  <label className="text-xs text-slate-500">联系电话</label>
                  <input value={profile.phone || ''} onChange={e => setProfile((p:any) => ({ ...p, phone: e.target.value }))} className="border rounded px-3 py-2 text-black" />
                  <label className="text-xs text-slate-500">许可证号</label>
                  <input value={profile.license_no || ''} onChange={e => setProfile((p:any) => ({ ...p, license_no: e.target.value }))} className="border rounded px-3 py-2 text-black" />
                  <label className="text-xs text-slate-500">服务区域</label>
                  <input value={profile.service_area || ''} onChange={e => setProfile((p:any) => ({ ...p, service_area: e.target.value }))} className="border rounded px-3 py-2 text-black" />
                </div>
              )}

              {account?.role === 'admin' && (
                <div className="grid grid-cols-1 gap-2">
                  <label className="text-xs text-slate-500">姓名</label>
                  <input value={profile.full_name || ''} onChange={e => setProfile((p:any) => ({ ...p, full_name: e.target.value }))} className="border rounded px-3 py-2 text-black" />
                  <label className="text-xs text-slate-500">电话</label>
                  <input value={profile.contact_phone || ''} onChange={e => setProfile((p:any) => ({ ...p, contact_phone: e.target.value }))} className="border rounded px-3 py-2 text-black" />
                  <label className="text-xs text-slate-500">邮箱</label>
                  <input value={profile.email || ''} onChange={e => setProfile((p:any) => ({ ...p, email: e.target.value }))} className="border rounded px-3 py-2 text-black" />
                  <label className="text-xs text-slate-500">机构</label>
                  <input value={profile.organization || ''} onChange={e => setProfile((p:any) => ({ ...p, organization: e.target.value }))} className="border rounded px-3 py-2 text-black" />
                </div>
              )}

              <div className="flex items-center justify-end gap-3 mt-4">
                <button className="px-4 py-2 bg-white border rounded text-black" onClick={onClose}>取消</button>
                <button className="px-4 py-2 bg-indigo-600 text-black rounded" onClick={save} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;
