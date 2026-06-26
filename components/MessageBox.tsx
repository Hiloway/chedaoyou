import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { X, Trash2 } from 'lucide-react';
import { messageApi, roadApi, repairApi } from '../services/api';

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
  const [approvalConditionMap, setApprovalConditionMap] = useState<Record<number, 'Excellent' | 'Good' | 'Fair' | 'Poor'>>({});

  const fetchMessages = async (flt?: { reporter_id?: string; name?: string } | null) => {
    setLoading(true);
    try {
      const params: any = { limit: 1000 };
      if (flt && flt.reporter_id) params.reporter_id = flt.reporter_id;
      if (flt && flt.name) params.name = flt.name;
      const raw = await messageApi.list(params);
      // 规范化 photo_urls 字段：后端可能以 JSON 字符串保存，前端需要数组
      const normalized = (raw || []).map((r: any) => {
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
      await messageApi.markRead(id);
      setMessages(prev => prev.map(m => m.id === id ? { ...m, is_read: 1 } : m));
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
      // 维修方优先看指派给自己的任务，同时保留与自己相关的普通消息
      if (m.type === 'task') return m.assigned_to === user.username;
      return m.assigned_to === user.username || m.name === user.username || m.contact === user.username;
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
      await messageApi.remove(id);
      window.dispatchEvent(new CustomEvent('messages-updated'));
      await fetchMessages();
    } catch (err) {
      console.error('delete message error', err);
      alert('删除失败');
    }
  };

  const parseSystemMeta = (msg: MessageRecord): any | null => {
    if (!msg.text) return null;
    const raw = String(msg.text).trim();
    if (!(raw.startsWith('{') && raw.endsWith('}'))) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  };

  const conditionLabelMap: Record<string, string> = {
    Excellent: '优良',
    Good: '良好',
    Fair: '一般',
    Poor: '较差',
    InRepair: '维修中',
  };

  const getApprovalCondition = (messageId: number): 'Excellent' | 'Good' | 'Fair' | 'Poor' => {
    return approvalConditionMap[messageId] || 'Good';
  };

  const openLaneByRoadId = (roadId?: string) => {
    if (!roadId) return;
    window.dispatchEvent(new CustomEvent('open-lane', { detail: { roadId } }));
    setTimeout(() => onClose(), 0);
  };

  const handleProcess = (msg: MessageRecord) => {
    if (!msg.road_id) return;
    const isMaintainerTask = user.role === 'maintainer' && msg.type === 'task' && (!msg.assigned_to || msg.assigned_to === user.username);
    if (isMaintainerTask) {
      window.dispatchEvent(new CustomEvent('open-lane-repair', {
        detail: {
          roadId: msg.road_id,
          roadName: msg.road_name || '',
        }
      }));
    } else {
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
    }
    markRead(msg.id);
    onClose();
  };

  const openReportReview = (msg: MessageRecord) => {
    const meta = parseSystemMeta(msg);
    const roadId = msg.road_id || meta?.road_id;
    if (!roadId) {
      alert('未找到对应道路信息');
      return;
    }
    window.dispatchEvent(new CustomEvent('open-lane-report-review', {
      detail: {
        roadId,
        reportId: meta?.report_id || meta?.latest_report_id || null,
      }
    }));
    onClose();
  };

  const confirmInRepair = async (msg: MessageRecord) => {
    const meta = parseSystemMeta(msg);
    const roadId = msg.road_id || meta?.road_id;
    if (!roadId) { alert('未找到道路 ID'); return; }
    const ok = window.confirm('确认将该道路状态更新为“维修中”？');
    if (!ok) return;

    try {
      const payload = {
        road_id: roadId,
        road_name: msg.road_name || meta?.road_name || roadId,
        condition: 'InRepair',
        workflow_action: 'confirm_in_repair',
        actor_role: 'admin',
        actor_name: user.username,
        description: `管理员确认维修中（来源消息#${msg.id}）`,
      };
      const resp = await roadApi.upsert(payload);
      window.dispatchEvent(new CustomEvent('road-condition-updated', {
        detail: {
          roadId,
          roadName: payload.road_name,
          condition: 'InRepair',
          record: resp?.record || null,
        }
      }));
      await markRead(msg.id);
      await fetchMessages(filter);
      alert('已确认，状态已更新为维修中');
    } catch (err) {
      console.error('confirm in-repair error', err);
      alert('确认失败，请稍后重试');
    }
  };

  const approveCompleted = async (msg: MessageRecord, nextCondition: 'Excellent' | 'Good' | 'Fair' | 'Poor') => {
    const meta = parseSystemMeta(msg);
    const roadId = msg.road_id || meta?.road_id;
    if (!roadId) { alert('未找到道路 ID'); return; }
    const nextConditionLabel = conditionLabelMap[nextCondition] || nextCondition;
    const ok = window.confirm(`审核通过后将道路状态更新为“${nextConditionLabel}”，并新增一条维修记录，是否继续？`);
    if (!ok) return;

    try {
      const roadName = msg.road_name || meta?.road_name || roadId;
      const maintainerName = meta?.maintainer || '维修方';

      const condResp = await roadApi.upsert({
        road_id: roadId,
        road_name: roadName,
        condition: nextCondition,
        workflow_action: 'approve_completion',
        actor_role: 'admin',
        actor_name: user.username,
        workflow_note: `管理员审核通过维修完成（来源消息#${msg.id}）`,
        description: `管理员审核通过，维修完成（状态更新为${nextConditionLabel}，来源消息#${msg.id}）`,
      });

      await repairApi.create({
        road_id: roadId,
        title: '维修完成审核记录',
        background: `维修方 ${maintainerName} 提交维修完成申请。`,
        detection: '管理员已完成审核，现场信息符合要求。',
        core_plan: `状态调整为${nextConditionLabel}，纳入常规巡检。`,
        conclusion: '审核通过。',
        organization: '道路管理平台',
        date: new Date().toISOString().slice(0, 10),
        contact: user.username,
        attachment_urls: [],
      });

      if (meta?.maintainer) {
        try {
          await messageApi.create({
            road_id: roadId,
            type: 'repair_complete_approved',
            name: '系统通知',
            assigned_to: meta.maintainer,
            text: JSON.stringify({
              event: 'repair_complete_approved',
              road_id: roadId,
              road_name: roadName,
              summary: `管理员已审核通过：${roadName} 维修完成。`,
              approved_by: user.username,
              approved_at: new Date().toISOString(),
            }),
          });
        } catch (notifyErr) {
          console.warn('notify maintainer after approval failed', notifyErr);
        }
      }

      window.dispatchEvent(new CustomEvent('road-condition-updated', {
        detail: {
          roadId,
          roadName,
          condition: nextCondition,
          record: condResp?.record || null,
        }
      }));
      await markRead(msg.id);
      await fetchMessages(filter);
      alert(`审核通过，状态已更新为${nextConditionLabel}，并新增维修记录`);
    } catch (err) {
      console.error('approve completion error', err);
      alert('审核失败，请稍后重试');
    }
  };

  const getDisplayText = (msg: MessageRecord) => {
    const meta = parseSystemMeta(msg);
    if (msg.type === 'repair_report_submitted') {
      return meta?.summary || `维修方 ${meta?.maintainer || '-'} 已提交维修报告，请查看并确认。`;
    }
    if (msg.type === 'repair_complete_requested') {
      return meta?.summary || `维修方 ${meta?.maintainer || '-'} 已提交维修完成申请，请审核。`;
    }
    if (msg.type === 'repair_complete_approved') {
      return meta?.summary || '维修完成申请已审核通过。';
    }
    return msg.text || '';
  };

  const renderMessageCard = (msg: MessageRecord, isReadCard: boolean) => {
    const isAdminReportNotice = user.role === 'admin' && msg.type === 'repair_report_submitted';
    const isAdminCompleteNotice = user.role === 'admin' && msg.type === 'repair_complete_requested';
    const canConfirm = !msg.is_read;

    return (
      <div key={msg.id} className={`p-4 rounded-xl border ${isReadCard ? 'bg-white border-slate-200' : 'bg-yellow-50 border-yellow-200'}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-slate-500 mb-1">{msg.created_at} · {msg.type === 'maintainer' ? '维修方' : '用户'} · {msg.road_name || msg.road_id || '-'}</div>
            <div className="font-bold text-slate-900">{msg.name || (msg.contact || '匿名')}</div>
            <div className="text-sm text-slate-700 mt-2 whitespace-pre-line">{getDisplayText(msg)}</div>
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
            <div className="text-xs text-slate-400">道路: {msg.road_name ? `${msg.road_name} (${msg.road_id || '-'})` : (msg.road_id || '-')}</div>
            <div className="flex flex-wrap justify-end gap-2 max-w-[280px]">
              {msg.road_id && (
                <button
                  className="text-indigo-600 hover:underline text-xs"
                  onClick={() => openLaneByRoadId(msg.road_id)}
                >查看</button>
              )}

              {msg.road_id && !isAdminReportNotice && !isAdminCompleteNotice && (
                <button
                  className="text-amber-600 hover:underline text-xs font-medium"
                  onClick={() => handleProcess(msg)}
                >处理</button>
              )}

              {isAdminReportNotice && (
                <>
                  <button
                    className="text-indigo-600 hover:underline text-xs"
                    onClick={() => openReportReview(msg)}
                  >查看维修报告</button>
                  <button
                    className={`text-xs font-medium ${canConfirm ? 'text-emerald-600 hover:underline' : 'text-slate-400 cursor-not-allowed'}`}
                    disabled={!canConfirm}
                    onClick={() => canConfirm && confirmInRepair(msg)}
                  >{canConfirm ? '确认' : '已确认'}</button>
                </>
              )}

              {isAdminCompleteNotice && (
                <>
                  <button
                    className="text-indigo-600 hover:underline text-xs"
                    onClick={() => openReportReview(msg)}
                  >查看维修报告</button>
                  <select
                    className="text-xs border rounded px-2 py-0.5 bg-white text-slate-700"
                    value={getApprovalCondition(msg.id)}
                    disabled={!canConfirm}
                    onChange={(e) => {
                      const value = e.target.value as 'Excellent' | 'Good' | 'Fair' | 'Poor';
                      setApprovalConditionMap(prev => ({ ...prev, [msg.id]: value }));
                    }}
                  >
                    <option value="Excellent">优良</option>
                    <option value="Good">良好</option>
                    <option value="Fair">一般</option>
                    <option value="Poor">较差</option>
                  </select>
                  <button
                    className={`text-xs font-medium ${canConfirm ? 'text-emerald-600 hover:underline' : 'text-slate-400 cursor-not-allowed'}`}
                    disabled={!canConfirm}
                    onClick={() => canConfirm && approveCompleted(msg, getApprovalCondition(msg.id))}
                  >{canConfirm ? '审核通过' : '已审核'}</button>
                </>
              )}
            </div>

            <div className="mt-1 flex items-center gap-2">
              {!msg.is_read && (
                <button className="px-3 py-1 bg-indigo-500 text-white rounded-md text-sm" onClick={() => markRead(msg.id)}>标为已读</button>
              )}
              <button className="px-2 py-1 bg-white border rounded-md text-slate-600 hover:bg-red-50" onClick={() => deleteMessage(msg.id)} title="删除">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const content = (() => {
    if (loading) return <div className="text-center py-10">加载中...</div>;
    const list = tab === 'unread' ? unread : read;
    if (list.length === 0) return <div className="text-center py-10">{tab === 'unread' ? '暂无未读消息' : '暂无已读消息'}</div>;
    return <div className="space-y-3">{list.map(msg => renderMessageCard(msg, tab === 'read'))}</div>;
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
                    const res = await messageApi.removeRead();
                    alert(`已删除 ${res?.affected || 0} 条已读消息`);
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
