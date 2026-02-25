
import React, { useState, useRef, useEffect } from 'react';
import Login from './Login';
import MessageBox from './MessageBox';
import ProfileModal from './ProfileModal';
import { LaneInfo } from '../types';
import { chatWithAssistant } from '../services/deepseekService';
import { 
  Map as MapIcon, 
  Search, 
  Activity, 
  ChevronRight,
  Loader2,
  Send,
  Database,
  ShieldCheck,
  User,
  Bot,
  MessageSquare
} from 'lucide-react';

interface SidebarProps {
  lanes: LaneInfo[];
  onSelectLane: (lane: LaneInfo) => void;
  selectedLaneId: string | null;
  user: { role: string, username: string };
  setUser: (u: { role: string, username: string }) => void;
  permissions: { canEdit: boolean; canAI: boolean; canChat: boolean };
}

const Sidebar: React.FC<SidebarProps> = ({ lanes, onSelectLane, selectedLaneId, user, setUser, permissions }) => {
  // 登录相关状态
  const [showLogin, setShowLogin] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showMessages, setShowMessages] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  // 当通过事件打开消息盒时，可传入过滤条件（如 reporter_id 或 name）
  const [messageFilter, setMessageFilter] = useState<{ reporter_id?: string; name?: string } | null>(null);

  const handleLogin = (role: string, username: string) => {
    const u = { role, username: username || (role === 'guest' ? '游客' : '') };
    setUser(u);
    try { localStorage.setItem('lane_user', JSON.stringify(u)); } catch (e) { /* ignore */ }
    setShowLogin(false);
  };
  const handleLogout = () => {
    setUser({ role: 'guest', username: '游客' });
    try { localStorage.removeItem('lane_user'); localStorage.removeItem('lane_token'); } catch (e) { /* ignore */ }
  };
  const [activeTab, setActiveTab] = useState<'lanes' | 'chat'>('lanes');
  const [searchTerm, setSearchTerm] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'model', content: string}[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory, isChatLoading]);

  // 管理端定期拉取未读消息数量
  useEffect(() => {
    let timer: any;
    const fetchUnread = async () => {
      if (!user || user.role !== 'admin') { setUnreadCount(0); return; }
      try {
        // 使用 count 接口避免拉取大量数据并减少后端排序开销
        const resp = await fetch('/api/messages?unread=1&count=1');
        const data = await resp.json();
        setUnreadCount((data && typeof data.count === 'number') ? data.count : 0);
      } catch (err) {
        console.error('fetch unread messages failed', err);
      }
    };
    fetchUnread();
    timer = setInterval(fetchUnread, 10000);

    // listen to global updates (e.g., when MessageBox marks-read)
    const onUpdate = () => fetchUnread();
    window.addEventListener('messages-updated', onUpdate as EventListener);

    return () => { clearInterval(timer); window.removeEventListener('messages-updated', onUpdate as EventListener); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // 监听外部请求打开消息盒（可携带过滤条件，如 { reporter_id, name }）
  React.useEffect(() => {
    const handler = (e: any) => {
      const detail = e?.detail || {};
      setMessageFilter(detail || null);
      setShowMessages(true);
    };
    window.addEventListener('open-messages', handler as EventListener);
    return () => window.removeEventListener('open-messages', handler as EventListener);
  }, []);

  const getStatusColor = (condition: string) => {
    switch (condition) {
      case 'Excellent':
      case 'Good': return 'bg-emerald-500';
      case 'Fair': return 'bg-amber-500';
      case 'Poor': return 'bg-rose-500';
      default: return 'bg-slate-400';
    }
  };

  const filteredLanes = lanes.filter(lane => 
    lane.roadName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSendChat = async () => {
    if (!chatInput.trim() || isChatLoading) return;
    const userMsg = chatInput;
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsChatLoading(true);
    try {
      const response = await chatWithAssistant(chatHistory, userMsg);
      setChatHistory(prev => [...prev, { role: 'model', content: response || '无法理解该请求。' }]);
    } catch (err) {
      setChatHistory(prev => [...prev, { role: 'model', content: '服务暂时无法响应。' }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <div className="w-[400px] bg-white border-r border-slate-200 h-screen flex flex-col shadow-2xl z-20 overflow-hidden font-sans">
      {/* App Header 整体左右分区 */}
      <div className="p-8 pb-7 bg-slate-900 text-white relative overflow-hidden shrink-0">
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-600/20 rounded-full blur-3xl -mr-16 -mt-16 animate-pulse"></div>
        <div className="flex flex-row items-center justify-between w-full gap-8">
          {/* 左侧Logo与标题 */}
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-indigo-600 rounded-[20px] shadow-2xl shadow-indigo-600/50">
              <Database className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-black tracking-tight leading-none mb-1.5 whitespace-nowrap">LaneVision</h1>
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_8px_#10b981]"></span>
                <span className="text-[10px] text-slate-400 font-black uppercase tracking-[0.15em] truncate">实时交通数据中心</span>
              </div>
            </div>
          </div>
          {/* 右侧登录信息区域 */}
          <div className="flex flex-col items-end justify-center min-h-[40px] flex-shrink-0 max-w-[160px] overflow-x-auto">
            {user && user.role !== 'guest' ? (
              <div className="flex flex-col items-end gap-1 bg-slate-800/60 px-3 py-2 rounded-xl min-w-0">
                <div className="flex flex-row items-center gap-2 min-w-0 max-w-[140px]">
                  <User className="w-6 h-6 text-white/80 flex-shrink-0" />
                  <div className="flex flex-col items-end min-w-0 w-[5ch] max-w-[5ch]">
                    <span className="font-bold text-base text-white truncate w-[5ch] max-w-[5ch]">{user.username}</span>
                    <span className="text-xs text-slate-300 mt-0.5 truncate w-[5ch] max-w-[5ch]">{user.role === 'admin' ? '数据管理员' : user.role === 'maintainer' ? '维修方' : '用户'}</span>
                  </div>
                </div>
                <div className="flex gap-2 mt-2 w-full">
                  <button className="flex items-center gap-2 px-3 py-1 rounded-md text-white bg-indigo-500 hover:bg-indigo-700 text-xs font-bold" onClick={handleLogout}>退出</button>
                  <button className="flex items-center gap-2 px-3 py-1 rounded-md text-slate-700 bg-white border hover:bg-gray-50 text-xs" onClick={() => setShowProfile(true)}>资料</button>
                  {/* 消息入口 - 管理员看全部消息，维修方看分配任务，用户看自己的上报反馈 */}
                  {(user.role === 'admin' || user.role === 'maintainer' || user.role === 'user') && (
                    <button 
                      id="open-message-box" 
                      className={`relative flex items-center gap-2 px-3 py-1 rounded-md text-xs font-bold ${
                        user.role === 'admin' ? 'bg-yellow-400 hover:bg-yellow-300 text-slate-900' :
                        user.role === 'maintainer' ? 'bg-amber-500 hover:bg-amber-400 text-white' :
                        'bg-blue-500 hover:bg-blue-400 text-white'
                      }`} 
                      onClick={() => setShowMessages(true)}
                      title={user.role === 'admin' ? '查看所有上报消息' : user.role === 'maintainer' ? '查看分配的维修任务' : '查看我的上报反馈'}
                    >
                      {user.role === 'admin' ? '消息' : user.role === 'maintainer' ? '任务' : '反馈'}
                      {unreadCount > 0 && (
                        <span className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-[11px] flex items-center justify-center">{unreadCount}</span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <button
                className="px-5 py-2 bg-indigo-500 hover:bg-indigo-700 text-white rounded-xl text-base font-bold transition-all"
                onClick={() => setShowLogin(true)}
              >登录</button>
            )}
          </div>
        </div>
        {showLogin && (
          <div className="fixed inset-0 z-[4000] flex items-center justify-center bg-black/30" onClick={() => setShowLogin(false)}>
            <div onClick={e => e.stopPropagation()}><Login onLogin={handleLogin} /></div>
          </div>
        )}
        {showProfile && (
          <ProfileModal open={showProfile} onClose={() => setShowProfile(false)} onSaved={(acc) => {
            if (acc && acc.username) {
              handleLogin(acc.role || user.role, acc.username);
            }
            setShowProfile(false);
          }} />
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100 bg-white sticky top-0 z-10 shrink-0">
        <button 
          onClick={() => setActiveTab('lanes')} 
          className={`flex-1 py-5 text-[10px] font-black uppercase tracking-[0.2em] transition-all relative ${activeTab === 'lanes' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          数据图表
          {activeTab === 'lanes' && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-10 h-1 bg-indigo-600 rounded-t-full"></div>}
        </button>
        <button 
          onClick={() => permissions.canChat ? setActiveTab('chat') : undefined} 
          className={`flex-1 py-5 text-[10px] font-black uppercase tracking-[0.2em] transition-all relative ${activeTab === 'chat' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'} ${!permissions.canChat ? 'opacity-50 cursor-not-allowed' : ''}`}
          disabled={!permissions.canChat}
        >
          智能问询
          {activeTab === 'chat' && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-10 h-1 bg-indigo-600 rounded-t-full"></div>}
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden bg-slate-50/50">
        {activeTab === 'lanes' ? (
          <div className="h-full flex flex-col p-6 space-y-6 overflow-y-auto custom-scrollbar">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 group-focus-within:text-indigo-600 transition-colors" />
              <input 
                type="text"
                placeholder="搜索道路名称..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-11 pr-5 py-4 bg-white border border-slate-200 rounded-2xl text-sm outline-none focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500 shadow-sm transition-all placeholder:text-slate-300"
              />
            </div>

            <div className="space-y-4">
              {filteredLanes.length === 0 ? (
                <div className="text-center py-20">
                  <div className="w-24 h-24 bg-white rounded-[32px] flex items-center justify-center mx-auto mb-6 shadow-xl shadow-slate-200/50">
                    <MapIcon className="w-10 h-10 text-slate-100" />
                  </div>
                  <h3 className="text-slate-900 font-black text-lg mb-2">未发现主干道</h3>
                  <p className="text-sm text-slate-400 px-10">当前区域未检测到符合筛选条件的干道数据。</p>
                </div>
              ) : (
                filteredLanes.map(lane => (
                  <button
                    key={lane.id}
                    onClick={() => onSelectLane(lane)}
                    className={`w-full text-left p-6 rounded-[28px] border transition-all flex items-center justify-between group relative overflow-hidden ${
                      selectedLaneId === lane.id 
                      ? 'border-indigo-500 bg-white shadow-2xl shadow-indigo-500/10' 
                      : 'border-slate-200 bg-white hover:border-indigo-300 hover:shadow-xl'
                    }`}
                  >
                    <div className="flex gap-4 overflow-hidden relative z-10">
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${getStatusColor(lane.condition)} shadow-lg shadow-current/50`}></div>
                      <div className="overflow-hidden">
                        <h3 className="font-black text-slate-900 truncate leading-none mb-2">{lane.roadName}</h3>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{lane.laneCount} 车道</span>
                          <span className="w-1 h-1 bg-slate-200 rounded-full"></span>
                          <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${getStatusColor(lane.condition).replace('bg-', 'text-')}`}>
                            {lane.condition}
                          </span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className={`w-5 h-5 shrink-0 transition-transform ${selectedLaneId === lane.id ? 'translate-x-1 text-indigo-500' : 'text-slate-200 group-hover:text-indigo-400'}`} />
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8 scroll-smooth bg-slate-50/50 custom-scrollbar">
              {chatHistory.length === 0 && (
                <div className="text-center py-16">
                  <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-[32px] flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-indigo-200">
                    <MessageSquare className="w-10 h-10" />
                  </div>
                  <h3 className="text-slate-900 font-black text-lg mb-2">有什么可以帮你？</h3>
                  <p className="text-xs text-slate-400 px-12 leading-relaxed font-medium uppercase tracking-widest">专业交通咨询助手 · 实时分析</p>
                </div>
              )}
              {chatHistory.map((msg, i) => (
                <div key={i} className={`flex items-start gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`shrink-0 w-10 h-10 rounded-[14px] flex items-center justify-center ${msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-white border-2 border-slate-100 text-indigo-600 shadow-sm'}`}>
                    {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                  </div>
                  <div className={`max-w-[85%] rounded-[24px] px-6 py-4 shadow-sm text-sm leading-relaxed ${
                    msg.role === 'user' 
                    ? 'bg-indigo-600 text-white rounded-tr-none font-medium' 
                    : 'bg-white text-slate-700 border border-slate-100 rounded-tl-none font-normal'
                  }`}>
                    <div className="whitespace-pre-line">
                      {msg.content}
                    </div>
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex items-start gap-4">
                  <div className="shrink-0 w-10 h-10 rounded-[14px] bg-white border-2 border-slate-100 text-indigo-600 flex items-center justify-center">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div className="bg-white border border-slate-100 rounded-[24px] rounded-tl-none px-6 py-5 shadow-sm">
                    <div className="flex gap-1.5">
                      <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                      <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-8 bg-white border-t border-slate-100 shrink-0">
              <div className="relative flex items-center gap-4">
                <input 
                  type="text"
                  placeholder="询问当前道路瓶颈分析..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-[24px] py-4.5 px-6 text-sm focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-400"
                />
                <button 
                  onClick={handleSendChat}
                  disabled={!chatInput.trim() || isChatLoading}
                  className="p-4.5 bg-slate-900 text-white rounded-[24px] hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/20 disabled:opacity-30 disabled:shadow-none"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
              <p className="text-[10px] text-center text-slate-300 mt-4 font-black uppercase tracking-[0.3em]">AI Analysis Engine v2.5</p>
            </div>
          </div>
        )}
      </div>

      <div className="p-5 bg-white border-t border-slate-100 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
          <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Secure Link Active</span>
        </div>
        <div className="flex gap-4">
           <ShieldCheck className="w-4 h-4 text-slate-200" />
        </div>
      </div>

      {/* 消息弹窗 - 根据角色过滤 */}
      {showMessages && <MessageBox visible={showMessages} onClose={() => { setShowMessages(false); setMessageFilter(null); }} filter={messageFilter} user={user} /> }
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 0px;
        }
      `}</style>
    </div>
  );
};

export default Sidebar;
