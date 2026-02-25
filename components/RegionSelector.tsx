

import React, { useState, useRef, useEffect } from 'react';
import { MapPin, ChevronDown } from 'lucide-react';
import { CHINA_REGIONS } from '../constants';
import { Region } from '../types';

interface RegionSelectorProps {
  onRegionChange: (region: Region) => void;
  currentRegionName: string;
}


const RegionSelector: React.FC<RegionSelectorProps> = ({ onRegionChange, currentRegionName }) => {
  const [selectedProvince, setSelectedProvince] = useState<any>(null);
  const [selectedCity, setSelectedCity] = useState<any>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen]);

  // 递归渲染 children
  const renderChildren = (children: any[], level: number) => {
    if (!children) return null;
    return (
      <div className="pl-2">
        {children.map((item) => (
          <div key={item.name}>
            <button
              className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors flex items-center justify-between"
              onClick={() => {
                if (item.children && item.children.length > 0) {
                  if (level === 1) {
                    setSelectedCity(item);
                  }
                } else {
                  onRegionChange(item);
                  setMenuOpen(false);
                }
              }}
            >
              {item.name}
              {currentRegionName === item.name && <div className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></div>}
            </button>
            {/* 递归渲染下一级 */}
            {level === 1 && selectedCity && selectedCity.name === item.name && item.children && (
              <div className="pl-2 border-l border-gray-200">
                {renderChildren(item.children, 2)}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="relative" ref={menuRef}>
      <div
        className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 text-sm font-bold rounded-xl border border-gray-100 shadow-sm hover:bg-gray-50 transition-all cursor-pointer"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <MapPin className="w-4 h-4 text-red-500" />
        <span>{currentRegionName || '选择城市'}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
      </div>

      {/* 下拉菜单 */}
      {menuOpen && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/20 py-2 z-[2000] max-h-96 overflow-y-auto">
          <div className="px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">快速跳转</div>
          {/* 省级 */}
          {CHINA_REGIONS.map((province) => (
            <div key={province.name}>
              <button
                className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors flex items-center justify-between"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedProvince(province);
                  setSelectedCity(null);
                }}
              >
                {province.name}
                {selectedProvince && selectedProvince.name === province.name && <ChevronDown className="w-3 h-3 ml-2 inline" />}
              </button>
              {/* 市级 */}
              {selectedProvince && selectedProvince.name === province.name && province.children && (
                <div className="pl-2 border-l border-gray-200">
                  {province.children.map((city: any) => (
                    <div key={city.name}>
                      <button
                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors flex items-center justify-between"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCity(city);
                        }}
                      >
                        {city.name}
                        {selectedCity && selectedCity.name === city.name && <ChevronDown className="w-3 h-3 ml-2 inline" />}
                      </button>
                      {/* 区级 */}
                      {selectedCity && selectedCity.name === city.name && city.children && (
                        <div className="pl-2 border-l border-gray-200">
                          {city.children.map((area: any) => (
                            <button
                              key={area.name}
                              className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors flex items-center justify-between"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRegionChange(area);
                                setMenuOpen(false);
                              }}
                            >
                              {area.name}
                              {currentRegionName === area.name && <div className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></div>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RegionSelector;