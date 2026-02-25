import React, { useState, useEffect } from 'react';
import { X, User, Lock, Key, PlusCircle, ArrowLeft } from 'lucide-react';

const roles = [
  { value: 'admin', label: '数据管理员' },
  { value: 'maintainer', label: '维修方' },
  { value: 'user', label: '用户' },
];

const Login: React.FC<{ onLogin: (role: string, username: string) => void }> = ({ onLogin }) => {
  const [tab, setTab] = useState<'login' | 'register' | 'reset'>('login');
  const [role, setRole] = useState<string>('user');

  // common
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // register profile
  const [profile, setProfile] = useState<any>({});

  // reset flow
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resetInputToken, setResetInputToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [phone, setPhone] = useState('');

  const resetState = () => { setUsername(''); setPassword(''); setConfirm(''); setProfile({}); setMessage(null); setError(null); setResetToken(null); setResetInputToken(''); setNewPassword(''); };

  useEffect(() => {
    // Clear any browser autofill shortly after mount/open
    const t = setTimeout(() => { try { setUsername(''); setPassword(''); } catch (e) { /* ignore */ } }, 50);
    return () => clearTimeout(t);
  }, []);

  // helper to close and call onLogin as guest
  const handleClose = () => { resetState(); onLogin('guest', '游客'); };

  const doLogin = async () => {
    setError(null); setMessage(null);
    if (!username || !password) { setError('用户名和密码为必填'); return; }
    setLoading(true);
    try {
      const resp = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      let data: any = null;
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try { data = await resp.json(); } catch (e) { data = null; }
      } else {
        const text = await resp.text();
        console.error('Non-JSON response for /api/login:', resp.status, text);
      }
      if (!resp.ok) {
        setError(data?.message || `登录失败: ${resp.status} ${resp.statusText}`);
      } else {
        const acc = data?.account;
        setMessage('登录成功');
        // 持久化简单登录状态（用于刷新后仍保持登录）
        try { localStorage.setItem('lane_user', JSON.stringify({ role: acc?.role || 'user', username: acc?.username || username })); } catch (e) { /* ignore */ }
        if (data && data.token) { try { localStorage.setItem('lane_token', data.token); } catch (e) { /* ignore */ } }
        onLogin(acc?.role || 'user', acc?.username || username);
      }
    } catch (err) {
      console.error('login error', err);
      setError('网络错误：无法连接到后端');
    } finally { setLoading(false); }
  };

  const doRegister = async () => {
    setError(null); setMessage(null); setLoading(true);
    if (!username || !password) { setError('用户名和密码为必填'); setLoading(false); return; }
    if (password !== confirm) { setError('两次密码不一致'); setLoading(false); return; }
    try {
      const body: any = { username, password, role };
      if (role !== 'admin') body.profile = profile; else body.profile = profile;
      const resp = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await resp.json();
      if (!resp.ok) { setError(data?.message || '注册失败'); }
      else { setMessage('注册成功，已自动登录'); await doLogin(); }
    } catch (err) { console.error('register error', err); setError('网络错误'); }
    finally { setLoading(false); }
  };

  const doRequestReset = async () => {
    setError(null); setMessage(null); setLoading(true);
    if (!username) { setError('请输入用户名'); setLoading(false); return; }
    try {
      const resp = await fetch('/api/password-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
      const data = await resp.json();
      if (!resp.ok) { setError(data?.message || '请求失败'); }
      else { setResetToken(data.token); setMessage('已生成重置 token（开发环境展示）'); }
    } catch (err) { console.error('password-reset error', err); setError('网络错误'); }
    finally { setLoading(false); }
  };

  const doConfirmReset = async () => {
    setError(null); setMessage(null); setLoading(true);
    if (!username || !newPassword) { setError('请填写用户名与新密码'); setLoading(false); return; }
    try {
      let resp;
      if (resetInputToken) {
        resp = await fetch('/api/password-reset/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, token: resetInputToken, new_password: newPassword }) });
      } else {
        if (!oldPassword || !phone) { setError('请填写旧密码与电话号码或提供 token'); setLoading(false); return; }
        resp = await fetch('/api/password-reset/simple', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, old_password: oldPassword, phone, new_password: newPassword }) });
      }
      const data = await resp.json();
      if (!resp.ok) { setError(data?.message || '重置失败'); }
      else { setMessage('密码重置成功，请使用新密码登录'); setTab('login'); setResetToken(null); setResetInputToken(''); setNewPassword(''); setOldPassword(''); setPhone(''); }
    } catch (err) { console.error('password-reset-confirm error', err); setError('网络错误'); }
    finally { setLoading(false); }
  }; 

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[5000] bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 text-white rounded-full p-2"><User className="w-5 h-5" /></div>
            <div>
              <h3 className="text-lg font-bold">登录 / 注册</h3>
              <div className="text-xs text-slate-400">统一入口</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 bg-slate-50 rounded px-1 py-0.5 text-xs">
              <button className={`px-3 py-1 rounded ${tab === 'login' ? 'bg-indigo-600 text-white' : 'text-slate-600'}`} onClick={() => { setTab('login'); resetState(); }}>登录</button>
              <button className={`px-3 py-1 rounded ${tab === 'register' ? 'bg-indigo-600 text-white' : 'text-slate-600'}`} onClick={() => { setTab('register'); resetState(); }}>注册</button>
              <button className={`px-3 py-1 rounded ${tab === 'reset' ? 'bg-indigo-600 text-white' : 'text-slate-600'}`} onClick={() => { setTab('reset'); resetState(); }}>重置密码</button>
            </div>
            <button className="p-1 text-slate-400 hover:text-slate-800" onClick={handleClose}><X className="w-5 h-5" /></button>
          </div>
        </div>

        <form className="p-6" autoComplete="off" onSubmit={e => e.preventDefault()}>
          {/* Hidden fields to trap browser autofill */}
          <input type="text" name="prevent_autofill_username" autoComplete="username" style={{position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: 0}} />
          <input type="password" name="prevent_autofill_password" autoComplete="new-password" style={{position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: 0}} />
          {message && <div className="mb-3 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded">{message}</div>}
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded">{error}</div>}

          {tab === 'login' && (
            <div className="grid grid-cols-1 gap-3">
              <div className="flex gap-2">
                {roles.map(r => (
                  <button key={r.value} className={`flex-1 px-3 py-2 rounded ${role === r.value ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setRole(r.value)}>{r.label}</button>
                ))}
              </div>
              <input autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} className="border rounded px-3 py-2 text-black" placeholder="账号" />
              <input autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} type="password" className="border rounded px-3 py-2 text-black" placeholder="密码" />
              <div className="flex items-center justify-between">
                <button className="px-4 py-2 bg-indigo-600 text-white rounded" onClick={doLogin} disabled={loading}>{loading ? '登录中...' : '登录'}</button>
                <button className="text-sm text-slate-500 hover:underline" onClick={() => setTab('reset')}>忘记密码？</button>
              </div>
            </div>
          )}

          {tab === 'register' && (
            <div className="grid grid-cols-1 gap-3">
              <div className="flex gap-2">
                {roles.map(r => (
                  <button key={r.value} className={`flex-1 px-3 py-2 rounded ${role === r.value ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setRole(r.value)}>{r.label}</button>
                ))}
              </div>
              <input value={username} onChange={e => setUsername(e.target.value)} className="border rounded px-3 py-2 text-black" placeholder="用户名" />
              <input value={password} onChange={e => setPassword(e.target.value)} type="password" className="border rounded px-3 py-2 text-black" placeholder="密码" />
              <input value={confirm} onChange={e => setConfirm(e.target.value)} type="password" className="border rounded px-3 py-2 text-black" placeholder="确认密码" />

              {role === 'user' && (
                <div className="grid grid-cols-1 gap-2">
                  <input value={profile.full_name || ''} onChange={e => setProfile(p => ({ ...p, full_name: e.target.value }))} className="border rounded px-3 py-2 text-black" placeholder="姓名" />
                  <input value={profile.contact_phone || ''} onChange={e => setProfile(p => ({ ...p, contact_phone: e.target.value }))} className="border rounded px-3 py-2 text-black" placeholder="电话" />
                  <input value={profile.email || ''} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} className="border rounded px-3 py-2 text-black" placeholder="邮箱" />
                </div>
              )}

              {role === 'maintainer' && (
                <div className="grid grid-cols-1 gap-2">
                  <input value={profile.organization || ''} onChange={e => setProfile(p => ({ ...p, organization: e.target.value }))} className="border rounded px-3 py-2 text-black" placeholder="单位" />
                  <input value={profile.contact_person || ''} onChange={e => setProfile(p => ({ ...p, contact_person: e.target.value }))} className="border rounded px-3 py-2 text-black" placeholder="联系人" />
                  <input value={profile.phone || ''} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} className="border rounded px-3 py-2 text-black" placeholder="联系电话" />
                  <input value={profile.license_no || ''} onChange={e => setProfile(p => ({ ...p, license_no: e.target.value }))} className="border rounded px-3 py-2 text-black" placeholder="许可证号" />
                </div>
              )}

              {role === 'admin' && (
                <div className="grid grid-cols-1 gap-2">
                  <input value={profile.full_name || ''} onChange={e => setProfile(p => ({ ...p, full_name: e.target.value }))} className="border rounded px-3 py-2 text-black" placeholder="姓名" />
                  <input value={profile.contact_phone || ''} onChange={e => setProfile(p => ({ ...p, contact_phone: e.target.value }))} className="border rounded px-3 py-2 text-black" placeholder="电话" />
                  <input value={profile.email || ''} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} className="border rounded px-3 py-2 text-black" placeholder="邮箱" />
                  <input value={profile.organization || ''} onChange={e => setProfile(p => ({ ...p, organization: e.target.value }))} className="border rounded px-3 py-2 text-black" placeholder="机构" />
                </div>
              )}

              <div className="flex items-center gap-3 mt-2">
                <button className="px-4 py-2 bg-indigo-600 text-white rounded" onClick={doRegister} disabled={loading}>{loading ? '注册中...' : '注册并登录'}</button>
                <button className="px-4 py-2 bg-indigo-600 text-white rounded" onClick={() => { setTab('login'); resetState(); }}>返回登录</button>
              </div>
            </div>
          )}

          {tab === 'reset' && (
            <div className="grid grid-cols-1 gap-3">
              {!resetToken ? (
                <>
                  <input value={username} onChange={e => setUsername(e.target.value)} className="border rounded px-3 py-2 text-black" placeholder="用户名" />
                  <div className="flex items-center gap-3">
                    <button className="px-4 py-2 bg-indigo-600 text-white rounded" onClick={doRequestReset} disabled={loading}>{loading ? '请求中...' : '获取重置 token'}</button>
                    <button className="px-4 py-2 bg-indigo-600 text-white rounded" onClick={() => { setTab('login'); resetState(); }}>返回登录</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-sm text-slate-500">（开发环境展示）Token: <span className="font-mono">{resetToken}</span></div>
                  <input value={oldPassword} onChange={e => setOldPassword(e.target.value)} type="password" className="border rounded px-3 py-2 text-black" placeholder="旧密码（或留空使用 token）" />
                  <input value={phone} onChange={e => setPhone(e.target.value)} className="border rounded px-3 py-2 text-black" placeholder="电话号码（或留空使用 token）" />
                  <div className="text-xs text-slate-400">可使用 token 或 旧密码+电话号码 进行重置</div>
                  <input value={resetInputToken} onChange={e => setResetInputToken(e.target.value)} className="border rounded px-3 py-2 text-black" placeholder="在此输入 token" />
                  <input value={newPassword} onChange={e => setNewPassword(e.target.value)} type="password" className="border rounded px-3 py-2 text-black" placeholder="新密码" />
                  <div className="flex items-center gap-3">
                    <button className="px-4 py-2 bg-indigo-600 text-white rounded" onClick={doConfirmReset} disabled={loading}>{loading ? '提交中...' : '确认重置'}</button>
                    <button className="px-4 py-2 bg-white border rounded" onClick={() => { setTab('login'); resetState(); }}>返回登录</button>
                  </div>
                </>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default Login;
