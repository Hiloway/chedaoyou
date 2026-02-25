import React, { useEffect, useState } from 'react';

interface Report {
  id: number;
  road_id: string;
  title: string;
  start_stake?: string;
  end_stake?: string;
  organization?: string;
  report_date?: string;
  created_at?: string;
  attachment_urls?: string[];
}

interface Props {
  roadId: string;
  onClose: () => void;
}

const ReportList: React.FC<Props> = ({ roadId, onClose }) => {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Report | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    const fetchReports = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/repair-reports?road_id=${encodeURIComponent(roadId)}`);
        if (res.ok) {
          const data = await res.json();
          // 统一解析 attachment_urls 字段（可能为 JSON 字符串）
          const normalized = (data || []).map((r: any) => ({
            ...r,
            attachment_urls: Array.isArray(r.attachment_urls) ? r.attachment_urls : (r.attachment_urls ? JSON.parse(r.attachment_urls) : []),
          }));
          setReports(normalized);
        }
      } catch (e) {
        console.error('fetch reports error', e);
      } finally {
        setLoading(false);
      }
    };
    fetchReports();
  }, [roadId]);

  return (
    <div className="fixed inset-0 bg-black/30 z-[4000] flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-[720px] shadow-2xl relative" onClick={e => e.stopPropagation()}>
        <button className="absolute top-3 right-3 p-1 text-slate-400 hover:text-slate-900" onClick={onClose}>关闭</button>
        <h3 className="text-lg font-bold mb-4">维修报告列表</h3>
        {loading ? (
          <div>加载中...</div>
        ) : (
          <div>
            {reports.length === 0 ? <div className="text-sm text-slate-500">暂无维修报告</div> : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-700 border-b">
                    <th className="py-2">标题</th>
                    <th>编制单位</th>
                    <th>报告日期</th>
                    <th>提交时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map(r => (
                    <tr key={r.id} className="border-b">
                      <td className="py-2">{r.title}</td>
                      <td>{r.organization}</td>
                      <td>{r.report_date}</td>
                      <td>{r.created_at}</td>
                      <td>
                        <button className="px-2 py-1 text-xs bg-slate-100 rounded" onClick={() => setSelected(r)}>查看</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {selected && (
          <div className="mt-4 bg-slate-50 border border-slate-100 p-4 rounded">
            <h4 className="font-bold mb-2">{selected.title}</h4>
            <div className="text-sm text-slate-700">编制单位：{selected.organization}</div>
            <div className="text-sm text-slate-700">报告日期：{selected.report_date}</div>
            <div className="text-sm text-slate-700 mt-2">提交时间：{selected.created_at}</div>
            <div className="mt-3 flex gap-3">
              <button className="px-3 py-2 bg-indigo-600 text-white rounded" onClick={() => window.alert('后续可实现 PDF 下载/打印功能')}>导出 PDF</button>
              <button className="px-3 py-2 bg-white border rounded" onClick={() => setSelected(null)}>关闭</button>
            </div>
            {selected.attachment_urls && selected.attachment_urls.length > 0 && (
              <div className="mt-3">
                <div className="text-sm font-medium mb-2">附件</div>
                <div className="flex gap-2 flex-wrap">
                  {selected.attachment_urls.map((p: string, idx: number) => (
                    <button key={idx} type="button" onClick={() => setSelectedImage(p)} className="rounded-md overflow-hidden border" title="点击查看大图">
                      <img src={p} alt={`rep-attach-${idx}`} className="w-28 h-20 object-cover rounded-md" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {selectedImage && (
        <div className="fixed inset-0 z-[4200] bg-black/70 flex items-center justify-center" onClick={() => setSelectedImage(null)}>
          <div className="max-w-[92vw] max-h-[92vh] p-2" onClick={e => e.stopPropagation()}>
            <button className="absolute top-4 right-4 z-[4300] bg-white rounded-full p-2 shadow" onClick={() => setSelectedImage(null)}>关闭</button>
            <img src={selectedImage as string} alt="preview" className="max-w-[92vw] max-h-[92vh] rounded-md" />
            <div className="text-center mt-3"><a className="text-sm text-indigo-400 hover:underline" href={selectedImage as string} target="_blank" rel="noreferrer">在新标签页打开</a></div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ReportList;
