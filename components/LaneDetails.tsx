
import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import ReactDOM from 'react-dom';
import { LaneInfo } from '../types';
import { analyzeLaneData } from '../services/deepseekService';
import { computeGetisOrdGi, computeKernelDensity, DamagePoint, analyzeLaneSummary } from '../services/spatialAnalysis';
import { 
  X, 
  ShieldCheck, 
  Activity, 
  Calendar, 
  Ruler, 
  Sparkles,
  Loader2,
  ChevronRight,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Lightbulb,
  ChevronDown,
  Lock
} from 'lucide-react';
import ReportList from './ReportList';

interface LaneDetailsProps {
  lane: LaneInfo;
  onClose: () => void;
  user: { role: string, username: string };
  permissions: { canEdit: boolean; canAI: boolean; canChat: boolean };
  onSaved?: (record?: any) => void; // 保存后回调，优先接收后端返回的记录
  pendingEditInfo?: any; // 从消息盒子跳转时自动填充的信息
  onEditInfoConsumed?: () => void; // 消费pendingEditInfo后的回调
}

const LaneDetails: React.FC<LaneDetailsProps> = ({ lane, onClose, user, permissions, onSaved, pendingEditInfo, onEditInfoConsumed }) => {

  const [analysis, setAnalysis] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  // 由原来的 aiRequested 扩展为通用的分析请求状态
  const [analysisRequested, setAnalysisRequested] = useState(false);
  // 可扩展的分析类型：'ai' | 'spatial' | future others
  const [analysisType, setAnalysisType] = useState<'ai' | 'spatial'>('spatial');
  const [showAnalysisMenu, setShowAnalysisMenu] = useState(false);
  const analysisMenuRef = useRef<HTMLDivElement | null>(null);

  // 点击菜单外部关闭菜单
  useEffect(() => {
    if (!showAnalysisMenu) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (analysisMenuRef.current && !analysisMenuRef.current.contains(target)) {
        setShowAnalysisMenu(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showAnalysisMenu]);

  // 空间分析结果
  const [spatialResult, setSpatialResult] = useState<any | null>(null);

  const handleAnalyze = async () => {
    setIsLoading(true);
    setAnalysisRequested(true);
    // 默认 AI 分析（保留原逻辑）
    const result = await analyzeLaneData(lane);
    setAnalysis(result);
    setIsLoading(false);
  };

  const handleRunAnalysis = async () => {
    setIsLoading(true);
    setAnalysisRequested(true);
    setAnalysis(null);
    setSpatialResult(null);

    if (analysisType === 'ai') {
      const result = await analyzeLaneData(lane);
      setAnalysis(result);
      setIsLoading(false);
      return;
    }

    // spatial analysis
    try {
      // 单路段：使用专门的非聚焦分析（道路摘要）而不是热点/核密度
      // 传递真实的damagePoints（如果存在）
      const laneSummary = analyzeLaneSummary({
        coordinates: lane.coordinates,
        condition: lane.condition,
        roadName: lane.roadName,
        damagePoints: (lane as any).damagePoints || []
      });

      setSpatialResult({ laneSummary });
    } catch (err) {
      setSpatialResult({ error: '单路段分析失败' });
      console.error('单路段分析错误:', err);
    } finally {
      setIsLoading(false);
    }
  };


  const getConditionStyle = (condition: string) => {
    switch(condition) {
      case 'Excellent': return { text: '优良', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' };
      case 'Good': return { text: '良好', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-100' };
      case 'Fair': return { text: '一般', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100' };
      case 'Poor': return { text: '较差', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-400', highlight: true };
      case '未知': return { text: '未知', color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-100' };
      default: return { text: condition || '未知', color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-100' };
    }
  };


  // 路况表单相关状态
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [form, setForm] = useState({
    condition: lane.condition || '',
    description: '',
    damage_type: '',
    severity: '',
    reporter_id: '',
    reporter_name: '',
    road_name: lane.roadName || '',
    notes: '',
    attachment_urls: [],
    is_verified: 0,
    verified_by: '',
    verified_at: '',
  });
  // 当前路段后端保存的记录（用于显示附件、上报人等）
  const [savedRecord, setSavedRecord] = useState<any | null>(null);
  // 点击附件后用于预览大图
  const [selectedAttachImage, setSelectedAttachImage] = useState<string | null>(null);
  const [showDamageDetail, setShowDamageDetail] = useState(false);
  // 主面板始终以已保存的 lane 为准显示健康度（保存成功后父组件会同步更新 lane）
  const effectiveCondition = (lane.condition && lane.condition !== '未知') ? lane.condition : (savedRecord?.condition || '未知');
  const status = getConditionStyle(effectiveCondition);

  // 维修报告相关
  const [showRepairForm, setShowRepairForm] = useState(false);
  const [isReportSaving, setIsReportSaving] = useState(false);
  const [showReports, setShowReports] = useState(false);

  // 用户上报弹窗与状态
  const [showUserReport, setShowUserReport] = useState(false);
  const [isUserReporting, setIsUserReporting] = useState(false);
  const [userReport, setUserReport] = useState<any>({ text: '', photos: [] as string[], contact: '', lat: null, lng: null });
  // 在地图上选择位置的待处理状态（开始选择后隐藏弹窗，选择完成后恢复弹窗）
  const [pendingPick, setPendingPick] = useState<string | null>(null);

  // 支持按 Esc 关闭维修报告弹窗，提升可发现性
  React.useEffect(() => {
    if (!showRepairForm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowRepairForm(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showRepairForm]);

  // 监听地图选择完成的事件（由 App 发出）
  useEffect(() => {
    const handler = (e: any) => {
      const d = e?.detail;
      if (!d) return;
      // 只接受针对当前路段的选择
      if (d.roadId !== lane.id) return;
      setUserReport(r => ({ ...r, lat: d.lat, lng: d.lng }));
      alert('已在地图上选定位置');
      // 如果这是我们发起的选择（pendingPick），恢复弹窗并清理 pending
      if (pendingPick === d.roadId) {
        setShowUserReport(true);
        setPendingPick(null);
      }
    };

    const onCancel = () => {
      if (pendingPick) {
        setPendingPick(null);
        alert('已取消地图选择');
        setShowUserReport(true);
      }
    };

    window.addEventListener('damage-location-selected', handler as EventListener);
    window.addEventListener('cancel-pick-damage-location', onCancel as EventListener);
    return () => {
      window.removeEventListener('damage-location-selected', handler as EventListener);
      window.removeEventListener('cancel-pick-damage-location', onCancel as EventListener);
    };
  }, [lane.id, pendingPick]);

  // 支持按 Esc 关闭用户上报弹窗
  React.useEffect(() => {
    if (!showUserReport) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowUserReport(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showUserReport]);

  // 监听从消息盒子跳转时的自动打开编辑表单
  React.useEffect(() => {
    if (pendingEditInfo && permissions.canEdit) {
      // 延迟一帧确保组件已渲染
      setTimeout(() => {
        setSaveError(null);
        setForm(prev => ({
          ...prev,
          reporter_id: pendingEditInfo.reporter_id || prev.reporter_id || '',
          reporter_name: pendingEditInfo.reporter_name || prev.reporter_name || '',
          description: pendingEditInfo.description || prev.description || '',
          damage_type: pendingEditInfo.damage_type || prev.damage_type || '',
          attachment_urls: Array.isArray(pendingEditInfo.photo_urls) && pendingEditInfo.photo_urls.length > 0 
            ? pendingEditInfo.photo_urls 
            : prev.attachment_urls || [],
        }));
        setShowEditForm(true);
        // 通知父组件已消费
        if (onEditInfoConsumed) onEditInfoConsumed();
      }, 100);
    }
  }, [pendingEditInfo, permissions.canEdit, onEditInfoConsumed]);

  const [repairReport, setRepairReport] = useState<any>({
    title: '',
    start_stake: '',
    end_stake: '',
    background: '',
    detection: '',
    core_plan: '',
    materials: '',
    budget: '',
    schedule: '',
    conclusion: '',
    organization: '',
    date: '',
    contact: '',
    attachment_urls: [],
    saveError: null,
  });

  // 指派维修相关状态
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [maintainerList, setMaintainerList] = useState<any[]>([]);
  const [selectedMaintainer, setSelectedMaintainer] = useState<string>('');
  const [assignNote, setAssignNote] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);

  // 获取维修方列表
  const fetchMaintainers = async () => {
    try {
      const res = await axios.get('/api/maintainers');
      setMaintainerList(res.data || []);
    } catch (err) {
      console.error('获取维修方列表失败:', err);
      setMaintainerList([]);
    }
  };

  // 打开指派弹窗时获取维修方列表
  useEffect(() => {
    if (showAssignModal) {
      fetchMaintainers();
    }
  }, [showAssignModal]);

  // 发送维修任务
  const handleAssignRepair = async () => {
    if (!selectedMaintainer) {
      alert('请选择维修方');
      return;
    }
    setIsAssigning(true);
    try {
      const taskText = `【维修任务指派】\n道路：${lane.roadName}\n状况：${(savedRecord?.condition || lane.condition) === 'Poor' ? '较差' : '一般'}\n破损类型：${savedRecord?.damage_type || '待检查'}\n严重程度：${savedRecord?.severity || '待评估'}\n描述：${savedRecord?.description || '无'}\n指派人：${user.username}\n指派时间：${new Date().toLocaleString()}${assignNote ? `\n备注：${assignNote}` : ''}`;
      
      await axios.post('/api/message', {
        road_id: lane.id,
        type: 'task',
        name: user.username,
        text: taskText,
        assigned_to: selectedMaintainer,
      });
      
      alert('维修任务已成功发送给 ' + selectedMaintainer);
      setShowAssignModal(false);
      setSelectedMaintainer('');
      setAssignNote('');
    } catch (err) {
      console.error('发送维修任务失败:', err);
      alert('发送失败，请重试');
    } finally {
      setIsAssigning(false);
    }
  };

  // 打开/关闭编辑弹窗，关闭时重置表单以避免未保存改动影响主面板
  const openEditForm = () => {
    setSaveError(null);
    setForm({
      condition: savedRecord?.condition || lane.condition || '',
      description: savedRecord?.description || '',
      damage_type: savedRecord?.damage_type || '',
      severity: savedRecord?.severity || '',
      reporter_id: savedRecord?.reporter_id || '',
      reporter_name: savedRecord?.reporter_name || '',
      road_name: savedRecord?.road_name || lane.roadName || '',
      notes: savedRecord?.notes || '',
      attachment_urls: Array.isArray(savedRecord?.attachment_urls) ? savedRecord.attachment_urls : (savedRecord?.attachment_urls ? JSON.parse(savedRecord.attachment_urls) : []),
      is_verified: Number(savedRecord?.is_verified) || 0,
      verified_by: savedRecord?.verified_by || '',
      verified_at: savedRecord?.verified_at || '',
    });
    setShowEditForm(true);
  };

  const closeEditForm = (updatedRecord?: any) => {
    setSaveError(null);
    // 如果保存返回了最新记录，优先使用它来同步表单与展示
    if (updatedRecord) {
      setForm({
        condition: updatedRecord.condition || updatedRecord.condition || lane.condition || '',
        description: updatedRecord.description || '',
        damage_type: updatedRecord.damage_type || '',
        severity: updatedRecord.severity || '',
        reporter_id: updatedRecord.reporter_id || '',
        reporter_name: updatedRecord.reporter_name || '',
        road_name: updatedRecord.road_name || lane.roadName || '',
        notes: updatedRecord.notes || '',
        attachment_urls: Array.isArray(updatedRecord.attachment_urls) ? updatedRecord.attachment_urls : (updatedRecord.attachment_urls ? JSON.parse(updatedRecord.attachment_urls) : []),
        is_verified: Number(updatedRecord.is_verified) || 0,
        verified_by: updatedRecord.verified_by || '',
        verified_at: updatedRecord.verified_at || '',
      });
      // 同步 savedRecord 以便主面板显示附件等
      setSavedRecord(updatedRecord);
    } else {
      setForm({
        condition: lane.condition || '',
        description: '',
        damage_type: '',
        severity: '',
        reporter_id: '',
        reporter_name: '',
        road_name: lane.roadName || '',
        notes: '',
        attachment_urls: [],
        is_verified: 0,
        verified_by: '',
        verified_at: '',
      });
    }
    setShowEditForm(false);
    setIsSaving(false);
  };

  // 打开详情时尝试加载后端保存的路况记录
  React.useEffect(() => {
    let mounted = true;
    const fetchRecord = async () => {
      try {
        const res = await fetch(`/api/road-condition/${encodeURIComponent(lane.id)}`);
        if (res.ok) {
          const data = await res.json();
          if (mounted) setSavedRecord(data || null);
        } else {
          if (mounted) setSavedRecord(null);
        }
      } catch (err) {
        if (mounted) setSavedRecord(null);
      }
    };
    if (lane && lane.id) fetchRecord();
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lane.id]);


  const formatDateShortLocal = (v?: string | Date | null) => {
    if (!v) return '';
    try {
      if (typeof v === 'string') {
        const iso = v.trim();
        if (iso.length >= 10 && iso[4] === '-') return iso.slice(0, 10);
        const d = new Date(iso);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        return iso;
      }
      if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
      return '';
    } catch (err) { return ''; }
  };

  return (
    <div className="absolute top-6 right-6 w-[440px] bg-white shadow-[0_25px_60px_rgba(0,0,0,0.18)] rounded-[32px] border border-slate-200 z-30 overflow-hidden flex flex-col max-h-[calc(100vh-5rem)] animate-in slide-in-from-right duration-500 ease-out font-sans">
      {/* Header */}
      <div className="p-8 pb-6 border-b bg-white flex items-start justify-between sticky top-0 z-10">
        <div>
          <div className="flex items-center gap-2 mb-2">
             <span className="px-2.5 py-1 bg-slate-900 text-white text-[10px] font-black rounded-lg uppercase tracking-wider">Infrastructure Segment</span>
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-none">{lane.roadName}</h2>
        </div>
        <button onClick={onClose} className="p-2.5 hover:bg-slate-100 rounded-2xl transition-all group">
          <X className="w-5 h-5 text-slate-400 group-hover:text-slate-900 transition-colors" />
        </button>
      </div>

      {savedRecord && (
        <div className="px-8 pb-4 flex items-start gap-4">
          <div className="text-sm text-slate-600">
            <div><span className="font-medium">上报人：</span>{savedRecord.reporter_name || savedRecord.reporter_id || '—'}</div>
            {savedRecord.reporter_id && <div className="text-xs text-slate-400">ID: {savedRecord.reporter_id}</div>}
          </div>
          {savedRecord.attachment_urls && Array.isArray(savedRecord.attachment_urls) && savedRecord.attachment_urls.length > 0 && (
            <div className="flex gap-2">
              {savedRecord.attachment_urls.map((p: string, i: number) => (
                <button key={i} type="button" onClick={() => setSelectedAttachImage(p)} className="rounded-md overflow-hidden border" title="点击查看大图">
                  <img src={p} alt={`attach-${i}`} className="w-20 h-14 object-cover rounded-md" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Core Stats Grid - 美化后的统计卡片 */}
        <div className="p-6 grid grid-cols-2 gap-4">
          {/* 物理健康卡片 */}
          <div className={`relative overflow-hidden p-5 rounded-2xl transition-all duration-300 hover:scale-[1.02] hover:shadow-lg ${
            status.highlight ? 'bg-gradient-to-br from-red-50 to-red-100 border-2 border-red-200 ring-2 ring-red-200' : 
            `bg-gradient-to-br ${status.bg === 'bg-emerald-50' ? 'from-emerald-50 to-emerald-100' : 
              status.bg === 'bg-green-50' ? 'from-green-50 to-green-100' : 
              status.bg === 'bg-amber-50' ? 'from-amber-50 to-amber-100' : 
              status.bg === 'bg-red-50' ? 'from-red-50 to-red-100' : 'from-slate-50 to-slate-100'} border-2 ${status.border}`
          }`}> 
            <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/30 rounded-full blur-xl"></div>
            <div className={`flex items-center gap-2 ${status.color} text-[10px] font-black uppercase tracking-widest mb-3`}>
              <div className={`p-1.5 rounded-lg ${status.bg === 'bg-emerald-50' ? 'bg-emerald-500' : 
                status.bg === 'bg-green-50' ? 'bg-green-500' : 
                status.bg === 'bg-amber-50' ? 'bg-amber-500' : 
                status.bg === 'bg-red-50' ? 'bg-red-500' : 'bg-slate-400'}`}>
                <Activity className="w-3.5 h-3.5 text-white" />
              </div>
              <span>物理健康</span>
            </div>
            <div className={`text-2xl font-black ${status.color} flex items-center gap-2`}>{status.text}
              {status.highlight && <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full font-bold animate-pulse shadow-md">需维修</span>}
            </div>
          </div>
          {/* 破损情况卡片 */}
          <div className="relative overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 border-2 border-slate-200 p-5 rounded-2xl transition-all duration-300 hover:scale-[1.02] hover:shadow-lg">
            <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/40 rounded-full blur-xl"></div>
            <div className="flex items-center gap-2 text-slate-500 text-[10px] font-black uppercase tracking-widest mb-3">
              <div className="p-1.5 rounded-lg bg-orange-500">
                <AlertCircle className="w-3.5 h-3.5 text-white" />
              </div>
              <span>破损情况</span>
              <button
                className="ml-auto px-2 py-0.5 text-[10px] bg-gradient-to-r from-amber-400 to-orange-400 text-white rounded-full hover:from-amber-500 hover:to-orange-500 shadow-sm transition-all"
                onClick={() => setShowDamageDetail(true)}
              >详情</button>
            </div>
            <div className="text-xl font-black text-slate-800">{savedRecord?.damage_type || '无记录'}</div>
          </div>
          {/* 通行等级卡片 */}
          <div className="relative overflow-hidden bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-indigo-100 p-5 rounded-2xl transition-all duration-300 hover:scale-[1.02] hover:shadow-lg">
            <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/40 rounded-full blur-xl"></div>
            <div className="flex items-center gap-2 text-indigo-500 text-[10px] font-black uppercase tracking-widest mb-3">
              <div className="p-1.5 rounded-lg bg-indigo-500">
                <TrendingUp className="w-3.5 h-3.5 text-white" />
              </div>
              <span>车道数量</span>
            </div>
            <div className="text-2xl font-black text-indigo-700">{lane.laneCount} <span className="text-sm font-bold text-indigo-400">车道</span></div>
          </div>
          {/* 更新日期卡片 */}
          <div className="relative overflow-hidden bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-purple-100 p-5 rounded-2xl transition-all duration-300 hover:scale-[1.02] hover:shadow-lg">
            <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/40 rounded-full blur-xl"></div>
            <div className="flex items-center gap-2 text-purple-500 text-[10px] font-black uppercase tracking-widest mb-3">
              <div className="p-1.5 rounded-lg bg-purple-500">
                <Calendar className="w-3.5 h-3.5 text-white" />
              </div>
              <span>更新日期</span>
            </div>
            <div className="text-lg font-black text-purple-700">{formatDateShortLocal(lane.lastUpdated) || '—'}</div>
          </div>
        </div>
        {/* 操作按钮区 - 美化后 */}
        <div className="px-6 pb-4">
          <div className="flex flex-wrap justify-end gap-2">
            {permissions.canEdit && (
              <button
                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl font-bold text-sm hover:from-indigo-600 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg"
                onClick={() => openEditForm()}
              >
                <ShieldCheck className="w-4 h-4" />
                {(savedRecord?.condition || lane.condition) ? '编辑路况' : '添加路况'}
              </button>
            )}
            {/* 管理员可以指派维修任务 */}
            {user.role === 'admin' && (savedRecord?.condition === 'Poor' || savedRecord?.condition === 'Fair' || lane.condition === 'Poor' || lane.condition === 'Fair') && (
              <button
                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-500 to-indigo-500 text-white rounded-xl font-bold text-sm hover:from-purple-600 hover:to-indigo-600 transition-all shadow-md hover:shadow-lg"
                onClick={() => setShowAssignModal(true)}
              >
                <Activity className="w-4 h-4" />
                指派维修
              </button>
            )}
            {/* 维修方专属：维修报告按钮 */}
            {user.role === 'maintainer' && (
              <button
                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-bold text-sm hover:from-amber-600 hover:to-orange-600 transition-all shadow-md hover:shadow-lg"
                onClick={() => setShowRepairForm(true)}
              >
                <Sparkles className="w-4 h-4" />
                填写维修报告
              </button>
            )}
            {/* 所有角色均可查看该路段历史维修报告 */}
            <button
              className="flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-slate-200 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-50 hover:border-slate-300 transition-all"
              onClick={() => setShowReports(true)}
            >
              <Calendar className="w-4 h-4" />
              维修记录
            </button>
          </div>
        </div>
                {/* 维修报告弹窗，仅维修方可见 - 优化UI */}
                {showRepairForm && ReactDOM.createPortal(
                  <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[3000] flex items-center justify-center" onClick={() => setShowRepairForm(false)}>
                    <div className="bg-gradient-to-br from-white to-slate-50 rounded-3xl p-0 w-[800px] max-w-[94vw] shadow-2xl relative max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                      {/* 顶部装饰条 */}
                      <div className="h-2 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500"></div>
                      
                      {/* 头部 */}
                      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl flex items-center justify-center">
                            <Sparkles className="w-5 h-5 text-white" />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold text-slate-800">维修报告填写</h3>
                            <p className="text-xs text-slate-500">道路：{lane.roadName}</p>
                          </div>
                        </div>
                        <button
                          className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                          onClick={() => setShowRepairForm(false)}
                        ><X className="w-5 h-5" /></button>
                      </div>

                      {/* 表单内容 */}
                      <div className="overflow-auto px-6 py-4 flex-1">
                        <div className="space-y-5">
                          {/* 基础信息区块 */}
                          <div className="bg-slate-50 rounded-xl p-4 space-y-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                              <div className="w-1.5 h-1.5 bg-amber-500 rounded-full"></div>
                              基础信息
                            </div>
                            <div className="space-y-3">
                              <div>
                                <label className="text-sm font-medium text-slate-600 mb-1.5 block">报告标题</label>
                                <input
                                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                  value={repairReport.title}
                                  onChange={e => setRepairReport(r => ({ ...r, title: e.target.value }))}
                                  placeholder="例如：XX市XX路（XX桩号-XX桩号）路面病害维修工程实施方案报告"
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="text-sm font-medium text-slate-600 mb-1.5 block">道路桩号（起）</label>
                                  <input
                                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                    value={repairReport.start_stake}
                                    onChange={e => setRepairReport(r => ({ ...r, start_stake: e.target.value }))}
                                    placeholder="如：K12+300"
                                  />
                                </div>
                                <div>
                                  <label className="text-sm font-medium text-slate-600 mb-1.5 block">道路桩号（止）</label>
                                  <input
                                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                    value={repairReport.end_stake}
                                    onChange={e => setRepairReport(r => ({ ...r, end_stake: e.target.value }))}
                                    placeholder="如：K12+800"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* 报告内容区块 */}
                          <div className="space-y-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                              <Lightbulb className="w-4 h-4 text-amber-500" />
                              报告内容
                            </div>
                            
                            <div>
                              <label className="text-sm font-medium text-slate-600 mb-1.5 block">一、报告背景与道路概况</label>
                              <textarea
                                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 h-24 resize-none"
                                value={repairReport.background}
                                onChange={e => setRepairReport(r => ({ ...r, background: e.target.value }))}
                                placeholder="道路基础信息、维修缘由、报告目的等"
                              />
                            </div>
                            
                            <div>
                              <label className="text-sm font-medium text-slate-600 mb-1.5 block">二、道路现状与病害检测分析</label>
                              <textarea
                                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 h-24 resize-none"
                                value={repairReport.detection}
                                onChange={e => setRepairReport(r => ({ ...r, detection: e.target.value }))}
                                placeholder="检测情况、病害详情、成因分析、影响评估等"
                              />
                            </div>
                            
                            <div>
                              <label className="text-sm font-medium text-slate-600 mb-1.5 block">三、核心维修内容与技术方案</label>
                              <textarea
                                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 h-28 resize-none"
                                value={repairReport.core_plan}
                                onChange={e => setRepairReport(r => ({ ...r, core_plan: e.target.value }))}
                                placeholder="包括裂缝处理、坑槽修补、车辙整治、路基加固等施工工艺与材料要求"
                              />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-sm font-medium text-slate-600 mb-1.5 block">材料与技术要求</label>
                                <input
                                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                  value={repairReport.materials}
                                  onChange={e => setRepairReport(r => ({ ...r, materials: e.target.value }))}
                                  placeholder="如：沥青混合料型号、灌缝胶要求等"
                                />
                              </div>
                              <div>
                                <label className="text-sm font-medium text-slate-600 mb-1.5 block">预算与资金说明</label>
                                <input
                                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                  value={repairReport.budget}
                                  onChange={e => setRepairReport(r => ({ ...r, budget: e.target.value }))}
                                  placeholder="简要预算说明或金额"
                                />
                              </div>
                            </div>
                            
                            <div>
                              <label className="text-sm font-medium text-slate-600 mb-1.5 block">四、工期安排与质量安全保障</label>
                              <textarea
                                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 h-20 resize-none"
                                value={repairReport.schedule}
                                onChange={e => setRepairReport(r => ({ ...r, schedule: e.target.value }))}
                                placeholder="工期安排、质量与安全保障措施"
                              />
                            </div>
                            
                            <div>
                              <label className="text-sm font-medium text-slate-600 mb-1.5 block">五、结论</label>
                              <textarea
                                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 h-20 resize-none"
                                value={repairReport.conclusion}
                                onChange={e => setRepairReport(r => ({ ...r, conclusion: e.target.value }))}
                                placeholder="结论与建议"
                              />
                            </div>
                          </div>

                          {/* 编制信息区块 */}
                          <div className="bg-orange-50 rounded-xl p-4 space-y-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                              <Calendar className="w-4 h-4 text-orange-500" />
                              编制信息
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-sm font-medium text-slate-600 mb-1.5 block">编制单位</label>
                                <input
                                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white"
                                  value={repairReport.organization}
                                  onChange={e => setRepairReport(r => ({ ...r, organization: e.target.value }))}
                                  placeholder="如：XX市市政工程管理处"
                                />
                              </div>
                              <div>
                                <label className="text-sm font-medium text-slate-600 mb-1.5 block">编制日期</label>
                                <input
                                  type="date"
                                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white"
                                  value={repairReport.date}
                                  onChange={e => setRepairReport(r => ({ ...r, date: e.target.value }))}
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-sm font-medium text-slate-600 mb-1.5 block">联系方式（负责人/电话）</label>
                              <input
                                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white"
                                value={repairReport.contact}
                                onChange={e => setRepairReport(r => ({ ...r, contact: e.target.value }))}
                                placeholder="如：张工 138****8888"
                              />
                            </div>
                            <div>
                              <label className="text-sm font-medium text-slate-600 mb-1.5 block">附件（图片 URL 列表，逗号分隔）</label>
                              <input
                                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white"
                                value={Array.isArray(repairReport.attachment_urls) ? repairReport.attachment_urls.join(',') : repairReport.attachment_urls}
                                onChange={e => setRepairReport(r => ({ ...r, attachment_urls: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                                placeholder="http://a.jpg, http://b.jpg"
                              />
                            </div>
                          </div>

                          {repairReport.saveError && (
                            <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-center gap-2">
                              <AlertCircle className="w-5 h-5 flex-shrink-0" />
                              {repairReport.saveError}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 底部按钮 */}
                      <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex gap-3 justify-end">
                        <button
                          type="button"
                          className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors"
                          onClick={() => setShowRepairForm(false)}
                        >取消</button>
                        <button
                          type="button"
                          className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-bold text-sm hover:from-amber-600 hover:to-orange-600 transition-all shadow-md hover:shadow-lg disabled:opacity-50"
                          onClick={async () => {
                            setIsReportSaving(true);
                            setRepairReport(r => ({ ...r, saveError: null }));
                            const payload = {
                              road_id: lane.id,
                              title: repairReport.title,
                              start_stake: repairReport.start_stake,
                              end_stake: repairReport.end_stake,
                              background: repairReport.background,
                              detection: repairReport.detection,
                              core_plan: repairReport.core_plan,
                              materials: repairReport.materials,
                              budget: repairReport.budget,
                              schedule: repairReport.schedule,
                              conclusion: repairReport.conclusion,
                              organization: repairReport.organization,
                              date: repairReport.date,
                              contact: repairReport.contact,
                              attachment_urls: repairReport.attachment_urls || [],
                            };
                            try {
                              const resp = await axios.post('/api/repair-report', payload);
                              alert('维修报告已提交');
                              setShowRepairForm(false);
                              setRepairReport({ title: '', start_stake: '', end_stake: '', background: '', detection: '', core_plan: '', materials: '', budget: '', schedule: '', conclusion: '', organization: '', date: '', contact: '', attachment_urls: [], saveError: null });
                            } catch (err: any) {
                              console.error('提交维修报告错误：', err);
                              const status = err?.response?.status;
                              const serverMsg = err?.response?.data?.message || err?.response?.data || err?.message;
                              setRepairReport(r => ({ ...r, saveError: status === 404 ? '接口未找到 (404)' : `提交失败：${serverMsg || '未知错误'} (status: ${status || 'unknown'})` }));
                            } finally {
                              setIsReportSaving(false);
                            }
                          }}
                          disabled={isReportSaving}
                        >{isReportSaving ? '提交中...' : '提交报告'}</button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}

                {/* 指派维修弹窗 - 管理员选择维修方 */}
                {showAssignModal && ReactDOM.createPortal(
                  <div className="fixed inset-0 bg-black/40 z-[3000] flex items-center justify-center" onClick={() => setShowAssignModal(false)}>
                    <div className="bg-white rounded-2xl p-6 w-[480px] max-w-[92vw] shadow-2xl" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-slate-800">指派维修任务</h3>
                        <button
                          className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
                          onClick={() => setShowAssignModal(false)}
                        ><X className="w-5 h-5" /></button>
                      </div>
                      
                      {/* 路段信息预览 */}
                      <div className="bg-slate-50 rounded-xl p-4 mb-4">
                        <div className="text-sm text-slate-600 space-y-1">
                          <p><span className="font-medium">道路：</span>{lane.roadName}</p>
                          <p><span className="font-medium">状况：</span>{(savedRecord?.condition || lane.condition) === 'Poor' ? '较差' : '一般'}</p>
                          <p><span className="font-medium">破损类型：</span>{savedRecord?.damage_type || '待检查'}</p>
                          <p><span className="font-medium">严重程度：</span>{savedRecord?.severity || '待评估'}</p>
                        </div>
                      </div>

                      {/* 维修方选择 */}
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-slate-700 mb-2">选择维修方 <span className="text-red-500">*</span></label>
                        {maintainerList.length === 0 ? (
                          <div className="text-sm text-slate-500 py-3 text-center bg-slate-50 rounded-lg">
                            暂无可用的维修方
                          </div>
                        ) : (
                          <select
                            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            value={selectedMaintainer}
                            onChange={e => setSelectedMaintainer(e.target.value)}
                          >
                            <option value="">请选择维修方...</option>
                            {maintainerList.map(m => (
                              <option key={m.id} value={m.username}>
                                {m.username}{m.organization ? ` (${m.organization})` : ''}{m.contact_person ? ` - ${m.contact_person}` : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      {/* 备注 */}
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-slate-700 mb-2">备注说明</label>
                        <textarea
                          className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
                          rows={3}
                          placeholder="可填写维修要求、紧急程度等..."
                          value={assignNote}
                          onChange={e => setAssignNote(e.target.value)}
                        />
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex justify-end gap-3">
                        <button
                          className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium"
                          onClick={() => setShowAssignModal(false)}
                        >取消</button>
                        <button
                          className="px-6 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 text-white rounded-lg text-sm font-bold hover:from-purple-600 hover:to-indigo-600 disabled:opacity-50"
                          disabled={!selectedMaintainer || isAssigning}
                          onClick={handleAssignRepair}
                        >{isAssigning ? '发送中...' : '发送任务'}</button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}


        {/* 报告列表弹窗 */}
        {showReports && ReactDOM.createPortal(
          <ReportList roadId={lane.id} onClose={() => setShowReports(false)} />,
          document.body
        )}

        {/* 用户上报弹窗（图片 + 位置）- 优化UI */}
        {showUserReport && ReactDOM.createPortal(
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[3000] flex items-center justify-center" onClick={() => setShowUserReport(false)}>
            <div className="bg-gradient-to-br from-white to-slate-50 rounded-3xl p-0 w-[540px] max-w-[94vw] shadow-2xl relative max-h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* 顶部装饰条 */}
              <div className="h-2 bg-gradient-to-r from-blue-500 via-cyan-500 to-teal-500"></div>
              
              {/* 头部 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center">
                    <AlertCircle className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">问题上报</h3>
                    <p className="text-xs text-slate-500">帮助我们发现道路问题</p>
                  </div>
                </div>
                <button className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors" onClick={() => setShowUserReport(false)}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 表单内容 */}
              <div className="overflow-auto px-6 py-4 flex-1">
                <div className="space-y-5">
                  {/* 问题描述 */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span>
                      问题描述
                    </label>
                    <textarea 
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 h-28 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none transition-all" 
                      value={userReport.text} 
                      onChange={e => setUserReport(r => ({ ...r, text: e.target.value }))} 
                      placeholder="请简要描述问题，如破损位置、类型与影响程度..." 
                    />
                  </div>

                  {/* 拍照上传 */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <Sparkles className="w-4 h-4 text-amber-500" />
                      现场照片
                      <span className="text-xs font-normal text-slate-400">（可选，最多5张）</span>
                    </label>
                    <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 hover:border-blue-400 transition-colors">
                      <input 
                        type="file" 
                        accept="image/*" 
                        capture="environment" 
                        multiple 
                        className="hidden" 
                        id="user-report-photos"
                        onChange={async (e: React.ChangeEvent<HTMLInputElement>) => {
                          const fileList = e.target.files;
                          const files: File[] = fileList ? Array.from(fileList) : [];
                          const results: string[] = [];
                          for (const f of files) {
                            const data = await new Promise<string>((resolve, reject) => {
                              const reader = new FileReader();
                              reader.onload = () => resolve(String(reader.result));
                              reader.onerror = () => reject(new Error('file read error'));
                              reader.readAsDataURL(f as Blob);
                            });
                            results.push(data);
                          }
                          setUserReport(r => ({ ...r, photos: [...(r.photos||[]), ...results] }));
                        }} 
                      />
                      <label htmlFor="user-report-photos" className="flex flex-col items-center cursor-pointer py-2">
                        <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-2">
                          <Activity className="w-6 h-6 text-slate-400" />
                        </div>
                        <span className="text-sm text-slate-600">点击或拖拽上传照片</span>
                        <span className="text-xs text-slate-400 mt-1">支持 JPG、PNG 格式</span>
                      </label>
                    </div>
                    {userReport.photos && userReport.photos.length > 0 && (
                      <div className="flex gap-2 mt-3 flex-wrap">
                        {userReport.photos.map((p: string, idx: number) => (
                          <div key={idx} className="relative group">
                            <img src={p} className="w-24 h-18 object-cover rounded-lg border border-slate-200 shadow-sm" />
                            <button 
                              type="button" 
                              className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                              onClick={() => setUserReport(r => ({ ...r, photos: r.photos.filter((_:any,i:number) => i !== idx) }))}
                            >×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 位置选择 */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <TrendingUp className="w-4 h-4 text-green-500" />
                      位置信息
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button 
                        type="button" 
                        className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl text-sm font-medium hover:from-green-600 hover:to-emerald-600 transition-all shadow-sm"
                        onClick={() => {
                          if (!navigator.geolocation) { alert('当前浏览器不支持定位'); return; }
                          navigator.geolocation.getCurrentPosition((pos) => {
                            const lat = pos.coords.latitude;
                            const lng = pos.coords.longitude;
                            setUserReport(r => ({ ...r, lat, lng }));
                            window.dispatchEvent(new CustomEvent('damage-location-selected', { detail: { roadId: lane.id, lat, lng } }));
                            alert('已获取当前位置');
                          }, (err) => { alert('获取位置失败: ' + err.message); });
                        }}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        使用当前位置
                      </button>
                      <button 
                        type="button" 
                        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 hover:border-slate-300 transition-all"
                        onClick={() => {
                          setShowUserReport(false);
                          setPendingPick(lane.id);
                          window.dispatchEvent(new CustomEvent('start-pick-damage-location', { detail: { roadId: lane.id } }));
                          alert('请在地图上点击选择破损位置（弹窗已隐藏，按 Esc 取消）');
                        }}
                      >
                        <Ruler className="w-4 h-4" />
                        在地图上选择
                      </button>
                    </div>
                    {userReport.lat && (
                      <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <span className="text-sm text-green-700">已选择位置：{userReport.lat.toFixed(6)}, {userReport.lng.toFixed(6)}</span>
                      </div>
                    )}
                  </div>

                  {/* 联系方式 */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      联系方式
                      <span className="text-xs font-normal text-slate-400">（选填）</span>
                    </label>
                    <input 
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all" 
                      value={userReport.contact} 
                      onChange={e => setUserReport(r => ({ ...r, contact: e.target.value }))} 
                      placeholder="手机号或邮箱（便于管理员联系反馈）" 
                    />
                  </div>
                </div>
              </div>

              {/* 底部按钮 */}
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex gap-3 justify-end">
                <button 
                  className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors" 
                  onClick={() => setShowUserReport(false)}
                >取消</button>
                <button 
                  className="px-6 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-xl font-bold text-sm hover:from-blue-600 hover:to-cyan-600 transition-all shadow-md hover:shadow-lg disabled:opacity-50"
                  onClick={async () => {
                    if (!userReport.text || userReport.text.trim().length < 3) { alert('请填写描述'); return; }
                    const MAX_PHOTOS_BYTES = 5 * 1024 * 1024;
                    const MAX_PHOTOS_COUNT = 5;
                    const photos: string[] = userReport.photos || [];
                    if (photos.length > MAX_PHOTOS_COUNT) { alert(`图片数量不能超过 ${MAX_PHOTOS_COUNT} 张`); return; }
                    let totalBytes = 0;
                    for (const p of photos) {
                      const idx = p.indexOf(',');
                      const base64 = idx >= 0 ? p.substring(idx + 1) : p;
                      totalBytes += Math.ceil(base64.length * 3 / 4);
                    }
                    if (totalBytes > MAX_PHOTOS_BYTES) { alert('图片过大，请压缩或减少图片数量（最多 5MB）'); return; }

                    setIsUserReporting(true);
                    try {
                      const payload = {
                        road_id: lane.id,
                        type: 'user',
                        name: user?.username || null,
                        contact: userReport.contact || null,
                        text: userReport.text,
                        photo_urls: userReport.photos || [],
                        lat: userReport.lat || null,
                        lng: userReport.lng || null,
                      };
                      const resp = await axios.post('/api/message', payload);
                      const messageId = resp?.data?.id || resp?.data?.record?.id || null;
                      window.dispatchEvent(new CustomEvent('damage-reported', { detail: { id: messageId, roadId: lane.id, lat: userReport.lat, lng: userReport.lng, description: userReport.text, severity: userReport.severity || null, photos: userReport.photos || [] } }));
                      alert('上报已发送，管理员会收到通知');
                      setShowUserReport(false);
                      setUserReport({ text: '', photos: [], contact: '', lat: null, lng: null });
                    } catch (err: any) {
                      console.error('send message error', err);
                      const status = err?.response?.status;
                      if (status === 413) {
                        alert('上传内容过大，请压缩图片后重试');
                      } else {
                        alert('发送失败，请稍后重试');
                      }
                    } finally { setIsUserReporting(false); }
                  }} 
                  disabled={isUserReporting}
                >{isUserReporting ? '发送中...' : '提交上报'}</button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* 编辑路况表单弹窗 - 美化版 */}
        {showEditForm && ReactDOM.createPortal(
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[3000] flex items-center justify-center" onClick={() => closeEditForm()}>
            <div className="bg-gradient-to-br from-white to-slate-50 rounded-3xl p-0 w-[520px] max-w-[95vw] max-h-[90vh] shadow-2xl relative overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              {/* 顶部装饰条 */}
              <div className="h-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>
              <button className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all z-10" onClick={() => closeEditForm()}><X className="w-5 h-5" /></button>
              
              {/* 标题区 */}
              <div className="px-6 pt-6 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl shadow-lg">
                    <ShieldCheck className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">{form.condition ? '编辑' : '添加'}路况信息</h3>
                    <p className="text-xs text-slate-500">填写道路破损和路况评级信息</p>
                  </div>
                </div>
              </div>
              
              {/* 表单内容区 - 可滚动 */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <form className="space-y-5">
                  {/* 路况等级区块 */}
                  <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">路况评级</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { value: 'Excellent', label: '优良', color: 'emerald' },
                        { value: 'Good', label: '良好', color: 'green' },
                        { value: 'Fair', label: '一般', color: 'amber' },
                        { value: 'Poor', label: '较差', color: 'red' }
                      ].map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`py-3 rounded-xl font-bold text-sm transition-all ${
                            form.condition === opt.value 
                              ? `bg-${opt.color}-500 text-white shadow-md` 
                              : `bg-${opt.color}-50 text-${opt.color}-700 hover:bg-${opt.color}-100 border border-${opt.color}-200`
                          }`}
                          onClick={() => setForm(f => ({ ...f, condition: opt.value }))}
                        >{opt.label}</button>
                      ))}
                    </div>
                  </div>

                  {/* 破损信息区块 */}
                  <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-orange-500"></div>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">破损信息</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-slate-600">破损类型</span>
                        <input
                          className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                          value={form.damage_type}
                          onChange={e => setForm(f => ({ ...f, damage_type: e.target.value }))}
                          placeholder="如龟裂、坑槽、车辙等"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-slate-600">严重程度</span>
                        <select
                          className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                          value={form.severity}
                          onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}
                        >
                          <option value="">请选择</option>
                          <option value="轻微">轻微</option>
                          <option value="中等">中等</option>
                          <option value="严重">严重</option>
                        </select>
                      </label>
                    </div>
                    <label className="flex flex-col gap-1.5 mt-3">
                      <span className="text-xs font-medium text-slate-600">详细描述</span>
                      <textarea
                        className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all resize-none h-20"
                        value={form.description}
                        onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                        placeholder="描述具体破损位置、面积、形成原因等"
                      />
                    </label>
                  </div>

                  {/* 上报人信息区块 */}
                  <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">上报人信息</span>
                      </div>
                      <button
                        className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                        type="button"
                        onClick={() => {
                          const detail: any = {};
                          if (form.reporter_id) detail.reporter_id = form.reporter_id;
                          if (form.reporter_name) detail.name = form.reporter_name;
                          if (!detail.reporter_id && !detail.name) { alert('请先填写上报人 ID 或姓名'); return; }
                          window.dispatchEvent(new CustomEvent('open-messages', { detail }));
                        }}
                      >查看该用户消息 →</button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-slate-600">上报人ID</span>
                        <input
                          className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                          value={form.reporter_id}
                          onChange={e => setForm(f => ({ ...f, reporter_id: e.target.value }))}
                          placeholder="可选填"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-slate-600">上报人姓名</span>
                        <input
                          className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                          value={form.reporter_name}
                          onChange={e => setForm(f => ({ ...f, reporter_name: e.target.value }))}
                          placeholder="可选填"
                        />
                      </label>
                    </div>
                  </div>

                  {/* 道路信息区块 */}
                  <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">道路信息</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-slate-600">道路名称</span>
                        <input
                          className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                          value={form.road_name}
                          onChange={e => setForm(f => ({ ...f, road_name: e.target.value }))}
                          placeholder="如 XX 路"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-slate-600">备注信息</span>
                        <input
                          className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                          value={form.notes}
                          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                          placeholder="其他补充说明"
                        />
                      </label>
                    </div>
                  </div>

                  {/* 核查信息区块 */}
                  <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-green-500"></div>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">核查信息</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-slate-600">是否已核查</span>
                        <select
                          className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                          value={form.is_verified}
                          onChange={e => setForm(f => ({ ...f, is_verified: Number(e.target.value) }))}
                        >
                          <option value={0}>否</option>
                          <option value={1}>是</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-slate-600">核查人</span>
                        <input
                          className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                          value={form.verified_by}
                          onChange={e => setForm(f => ({ ...f, verified_by: e.target.value }))}
                          placeholder="可选"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-slate-600">核查时间</span>
                        <input
                          type="datetime-local"
                          className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                          value={form.verified_at}
                          onChange={e => setForm(f => ({ ...f, verified_at: e.target.value }))}
                        />
                      </label>
                    </div>
                  </div>

                  {/* 附件区块 */}
                  <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-pink-500"></div>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">附件图片</span>
                    </div>
                    <input
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                      value={Array.isArray(form.attachment_urls) ? form.attachment_urls.join(', ') : form.attachment_urls}
                      onChange={e => setForm(f => ({ ...f, attachment_urls: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                      placeholder="图片URL，多个用逗号分隔"
                    />
                    {/* 附件预览 */}
                    {form.attachment_urls && form.attachment_urls.length > 0 && (
                      <div className="flex gap-2 mt-3 flex-wrap">
                        {form.attachment_urls.map((url: string, idx: number) => (
                          <div key={idx} className="relative group">
                            <img src={url} alt={`附件${idx+1}`} className="w-16 h-12 object-cover rounded-lg border border-slate-200" />
                            <button
                              type="button"
                              className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => setForm(f => ({ ...f, attachment_urls: f.attachment_urls.filter((_: any, i: number) => i !== idx) }))}
                            >×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {saveError && (
                    <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
                      {saveError}
                    </div>
                  )}
                </form>
              </div>
              
              {/* 底部操作区 */}
              <div className="px-6 py-4 border-t border-slate-100 bg-white/80 backdrop-blur">
                <div className="flex gap-3">
                  {(form.condition === 'Poor' || form.condition === 'Fair') && (
                    <button
                      type="button"
                      className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-green-500 text-white rounded-xl font-bold text-sm hover:from-emerald-600 hover:to-green-600 transition-all shadow-md"
                      onClick={() => {
                        setForm(f => ({
                          ...f,
                          condition: 'Excellent',
                          damage_type: '',
                          severity: '',
                          description: '',
                          notes: '',
                          attachment_urls: [],
                        }));
                      }}
                    >✓ 标记为已维修</button>
                  )}
                  <button
                    type="button"
                    className="flex-1 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl font-bold text-sm hover:from-indigo-600 hover:to-purple-600 transition-all shadow-md disabled:opacity-50"
                    onClick={async () => {
                      setIsSaving(true);
                      setSaveError(null);
                      const payload = {
                        road_id: lane.id,
                        condition: form.condition,
                        description: form.description,
                        damage_type: form.damage_type,
                        severity: form.severity,
                        reporter_id: form.reporter_id,
                        reporter_name: form.reporter_name,
                        road_name: form.road_name,
                        notes: form.notes,
                        attachment_urls: form.attachment_urls,
                        is_verified: form.is_verified,
                        verified_by: form.verified_by,
                        verified_at: form.verified_at,
                      };
                      try {
                        const resp = await axios.post('/api/road-condition', payload);
                        setSaveError(null);
                        const record = resp?.data?.record;
                        if (record) {
                          if (typeof onSaved === 'function') await onSaved(record);
                        } else {
                          if (typeof onSaved === 'function') await onSaved();
                        }
                        alert('保存成功');
                        closeEditForm(record);
                      } catch (e: any) {
                        console.error('保存接口错误：', e?.response || e);
                        const status = e?.response?.status;
                        const serverMsg = e?.response?.data?.message || e?.response?.data || e?.message;
                        const friendly = status === 404
                          ? '保存失败：后端接口未找到 (404)。请检查后端路由或 API 路径是否正确。'
                          : `保存失败：${serverMsg || '未知错误'} (status: ${status || 'unknown'})`;
                        setSaveError(friendly);
                      } finally {
                        setIsSaving(false);
                      }
                    }}
                    disabled={isSaving}
                  >{isSaving ? (<><Loader2 className="w-4 h-4 inline-block mr-2 animate-spin" />保存中...</>) : '保存信息'}</button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
        {/* 破损详情弹窗 - 美化版 */}
        {showDamageDetail && ReactDOM.createPortal(
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[3000] flex items-center justify-center" onClick={() => setShowDamageDetail(false)}>
            <div className="bg-gradient-to-br from-white to-slate-50 rounded-3xl p-0 w-[400px] max-w-[92vw] shadow-2xl relative overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* 顶部装饰条 */}
              <div className="h-2 bg-gradient-to-r from-orange-400 via-amber-400 to-yellow-400"></div>
              <button className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all" onClick={() => setShowDamageDetail(false)}><X className="w-5 h-5" /></button>
              
              <div className="p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-3 bg-gradient-to-br from-orange-500 to-amber-500 rounded-2xl shadow-lg">
                    <AlertCircle className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">破损详情</h3>
                    <p className="text-xs text-slate-500">路段损坏信息记录</p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  {/* 破损类型 */}
                  <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-orange-500"></div>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">破损类型</span>
                    </div>
                    <div className="text-lg font-bold text-slate-900">{savedRecord?.damage_type || '暂无记录'}</div>
                  </div>
                  
                  {/* 严重程度 */}
                  <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-red-500"></div>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">严重程度</span>
                    </div>
                    <div className={`text-lg font-bold ${
                      savedRecord?.severity === '严重' ? 'text-red-600' :
                      savedRecord?.severity === '中等' ? 'text-amber-600' :
                      savedRecord?.severity === '轻微' ? 'text-green-600' : 'text-slate-400'
                    }`}>{savedRecord?.severity || '暂无评估'}</div>
                  </div>
                  
                  {/* 描述 */}
                  <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">详细描述</span>
                    </div>
                    <div className="text-sm text-slate-700 leading-relaxed">{savedRecord?.description || '暂无描述信息'}</div>
                  </div>

                  {/* 附件预览（如果有的话） */}
                  {savedRecord?.attachment_urls && Array.isArray(savedRecord.attachment_urls) && savedRecord.attachment_urls.length > 0 && (
                    <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">现场照片</span>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {savedRecord.attachment_urls.map((url: string, idx: number) => (
                          <button key={idx} type="button" onClick={() => setSelectedAttachImage(url)} className="rounded-lg overflow-hidden border-2 border-slate-200 hover:border-indigo-400 transition-all">
                            <img src={url} alt={`附件${idx+1}`} className="w-20 h-16 object-cover" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                
                {/* 操作按钮 */}
                {permissions.canEdit && (
                  <button
                    className="w-full mt-6 py-3 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-xl font-bold text-sm hover:from-indigo-600 hover:to-indigo-700 transition-all shadow-md"
                    onClick={() => { setShowDamageDetail(false); openEditForm(); }}
                  >编辑破损信息</button>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

        {/*Structured Report */}
        <div className="px-8 pb-10">
          <div className="bg-white rounded-[40px] p-8 text-slate-900 relative overflow-hidden shadow-2xl border border-indigo-100">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-200/30 rounded-full blur-[80px] -mr-32 -mt-32"></div>
            <div className="relative">
              <div className="flex items-center gap-3 mb-8">
                <div className="p-2 bg-yellow-400 rounded-2xl shadow-lg shadow-yellow-200/40">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-yellow-500">深度分析</h3>
              </div>
              {/* 分析类型选择（定制下拉） */}
              <div className="flex gap-3 mb-4 items-start">
                <div className="flex-1">
                  <label className="block text-xs font-bold text-slate-500 mb-1">分析类型</label>
                  <div className="relative" ref={analysisMenuRef}>
                    <button
                      type="button"
                      onClick={() => setShowAnalysisMenu(s => !s)}
                      className="w-full flex items-center justify-between gap-3 py-2 px-4 rounded-2xl border border-indigo-100 bg-white shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      aria-haspopup="listbox"
                      aria-expanded={showAnalysisMenu}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${analysisType === 'spatial' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'}`}>
                          {analysisType === 'spatial' ? <Activity className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                        </div>
                        <div className="text-xs font-medium">{analysisType === 'spatial' ? '基础分析' : 'AI分析'}</div>
                      </div>
                      <div className="flex items-center gap-2 text-slate-400">
                        {analysisType === 'ai' && !permissions.canAI ? <Lock className="w-4 h-4 text-slate-400" /> : null}
                        <ChevronDown className="w-4 h-4" />
                      </div>
                    </button>

                    {showAnalysisMenu && (
                      <div className="absolute mt-2 w-full bg-white border border-slate-100 rounded-xl shadow-lg z-40">
                        <ul role="listbox" aria-label="分析选项" className="py-2">
                          <li>
                            <button
                              className={`w-full text-left px-4 py-2 hover:bg-indigo-50 flex items-center gap-3 rounded-xl transition-colors focus:outline-none focus:bg-indigo-50 ${analysisType === 'spatial' ? 'bg-gradient-to-r from-indigo-50 to-indigo-100 font-semibold ring-1 ring-indigo-200' : ''}`}
                              onClick={() => { setAnalysisType('spatial'); setShowAnalysisMenu(false); }}
                            >
                              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700"><Activity className="w-5 h-5" /></div>
                              <div className="text-xs font-semibold">基础分析</div>
                            </button>
                          </li>
                          <li>
                            <button
                              className={`w-full text-left px-4 py-2 hover:bg-indigo-50 flex items-center gap-3 rounded-xl transition-colors focus:outline-none focus:bg-indigo-50 ${analysisType === 'ai' ? 'bg-gradient-to-r from-amber-50 to-amber-100 font-semibold ring-1 ring-amber-200' : ''} ${!permissions.canAI ? 'opacity-60 cursor-not-allowed' : ''}`}
                              onClick={() => { if (!permissions.canAI) return; setAnalysisType('ai'); setShowAnalysisMenu(false); }}
                            >
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${permissions.canAI ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-300'}`}><Sparkles className="w-5 h-5" /></div>
                              <div className="text-xs font-semibold">AI 分析</div>
                            </button>
                          </li>
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                <div className="w-36 mt-6">
                  <button
                    className="w-full py-3 rounded-2xl bg-indigo-600 text-white font-black text-sm hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                    onClick={() => { setShowAnalysisMenu(false); handleRunAnalysis(); }}
                    disabled={isLoading || (analysisType === 'ai' && !permissions.canAI)}
                  >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {isLoading ? '分析中...' : '运行分析'}
                  </button>
                </div>
              </div>

              {/* 分析结果区 */}
              {!analysisRequested ? (
                <div className="text-yellow-400 text-center py-10 text-sm">尚未运行分析，选择分析类型并点击“运行”</div>
              ) : isLoading ? (
                <div className="space-y-6 py-4">
                  <div className="space-y-3">
                    <div className="h-2 bg-yellow-100 rounded-full w-2/3 animate-pulse"></div>
                    <div className="h-2 bg-yellow-100 rounded-full w-full animate-pulse"></div>
                  </div>
                  <div className="flex flex-col items-center justify-center pt-10 text-yellow-500">
                    <Loader2 className="w-8 h-8 animate-spin mb-4" />
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-50">Synthesizing Traffic Data</span>
                  </div>
                </div>
              ) : analysisType === 'ai' && analysis ? (
                <div className="space-y-8">
                  {/* Safety Section */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs font-black text-yellow-600 uppercase tracking-widest">
                      <ShieldCheck className="w-4 h-4 text-emerald-500" /> 安全评估
                    </div>
                    <div className="bg-yellow-50 border border-yellow-100 rounded-2xl p-5">
                      <div className="text-emerald-500 font-bold mb-1">{analysis.safety.status}</div>
                      <div className="text-sm text-slate-700 leading-relaxed">{analysis.safety.risks}</div>
                    </div>
                  </div>
                  {/* Insights Section */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs font-black text-yellow-600 uppercase tracking-widest">
                      <AlertCircle className="w-4 h-4 text-indigo-500" /> 通行洞察
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
                        <div className="text-[10px] font-black text-indigo-400 uppercase mb-1">能力分析</div>
                        <div className="text-sm text-indigo-700">{analysis.insights.capacity}</div>
                      </div>
                      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
                        <div className="text-[10px] font-black text-indigo-400 uppercase mb-1">合规审查</div>
                        <div className="text-sm text-indigo-700">{analysis.insights.standard}</div>
                      </div>
                    </div>
                  </div>
                  {/* Suggestions Section */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs font-black text-yellow-600 uppercase tracking-widest">
                      <Lightbulb className="w-4 h-4 text-yellow-400" /> 优化建议
                    </div>
                    <div className="space-y-3">
                      {analysis.suggestions.map((s: string, idx: number) => (
                        <div key={idx} className="flex gap-4 items-start bg-yellow-100/60 border border-yellow-200 rounded-2xl p-4 transition-all hover:bg-yellow-200/80">
                          <CheckCircle2 className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                          <div className="text-sm text-yellow-800 font-medium">{s}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : analysisType === 'spatial' && spatialResult ? (
                <div className="space-y-4">
                  {spatialResult.error ? (
                    <div className="text-sm text-red-600">{spatialResult.error}</div>
                  ) : spatialResult.laneSummary ? (
                    // 单路段友好视图 - 美化后的基础分析
                    <div className="space-y-4">
                      {/* 道路信息卡片 */}
                      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="p-2 bg-indigo-500 rounded-xl shadow-md">
                            <Ruler className="w-4 h-4 text-white" />
                          </div>
                          <span className="text-sm font-bold text-indigo-700">道路概况</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-white/70 backdrop-blur rounded-xl p-3 text-center shadow-sm border border-white/50">
                            <div className="text-2xl font-black text-indigo-600">{(spatialResult.laneSummary.lengthMeters / 1000).toFixed(2)}</div>
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">公里</div>
                          </div>
                          <div className="bg-white/70 backdrop-blur rounded-xl p-3 text-center shadow-sm border border-white/50">
                            <div className={`text-2xl font-black ${
                              spatialResult.laneSummary.condition === 'Poor' ? 'text-red-500' :
                              spatialResult.laneSummary.condition === 'Fair' ? 'text-amber-500' :
                              spatialResult.laneSummary.condition === 'Good' ? 'text-green-500' : 'text-slate-400'
                            }`}>
                              {spatialResult.laneSummary.condition === 'Poor' ? '较差' :
                               spatialResult.laneSummary.condition === 'Fair' ? '一般' :
                               spatialResult.laneSummary.condition === 'Good' ? '良好' :
                               spatialResult.laneSummary.condition === 'Excellent' ? '优良' : '待检'}
                            </div>
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">路况</div>
                          </div>
                        </div>
                      </div>

                      {/* 破损统计卡片 - 仅在有真实数据时显示 */}
                      {(spatialResult.laneSummary.damageDensityPerKm > 0 || spatialResult.laneSummary.avgSeverity > 0) && (
                        <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100 rounded-2xl p-5 shadow-sm">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="p-2 bg-amber-500 rounded-xl shadow-md">
                              <AlertCircle className="w-4 h-4 text-white" />
                            </div>
                            <span className="text-sm font-bold text-amber-700">破损统计</span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-white/70 backdrop-blur rounded-xl p-3 text-center shadow-sm border border-white/50">
                              <div className="text-2xl font-black text-amber-600">{spatialResult.laneSummary.damageDensityPerKm.toFixed(1)}</div>
                              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">处/公里</div>
                            </div>
                            <div className="bg-white/70 backdrop-blur rounded-xl p-3 text-center shadow-sm border border-white/50">
                              <div className="text-2xl font-black text-orange-600">{spatialResult.laneSummary.avgSeverity.toFixed(1)}</div>
                              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">平均严重度</div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 紧迫性标签 */}
                      <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${
                        spatialResult.laneSummary.urgency === 'critical' ? 'bg-red-100 border-red-200' :
                        spatialResult.laneSummary.urgency === 'high' ? 'bg-orange-100 border-orange-200' :
                        spatialResult.laneSummary.urgency === 'medium' ? 'bg-amber-100 border-amber-200' :
                        'bg-emerald-100 border-emerald-200'
                      }`}>
                        <div className={`p-2 rounded-lg ${
                          spatialResult.laneSummary.urgency === 'critical' ? 'bg-red-500' :
                          spatialResult.laneSummary.urgency === 'high' ? 'bg-orange-500' :
                          spatialResult.laneSummary.urgency === 'medium' ? 'bg-amber-500' :
                          'bg-emerald-500'
                        }`}>
                          <Activity className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <div className={`text-sm font-bold ${
                            spatialResult.laneSummary.urgency === 'critical' ? 'text-red-700' :
                            spatialResult.laneSummary.urgency === 'high' ? 'text-orange-700' :
                            spatialResult.laneSummary.urgency === 'medium' ? 'text-amber-700' :
                            'text-emerald-700'
                          }`}>
                            {spatialResult.laneSummary.urgency === 'critical' ? '⚠️ 紧急维修' :
                             spatialResult.laneSummary.urgency === 'high' ? '🔴 优先处理' :
                             spatialResult.laneSummary.urgency === 'medium' ? '🟡 计划养护' :
                             '🟢 状态正常'}
                          </div>
                          <div className="text-xs text-slate-600 mt-0.5">维修紧迫性评估</div>
                        </div>
                      </div>

                      {/* 建议卡片 */}
                      {spatialResult.laneSummary.suggestions && spatialResult.laneSummary.suggestions.length > 0 && (
                        <div className="bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 rounded-2xl p-5 shadow-sm">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="p-2 bg-slate-600 rounded-xl shadow-md">
                              <Lightbulb className="w-4 h-4 text-white" />
                            </div>
                            <span className="text-sm font-bold text-slate-700">处置建议</span>
                          </div>
                          <div className="space-y-2">
                            {spatialResult.laneSummary.suggestions.map((s: string, i: number) => (
                              <div key={i} className="flex items-start gap-3 bg-white/80 backdrop-blur rounded-xl p-3 border border-slate-100">
                                <CheckCircle2 className="w-4 h-4 text-indigo-500 mt-0.5 flex-shrink-0" />
                                <span className="text-sm text-slate-700">{s}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    // 区域 / 多路段视图（保留原有热点与核密度展示）
                    <>
                      <div className="text-xs font-black uppercase text-indigo-500 tracking-widest flex items-center gap-2"><Ruler className="w-4 h-4 text-indigo-400" /> 热点（Getis-Ord Gi*）</div>
                      <div className="grid grid-cols-1 gap-2">
                        {spatialResult.hotspots.slice(0,6).map((h: any, idx: number) => (
                          <div key={idx} className={`p-3 rounded-2xl border ${h.hotspotType === 'hotspot' ? 'bg-red-50 border-red-100' : h.hotspotType === 'coldspot' ? 'bg-blue-50 border-blue-100' : 'bg-slate-50 border-slate-100'}`}>
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-bold">{h.hotspotType === 'hotspot' ? '热点' : h.hotspotType === 'coldspot' ? '冷点' : '无显著性'}</div>
                              <div className="text-xs text-slate-500">z={h.zScore.toFixed(2)} p={h.pValue.toFixed(3)}</div>
                            </div>
                            <div className="text-xs text-slate-600 mt-1">{h.lat.toFixed(5)}, {h.lng.toFixed(5)}</div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-3 text-xs font-black uppercase text-indigo-500 tracking-widest flex items-center gap-2"><Activity className="w-4 h-4 text-indigo-400" /> 核密度（Kernel Density）</div>
                      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-3">
                        <div className="text-sm">格子：{spatialResult.kernel.grid.rows} x {spatialResult.kernel.grid.cols}，cellSize {spatialResult.kernel.grid.cellSizeMeters}m</div>
                        <div className="text-sm text-slate-600">归一化后最大密度值：{spatialResult.kernel.maxValue.toFixed(3)}</div>
                        <div className="mt-2 text-xs text-slate-500">提示：可将 <code>kernel.cells</code> 转为 GeoJSON 并用于地图热力图渲染。</div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-yellow-400 text-center py-10 text-sm">暂无分析数据</div>
              )}
            </div>
          </div>
<div className="flex gap-3">
                <button className="w-full mt-8 py-4 bg-yellow-50 rounded-2xl border border-yellow-100 text-yellow-500 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-yellow-100 hover:text-yellow-700 transition-all flex items-center justify-center gap-2">
                  下载完整报告 <ChevronRight className="w-3 h-3" />
                </button>
                {(user.role === 'user' || user.role === 'admin') && (
                  <button className="mt-8 py-4 px-4 bg-emerald-500 text-white rounded-2xl text-[13px] font-bold hover:bg-emerald-600" onClick={() => setShowUserReport(true)}>
                    {user.role === 'admin' ? '添加上报点' : '上报问题'}
                  </button>
                )}
              </div>
            </div>
          </div>
              
      {selectedAttachImage && ReactDOM.createPortal(
        <div className="fixed inset-0 z-[4200] bg-black/70 flex items-center justify-center" onClick={() => setSelectedAttachImage(null)}>
          <div className="max-w-[92vw] max-h-[92vh] p-2" onClick={e => e.stopPropagation()}>
            <button className="absolute top-4 right-4 z-[4300] bg-white rounded-full p-2 shadow" onClick={() => setSelectedAttachImage(null)}><X className="w-4 h-4" /></button>
            <img src={selectedAttachImage as string} alt="preview" className="max-w-[92vw] max-h-[92vh] rounded-md" />
            <div className="text-center mt-3"><a className="text-sm text-indigo-400 hover:underline" href={selectedAttachImage as string} target="_blank" rel="noreferrer">在新标签页打开</a></div>
          </div>
        </div>,
        document.body
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 0px;
        }
      `}</style>
    </div>
  );
};

export default LaneDetails;
