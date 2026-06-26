import React from 'react';
import { MapPin, X } from 'lucide-react';

interface StreetViewModalProps {
  location: { lat: number; lng: number };
  baiduAk: string;
  onClose: () => void;
}

/**
 * 百度街景预览弹窗
 * 当 baiduAk 缺失时显示提示，引导用户配置 VITE_BAIDU_AK
 */
const StreetViewModal: React.FC<StreetViewModalProps> = ({ location, baiduAk, onClose }) => {
  return (
    <div className="fixed inset-0 z-[5000] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-[960px] max-w-[96vw] h-[620px] max-h-[90vh] flex flex-col shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <MapPin className="w-5 h-5 text-indigo-500" />
            百度街景
          </h3>
          <button className="p-2 hover:bg-slate-100 rounded-full transition-colors" onClick={onClose}>
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="flex-1 bg-slate-50 flex items-center justify-center relative">
          {baiduAk ? (
            <iframe
              title="百度街景"
              className="w-full h-full"
              src={`https://api.map.baidu.com/panorama/v2?ak=${encodeURIComponent(baiduAk)}&width=1024&height=512&location=${location.lng},${location.lat}&fov=360`}
              allowFullScreen
            />
          ) : (
            <div className="text-center p-10">
              <div className="w-16 h-16 bg-indigo-100 text-indigo-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <MapPin className="w-8 h-8" />
              </div>
              <h4 className="text-lg font-bold text-slate-700 mb-2">街景服务未配置</h4>
              <p className="text-sm text-slate-500 mb-4">请在 .env.local 中设置 VITE_BAIDU_AK 后再试。</p>
              <p className="text-xs text-slate-400 max-w-xs mx-auto">当前坐标：{location.lat.toFixed(6)}, {location.lng.toFixed(6)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StreetViewModal;
