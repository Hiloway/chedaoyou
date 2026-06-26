/**
 * api.ts - 统一前端 API 客户端
 * 替代散落各处的 fetch/axios 调用，统一处理：
 *  - 鉴权 header（从 localStorage.lane_token 读取）
 *  - JSON 序列化与响应解析
 *  - HTTP 错误抛出（含后端 message）
 *  - AI 服务走后端代理（不再直调外部 API，避免 Key 泄露）
 */

const TOKEN_KEY = 'lane_token';

export const getToken = (): string | null => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};

export const setToken = (token: string | null) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
};

const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * 基础请求函数，返回解析后的 JSON 数据（等价于 axios 的 res.data）
 */
async function request<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...authHeaders(),
    ...(options.headers as Record<string, string> || {}),
  };
  const resp = await fetch(url, { ...options, headers });
  // 204 或空响应直接返回
  if (resp.status === 204) return undefined as T;
  const text = await resp.text();
  const data = text ? safeJsonParse(text) : null;
  if (!resp.ok) {
    const message = (data && data.message) ? data.message : `HTTP ${resp.status}`;
    const err: any = new Error(message);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

const safeJsonParse = (text: string): any => {
  try { return JSON.parse(text); } catch { return text; }
};

// ============ 鉴权 / 账号 ============
export const authApi = {
  login: (username: string, password: string) =>
    request<{ ok: boolean; account: any; token: string; expiresIn: string }>('/api/login', {
      method: 'POST', body: JSON.stringify({ username, password }),
    }),
  register: (body: { username: string; password: string; role?: string; profile?: any }) =>
    request<{ ok: boolean; account: any }>('/api/register', { method: 'POST', body: JSON.stringify(body) }),
  me: () => request<{ ok: boolean; account: any }>('/api/me'),
  adminInit: (body: { username: string; password: string; profile?: any }) =>
    request<{ ok: boolean; account: any; token: string }>('/api/admin/init', { method: 'POST', body: JSON.stringify(body) }),
  requestPasswordReset: (username: string) =>
    request<{ ok: boolean; token: string; expires: string }>('/api/password-reset', { method: 'POST', body: JSON.stringify({ username }) }),
  confirmPasswordReset: (body: { username: string; token: string; new_password: string }) =>
    request<{ ok: boolean }>('/api/password-reset/confirm', { method: 'POST', body: JSON.stringify(body) }),
  simplePasswordReset: (body: { username: string; old_password: string; phone: string; new_password: string }) =>
    request<{ ok: boolean }>('/api/password-reset/simple', { method: 'POST', body: JSON.stringify(body) }),
};

// ============ 账号资料 ============
export const accountApi = {
  get: (id: number) => request<any>(`/api/account/${id}`),
  update: (id: number, body: any) => request<{ ok: boolean }>(`/api/account/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  changePassword: (id: number, old_password: string, new_password: string) =>
    request<{ ok: boolean }>(`/api/account/${id}/password`, { method: 'POST', body: JSON.stringify({ old_password, new_password }) }),
  maintainers: () => request<any[]>('/api/maintainers'),
};

// ============ 路况 ============
export const roadApi = {
  get: (roadId: string) => request<any>(`/api/road-condition/${encodeURIComponent(roadId)}`),
  transitions: (roadId: string, limit?: number) =>
    request<any[]>(`/api/road-condition/${encodeURIComponent(roadId)}/transitions${limit ? `?limit=${limit}` : ''}`),
  upsert: (payload: any) => request<{ ok: boolean; record: any; workflow: any }>('/api/road-condition', { method: 'POST', body: JSON.stringify(payload) }),
  batchGet: (ids: string[]) => request<any[]>(`/api/road-conditions/batch`, { method: 'POST', body: JSON.stringify({ ids }) }),
  batchGetByQuery: (ids: string[]) => request<any[]>(`/api/road-conditions?ids=${ids.join(',')}`),
};

// ============ 消息 ============
export const messageApi = {
  list: (params: { road_id?: string; ids?: string; unread?: boolean; reporter_id?: string; name?: string; count?: boolean; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      if (typeof v === 'boolean') qs.set(k, v ? '1' : '0');
      else qs.set(k, String(v));
    });
    const q = qs.toString();
    return request<any[]>(`/api/messages${q ? `?${q}` : ''}`);
  },
  // 仅返回未读计数（后端 count=1 时返回 { count }）
  unreadCount: () => request<{ count: number }>('/api/messages?unread=1&count=1'),
  batchGet: (ids: string[]) => request<any[]>(`/api/messages/batch`, { method: 'POST', body: JSON.stringify({ ids }) }),
  create: (payload: any) => request<{ ok: boolean; id: number; record: any }>('/api/message', { method: 'POST', body: JSON.stringify(payload) }),
  markRead: (id: number) => request<{ ok: boolean; record: any }>(`/api/message/${id}/read`, { method: 'PUT' }),
  remove: (id: number) => request<{ ok: boolean; affected: number }>(`/api/message/${id}`, { method: 'DELETE' }),
  removeRead: () => request<{ ok: boolean; affected: number }>(`/api/messages?read=1`, { method: 'DELETE' }),
};

// ============ 维修报告 ============
export const repairApi = {
  list: (roadId: string) => request<any[]>(`/api/repair-reports?road_id=${encodeURIComponent(roadId)}`),
  create: (payload: any) => request<{ ok: boolean; id: number; record: any }>('/api/repair-report', { method: 'POST', body: JSON.stringify(payload) }),
};

// ============ AI（走后端代理） ============
export const aiApi = {
  analyzeLane: (laneData: any) =>
    request<{ safety: any; insights: any; suggestions: string[] }>('/api/ai/analyze-lane', { method: 'POST', body: JSON.stringify({ laneData }) }),
  analyzeDamage: (photoUrl: string, meta?: { roadName?: string; locationText?: string }) =>
    request<{ ok: boolean; data: any }>('/api/ai/analyze-damage', { method: 'POST', body: JSON.stringify({ photoUrl, ...meta }) }),
  chat: (history: { role: string; content: string }[], message: string) =>
    request<{ ok: boolean; content: string }>('/api/ai/chat', { method: 'POST', body: JSON.stringify({ history, message }) }),
};

// ============ 健康 ============
export const healthApi = {
  check: () => request<{ ok: boolean; ts: number }>('/api/health'),
};

export default { auth: authApi, account: accountApi, road: roadApi, message: messageApi, repair: repairApi, ai: aiApi, health: healthApi };
