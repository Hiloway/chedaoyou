import React, { useState } from 'react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { analyzeDamagePhoto } from '../services/deepseekService';

interface PhotoAnalysisModalProps {
  photoUrl: string;
  roadName?: string;
  locationText?: string;
  onClose: () => void;
}

/**
 * 图片预览 + AI 病害诊断弹窗
 * 内部管理分析结果 state，每次 photoUrl 变化时由父组件用 key 触发 remount 以重置状态
 */
const PhotoAnalysisModal: React.FC<PhotoAnalysisModalProps> = ({ photoUrl, roadName, locationText, onClose }) => {
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!photoUrl) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    const res = await analyzeDamagePhoto(photoUrl, { roadName, locationText });
    if (!res || res.error) {
      setError(res?.error || '分析失败，请稍后重试');
      setLoading(false);
      return;
    }
    setAnalysis(res.data);
    setLoading(false);
  };

  const severityColor = (severity?: string) => {
    if (severity === '严重') return 'text-red-600';
    if (severity === '中等') return 'text-amber-600';
    return 'text-green-600';
  };

  return (
    <div className="fixed inset-0 z-[5000] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white flex flex-row max-w-[96vw] max-h-[94vh] w-[1200px] h-[85vh] relative rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <button
          className="absolute top-3 right-3 p-2 bg-white/80 hover:bg-white rounded-full transition-colors text-slate-600 z-10 shadow-sm"
          onClick={onClose}
          aria-label="关闭图片预览"
        >
          <X className="w-5 h-5" />
        </button>

        {/* 左侧：图片区域（占主导 ~65%） */}
        <div className="flex-[3] flex flex-col bg-slate-900 min-w-0">
          <div className="flex-1 flex items-center justify-center p-2 relative overflow-hidden">
            <img
              src={photoUrl}
              alt="预览图"
              className="w-full h-full object-contain"
              style={{ maxHeight: 'calc(85vh - 60px)' }}
            />
            {/* 图片上的分析标注覆盖层 */}
            {analysis?.highlight_regions && analysis.highlight_regions.length > 0 && (
              <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2">
                {analysis.highlight_regions.map((region: any, idx: number) => (
                  <div key={idx} className="bg-red-500/90 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm flex items-center gap-1.5 cursor-default hover:bg-red-600 transition-colors" title={region.description}>
                    <AlertTriangle className="w-3 h-3" />
                    <span>{region.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* 底部图片信息栏 */}
          <div className="bg-slate-800 px-5 py-3 flex items-center justify-between text-xs text-slate-400 border-t border-slate-700">
            <span>道路：{roadName || '未知'}</span>
            {analysis && (
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${analysis.severity === '严重' ? 'bg-red-500/20 text-red-400' : analysis.severity === '中等' ? 'bg-amber-500/20 text-amber-400' : 'bg-green-500/20 text-green-400'}`}>
                  {analysis.severity || '未知'}
                </span>
                {analysis.severity_score && (
                  <span>评分：{analysis.severity_score}/10</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 右侧：分析面板（~35%） */}
        <div className="flex-[2] flex flex-col min-w-[340px] max-w-[400px] border-l border-slate-200 bg-white">
          {/* 头部 - 固定 */}
          <div className="px-5 py-4 pt-14 border-b border-slate-100 flex items-center justify-between flex-shrink-0 bg-white z-10">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
              <span className="font-bold text-slate-900 text-sm">智能病害诊断</span>
            </div>
            <button
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              onClick={handleAnalyze}
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />分析中...</span>
              ) : '开始分析'}
            </button>
          </div>

          {/* 可滚动内容区域 */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-3">{error}</div>}

            {loading && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                <div className="text-sm text-slate-500">正在分析病害特征...</div>
                <div className="text-xs text-slate-400">正在识别病害类型、评估严重度并生成维修方案</div>
              </div>
            )}

            {analysis && !loading ? (
              <div className="space-y-4 text-sm">
                {/* 1. 病害诊断 */}
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-gradient-to-r from-red-50 to-orange-50 px-4 py-2.5 border-b border-slate-100">
                    <div className="font-bold text-slate-800 text-xs flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-[10px] font-black">1</span>
                      病害诊断
                    </div>
                  </div>
                  <div className="p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 text-xs">病害类型</span>
                      <span className="font-semibold text-slate-900">{analysis.damage_type || '未知'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 text-xs">严重等级</span>
                      <span className={`font-semibold ${severityColor(analysis.severity)}`}>{analysis.severity || '未知'}</span>
                    </div>
                    {analysis.severity_score && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-slate-500 text-xs">严重度评分</span>
                          <span className="font-semibold text-slate-700">{analysis.severity_score}/10</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2">
                          <div className={`h-2 rounded-full transition-all ${analysis.severity_score >= 7 ? 'bg-red-500' : analysis.severity_score >= 4 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${analysis.severity_score * 10}%` }}></div>
                        </div>
                      </div>
                    )}
                    {analysis.dimensions && (
                      <div className="bg-slate-50 rounded-lg p-2.5 mt-1 grid grid-cols-2 gap-2">
                        {analysis.dimensions.estimated_length && <div><div className="text-[10px] text-slate-400">估算长度</div><div className="text-xs font-semibold text-slate-700">{analysis.dimensions.estimated_length}</div></div>}
                        {analysis.dimensions.estimated_width && <div><div className="text-[10px] text-slate-400">估算宽度</div><div className="text-xs font-semibold text-slate-700">{analysis.dimensions.estimated_width}</div></div>}
                        {analysis.dimensions.estimated_depth && <div><div className="text-[10px] text-slate-400">估算深度</div><div className="text-xs font-semibold text-slate-700">{analysis.dimensions.estimated_depth}</div></div>}
                        {analysis.dimensions.estimated_area && <div><div className="text-[10px] text-slate-400">影响面积</div><div className="text-xs font-semibold text-slate-700">{analysis.dimensions.estimated_area}</div></div>}
                      </div>
                    )}
                    {analysis.reasoning && <div className="text-xs text-slate-500 mt-2 bg-blue-50 rounded-lg p-2.5 border border-blue-100">💡 {analysis.reasoning}</div>}
                  </div>
                </div>

                {/* 2. 成因分析 */}
                {analysis.cause_analysis && (
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="bg-gradient-to-r from-purple-50 to-pink-50 px-4 py-2.5 border-b border-slate-100">
                      <div className="font-bold text-slate-800 text-xs flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-[10px] font-black">2</span>
                        损伤成因分析
                      </div>
                    </div>
                    <div className="p-4 space-y-2">
                      <div><span className="text-slate-500 text-xs">主因：</span><span className="text-slate-800 font-medium text-xs">{analysis.cause_analysis.primary_cause}</span></div>
                      {analysis.cause_analysis.contributing_factors && analysis.cause_analysis.contributing_factors.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {analysis.cause_analysis.contributing_factors.map((f: string, idx: number) => (
                            <span key={idx} className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded-md text-[11px]">{f}</span>
                          ))}
                        </div>
                      )}
                      {analysis.cause_analysis.progression_risk && <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded-lg mt-1">⚠️ {analysis.cause_analysis.progression_risk}</div>}
                    </div>
                  </div>
                )}

                {/* 3. 维修材料与工艺 */}
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-gradient-to-r from-blue-50 to-cyan-50 px-4 py-2.5 border-b border-slate-100">
                    <div className="font-bold text-slate-800 text-xs flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[10px] font-black">3</span>
                      维修方案与材料
                    </div>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${analysis.maintenance?.urgency === '立即' ? 'bg-red-500 animate-pulse' : analysis.maintenance?.urgency?.includes('短期') ? 'bg-amber-500' : 'bg-green-500'}`}></span>
                        <span className="text-xs font-semibold text-slate-700">{analysis.maintenance?.urgency || '待评估'}</span>
                      </div>
                      {analysis.maintenance?.technique && (
                        <span className="px-2.5 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[11px] font-medium">{analysis.maintenance.technique}</span>
                      )}
                      {analysis.maintenance?.estimated_cost && (
                        <span className="text-xs text-slate-500">💰 {analysis.maintenance.estimated_cost}</span>
                      )}
                    </div>
                    {analysis.maintenance?.actions && analysis.maintenance.actions.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[11px] text-slate-400 font-semibold">维修步骤</div>
                        {analysis.maintenance.actions.map((a: string, idx: number) => (
                          <div key={idx} className="flex items-start gap-2 text-xs text-slate-700">
                            <span className="w-4 h-4 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">{idx + 1}</span>
                            {a}
                          </div>
                        ))}
                      </div>
                    )}
                    {analysis.maintenance?.materials && analysis.maintenance.materials.length > 0 && (
                      <div>
                        <div className="text-[11px] text-slate-400 font-semibold mb-2">所需材料</div>
                        <div className="space-y-1.5">
                          {analysis.maintenance.materials.map((m: any, idx: number) => (
                            <div key={idx} className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                              <div className="font-medium text-xs text-slate-800">{m.name}{m.spec ? ` (${m.spec})` : ''}</div>
                              <div className="text-[11px] text-slate-500 mt-0.5">{m.usage}{m.unit_amount ? ` · 用量：${m.unit_amount}` : ''}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {analysis.maintenance?.equipment && analysis.maintenance.equipment.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-[11px] text-slate-400">设备：</span>
                        {analysis.maintenance.equipment.map((eq: string, idx: number) => (
                          <span key={idx} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[11px]">{eq}</span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-4 text-[11px] text-slate-500">
                      {analysis.maintenance?.work_duration && <span>⏱ 工期：{analysis.maintenance.work_duration}</span>}
                      {analysis.maintenance?.quality_standard && <span>✅ {analysis.maintenance.quality_standard}</span>}
                    </div>
                  </div>
                </div>

                {/* 4. 通行管控 */}
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-gradient-to-r from-amber-50 to-yellow-50 px-4 py-2.5 border-b border-slate-100">
                    <div className="font-bold text-slate-800 text-xs flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-[10px] font-black">4</span>
                      通行管控
                    </div>
                  </div>
                  <div className="p-4 space-y-2">
                    <div className="text-xs text-slate-700">{analysis.traffic?.impact || '影响待评估'}</div>
                    <div className="flex items-center gap-3 flex-wrap text-xs">
                      {analysis.traffic?.risk_level && (
                        <span className={`px-2 py-0.5 rounded-full font-semibold ${analysis.traffic.risk_level === '高' ? 'bg-red-100 text-red-700' : analysis.traffic.risk_level === '中' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                          风险:{analysis.traffic.risk_level}
                        </span>
                      )}
                      {analysis.traffic?.speed_limit && <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">限速 {analysis.traffic.speed_limit}</span>}
                      {analysis.traffic?.closure_needed && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-semibold">需封闭施工</span>}
                    </div>
                    {analysis.traffic?.advice && <div className="text-xs text-slate-600 bg-amber-50 p-2 rounded-lg">📋 {analysis.traffic.advice}</div>}
                  </div>
                </div>

                {/* 5. 养护建议 */}
                {analysis.lane_care_tips && analysis.lane_care_tips.length > 0 && (
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="bg-gradient-to-r from-green-50 to-emerald-50 px-4 py-2.5 border-b border-slate-100">
                      <div className="font-bold text-slate-800 text-xs flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-[10px] font-black">5</span>
                        日常养护建议
                      </div>
                    </div>
                    <div className="p-4 space-y-2">
                      {analysis.lane_care_tips.map((tip: string, idx: number) => (
                        <div key={idx} className="flex items-start gap-2 text-xs text-slate-700">
                          <span className="text-green-500 mt-0.5">●</span>
                          {tip}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 复制报告按钮 */}
                <div className="pt-4 border-t border-slate-100">
                  <button
                    className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold text-sm hover:from-amber-600 hover:to-orange-600 transition-all flex items-center justify-center gap-2"
                    onClick={() => {
                      const analysisText = [
                        `【病害诊断报告】`,
                        `道路：${roadName || '未知'}`,
                        `病害类型：${analysis.damage_type || '未知'}`,
                        `严重等级：${analysis.severity || '未知'}`,
                        analysis.severity_score ? `严重度评分：${analysis.severity_score}/10` : '',
                        analysis.dimensions ? `\n【尺寸估算】\n${analysis.dimensions.estimated_length ? `长度：${analysis.dimensions.estimated_length}` : ''}${analysis.dimensions.estimated_width ? ` 宽度：${analysis.dimensions.estimated_width}` : ''}${analysis.dimensions.estimated_depth ? ` 深度：${analysis.dimensions.estimated_depth}` : ''}` : '',
                        analysis.cause_analysis ? `\n【成因分析】\n主因：${analysis.cause_analysis.primary_cause || ''}${analysis.cause_analysis.contributing_factors?.length ? `\n诱因：${analysis.cause_analysis.contributing_factors.join('、')}` : ''}` : '',
                        analysis.maintenance ? `\n【维修方案】\n紧迫性：${analysis.maintenance.urgency || ''}${analysis.maintenance.technique ? `\n工艺：${analysis.maintenance.technique}` : ''}${analysis.maintenance.actions?.length ? `\n步骤：\n${analysis.maintenance.actions.map((a: string, i: number) => `${i+1}. ${a}`).join('\n')}` : ''}` : '',
                        analysis.maintenance?.materials?.length ? `\n【材料清单】\n${analysis.maintenance.materials.map((m: any) => `- ${m.name}${m.spec ? `(${m.spec})` : ''}${m.unit_amount ? ` ${m.unit_amount}` : ''}`).join('\n')}` : '',
                        analysis.traffic ? `\n【通行管控】\n${analysis.traffic.impact || ''}${analysis.traffic.risk_level ? ` 风险等级：${analysis.traffic.risk_level}` : ''}${analysis.traffic.closure_needed ? ' 需封闭施工' : ''}` : '',
                        analysis.lane_care_tips?.length ? `\n【养护建议】\n${analysis.lane_care_tips.map((t: string) => `- ${t}`).join('\n')}` : '',
                      ].filter(Boolean).join('\n');

                      navigator.clipboard.writeText(analysisText).then(() => {
                        alert('分析报告已复制到剪贴板，可粘贴到维修报告中');
                      }).catch(() => {
                        const ta = document.createElement('textarea');
                        ta.value = analysisText;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        alert('分析报告已复制到剪贴板');
                      });
                    }}
                  >
                    📋 复制分析报告（发送给维修方）
                  </button>
                </div>
              </div>
            ) : !loading && (
              <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-4">
                <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-indigo-400" />
                </div>
                <div className="text-sm font-semibold text-slate-700">智能病害分析</div>
                <div className="text-xs text-slate-500 max-w-[240px]">点击上方"开始分析"按钮，AI 将自动识别病害类型、评估严重度，并给出维修材料清单、施工方案及养护建议。</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PhotoAnalysisModal;
