import React, { useEffect, useState } from 'react';
import axios from 'axios';
import ReactDOM from 'react-dom';
import { X, Trash2 } from 'lucide-react';

interface MessageRecord {
  id: number;
  road_id?: string;
  road_name?: string;
  type?: string;
  name?: string;
  contact?: string;
  text?: string;
  photo_urls?: string[];
  lat?: number;
  lng?: number;
  is_read?: number;
  created_at?: string;
  assigned_to?: string; // 指派给哪个维修方
}

interface MessageBoxProps {
  visible: boolean;
  onClose: () => void;
  filter?: { reporter_id?: string; name?: string } | null;
  user: { role: string; username: string };
}

const MessageBox: React.FC<MessageBoxProps> = ({ visible, onClose, filter = null, user }) => {
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'unread' | 'read'>('unread');
  // 当前预览的图片 URL（点击缩略图会打开预览）
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const fetchMessages = async (flt?: { reporter_id?: string; name?: string } | null) => {
    setLoading(true);
    try {
      let url = '/api/messages';
      const params: string[] = [];
      if (flt && flt.reporter_id) params.push(`reporter_id=${encodeURIComponent(flt.reporter_id)}`);
      if (flt && flt.name) params.push(`name=${encodeURIComponent(flt.name)}`);
      // 增加默认 limit，避免导致后端过大排序（后端已支持 limit/offset）
      params.push(`limit=${encodeURIComponent(1000)}`);
      if (params.length) url += '?' + params.join('&');
      const resp = await axios.get(url);
      const raw = resp.data || [];
      // 规范化 photo_urls 字段：后端可能以 JSON 字符串保存，前端需要数组
      const normalized = raw.map((r: any) => {
        let photos: any = r.photo_urls;
        if (!photos) photos = [];
        else if (!Array.isArray(photos)) {
          try { photos = JSON.parse(photos); } catch (e) { photos = []; }
        }
        return { ...r, photo_urls: photos };
      });
      setMessages(normalized);
    } catch (err) {
      console.error('fetch messages error', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    fetchMessages(filter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, filter]);

  const markRead = async (id: number) => {
    try {
      await axios.put(`/api/message/${id}/read`);
      // move locally
      setMessages(prev => prev.map(m => m.id === id ? { ...m, is_read: 1 } : m));
      // notify others (Sidebar) to refresh unread count immediately
      window.dispatchEvent(new CustomEvent('messages-updated'));
    } catch (err) {
      console.error('mark read error', err);
    }
  };

  // 根据用户角色过滤消息
  const filteredMessages = messages.filter(m => {
    if (user.role === 'admin') {
      // 管理员可以看到所有消息
      return true;
    } else if (user.role === 'maintainer') {
      // 维修方只能看到分配给自己的任务消息
      return m.assigned_to === user.username || m.type === 'task';
    } else {
      // 普通用户只能看到自己发送的消息（通过 name 或 contact 匹配）
      return m.name === user.username || m.contact === user.username;
    }
  });

  const unread = filteredMessages.filter(m => !m.is_read);
  const read = filteredMessages.filter(m => m.is_read);

  const deleteMessage = async (id: number) => {
    if (!confirm('确认删除此条消息？此操作不可恢复。')) return;
    try {
      await axios.delete(`/api/message/${id}`);
      window.dispatchEvent(new CustomEvent('messages-updated'));
      await fetchMessages();
    } catch (err) {
      console.error('delete message error', err);
      alert('删除失败');
    }
  };

  const content = (() => {
    if (loading) return <div className="text-center py-10">加载中...</div>;
    if (tab === 'unread') {
      if (unread.length === 0) return <div className="text-center py-10">暂无未读消息</div>;
      return (
        <div className="space-y-3">
          {unread.map(msg => (
            <div key={msg.id} className={`p-4 rounded-xl border bg-yellow-50 border-yellow-200`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm text-slate-500 mb-1">{msg.created_at} · {msg.type === 'maintainer' ? '维修方' : '用户'} · {msg.road_name || msg.road_id || '-'}</div>
                  <div className="font-bold text-slate-900">{msg.name || (msg.contact || '匿名')}</div>
                  <div className="text-sm text-slate-700 mt-2 whitespace-pre-line">{msg.text}</div>
                  {msg.photo_urls && msg.photo_urls.length > 0 && (
                    <div className="flex gap-2 mt-3">
                      {msg.photo_urls.map((p, i) => (
                        <button key={i} type="button" onClick={() => setSelectedImage(p)} className="rounded-md overflow-hidden border" title="点击查看大图">
                          <img src={p} alt={`photo-${i}`} className="w-24 h-16 object-cover rounded-md cursor-pointer" />
                        </button>
                      ))}
                    </div>
                  )}
                  {typeof msg.lat === 'number' && typeof msg.lng === 'number' && (
                    <div className="text-xs text-slate-400 mt-2">位置: {Number(msg.lat).toFixed(6)}, {Number(msg.lng).toFixed(6)}</div>
                  )}
                </div>
                <div className="flex flex-col gap-2 items-end">
                  <div className="text-xs text-slate-400">道路: {msg.road_name ? `${msg.road_name} (${msg.road_id || '-'})` : (msg.road_id || '-')}
                    {msg.road_id && (
                      <>
                        <button
                          className="ml-2 text-indigo-600 hover:underline text-xs"
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent('open-lane', { detail: { roadId: msg.road_id } }));
                            onClose();
                          }}
                        >查看</button>
                        <button
                          className="ml-2 text-amber-600 hover:underline text-xs font-medium"
                          onClick={() => {
                            // 跳转到道路详情并自动打开编辑路况，传递上报人信息
                            window.dispatchEvent(new CustomEvent('open-lane-edit', { 
                              detail: { 
                                roadId: msg.road_id,
                                reporterInfo: {
                                  reporter_id: msg.contact || msg.name || '',
                                  reporter_name: msg.name || msg.contact || '',
                                  damage_type: '',
                                  description: msg.text || '',
                                  lat: msg.lat,
                                  lng: msg.lng,
                                  photo_urls: msg.photo_urls || []
                                }
                              } 
                            }));
                            markRead(msg.id);
                            onClose();
                          }}
                        >处理</button>
                      </>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <button className="px-3 py-1 bg-indigo-500 text-white rounded-md text-sm" onClick={() => markRead(msg.id)}>标为已读</button>
                      <button className="px-2 py-1 bg-white border rounded-md text-slate-600 hover:bg-red-50" onClick={() => deleteMessage(msg.id)} title="删除">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (read.length === 0) return <div className="text-center py-10">暂无已读消息</div>;
    return (
      <div className="space-y-3">
        {read.map(msg => (
          <div key={msg.id} className={`p-4 rounded-xl border bg-white`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm text-slate-500 mb-1">{msg.created_at} · {msg.type === 'maintainer' ? '维修方' : '用户'}</div>
                <div className="font-bold text-slate-900">{msg.name || (msg.contact || '匿名')}</div>
                <div className="text-sm text-slate-700 mt-2 whitespace-pre-line">{msg.text}</div>
                {msg.photo_urls && msg.photo_urls.length > 0 && (
                  <div className="flex gap-2 mt-3">
                    {msg.photo_urls.map((p, i) => (
                      <button key={i} type="button" onClick={() => setSelectedImage(p)} className="rounded-md overflow-hidden border" title="点击查看大图">
                        <img src={p} alt={`photo-${i}`} className="w-24 h-16 object-cover rounded-md cursor-pointer" />
                      </button>
                    ))}
                  </div>
                )}
                {typeof msg.lat === 'number' && typeof msg.lng === 'number' && (
                  <div className="text-xs text-slate-400 mt-2">位置: {Number(msg.lat).toFixed(6)}, {Number(msg.lng).toFixed(6)}</div>
                )}
              </div>
              <div className="flex flex-col gap-2 items-end">
                <div className="text-xs text-slate-400">道路ID: {msg.road_id || '-'}</div>
                <button className="mt-2 px-2 py-1 bg-white border rounded-md text-slate-600 hover:bg-red-50" onClick={() => deleteMessage(msg.id)} title="删除">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  })();

  if (!visible) return null;

  return ReactDOM.createPortal(
    <div className="fixed inset-0 bg-black/30 z-[4000] flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-[720px] max-w-[96vw] max-h-[86vh] shadow-2xl relative flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold">消息盒子</h3>
            {filter && (filter.reporter_id || filter.name) && (
              <div className="text-xs text-slate-400">筛选: {filter.reporter_id ? `ID=${filter.reporter_id}` : ''}{filter.name ? `${filter.reporter_id ? ' · ' : ''}姓名=${filter.name}` : ''}</div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-1">
              <button className={`px-3 py-1 rounded-md text-sm ${tab === 'unread' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setTab('unread')}>未读 ({unread.length})</button>
              <button className={`px-3 py-1 rounded-md text-sm ${tab === 'read' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => setTab('read')}>已读 ({read.length})</button>
            </div>            {tab === 'read' && read.length > 0 && (
              <button
                className="px-3 py-1 rounded-md text-sm text-red-600 hover:bg-red-50"
                onClick={async () => {
                  if (!confirm('确认删除所有已读消息？此操作不可恢复。')) return;
                  try {
                    const res = await axios.delete('/api/messages?read=1');
                    alert(`已删除 ${res.data?.affected || 0} 条已读消息`);
                    window.dispatchEvent(new CustomEvent('messages-updated'));
                    await fetchMessages();
                  } catch (err) {
                    console.error('delete read messages error', err);
                    alert('删除失败，请重试');
                  }
                }}
              >清空已读</button>
            )}            <button className="flex items-center gap-2 px-3 py-1 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100" onClick={onClose}><X className="w-5 h-5" />关闭</button>
          </div>
        </div>
        <div className="overflow-auto flex-1">
          {content}
        </div>

        {selectedImage && ReactDOM.createPortal(
          <div className="fixed inset-0 z-[4200] bg-black/70 flex items-center justify-center" onClick={() => setSelectedImage(null)}>
            <div className="max-w-[92vw] max-h-[92vh] p-2" onClick={e => e.stopPropagation()}>
              <button className="absolute top-4 right-4 z-[4300] bg-white rounded-full p-2 shadow" onClick={() => setSelectedImage(null)}><X className="w-4 h-4" /></button>
              <img src={selectedImage as string} alt="preview" className="max-w-[92vw] max-h-[92vh] rounded-md" />
              <div className="text-center mt-3"><a className="text-sm text-indigo-400 hover:underline" href={selectedImage as string} target="_blank" rel="noreferrer">在新标签页打开</a></div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>,
    document.body
  );
};

export default MessageBox;
