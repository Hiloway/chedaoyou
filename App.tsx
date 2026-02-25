
import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import Sidebar from './components/Sidebar';
import LaneDetails from './components/LaneDetails';
import RegionSelector from './components/RegionSelector';
import { LaneInfo, Region } from './types';
import { fetchRealLanes, fetchRealLanesByBbox } from './services/laneService';
import { MAP_DEFAULT_PROPS } from './constants';
import { analyzeDamagePhoto } from './services/deepseekService';
import { Layers, Map as MapIcon, Loader2, Navigation, RefreshCw, AlertTriangle, Minimize2, Maximize2, MapPin, X } from 'lucide-react';

const App: React.FC = () => {
  const baiduAk = import.meta.env.VITE_BAIDU_AK || '';
  const [user, setUser] = useState<{role: string, username: string}>(() => {
    const saved = localStorage.getItem('lane_user');
    try { return saved ? JSON.parse(saved) : { role: 'guest', username: '游客' }; } catch (e) { return { role: 'guest', username: '游客' }; }
  });

  // 权限对象：只有管理员拥有全部权限
  const permissions = {
    canEdit: user.role === 'admin',
    canAI: user.role === 'admin',
    canChat: user.role === 'admin',
  };
  const isAdmin = user.role === 'admin';
  const [selectedLane, setSelectedLane] = useState<LaneInfo | null>(null);
  const [lanes, setLanes] = useState<LaneInfo[]>([]);
  const [map, setMap] = useState<L.Map | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentRegionName, setCurrentRegionName] = useState('全国');
  // 控制详情页展开/收起的状态
  const [showDetails, setShowDetails] = useState(false);

  // 框选工具与已选路段集合
  const [boxSelectMode, setBoxSelectMode] = useState(false);
  const [selectedLaneIds, setSelectedLaneIds] = useState<string[]>([]);
  const selectionRectRef = useRef<L.Rectangle | null>(null);
  const drawHandlersRef = useRef<{ onMouseMove?: any; onMouseUp?: any } | null>(null);
  // 用于跟踪临时从 bbox 拉取的路段（退出框选后需要移除）
  const tempLaneIdsRef = useRef<Set<string>>(new Set());
  const fetchControllerRef = useRef<AbortController | null>(null);
  // bbox 请求缓存（键为经纬度四元组，通过四舍五入减少重复）
  const bboxCacheRef = useRef<Map<string, any[]>>(new Map());
  // 加载状态，用于在 UI 上显示 spinner 并禁用操作
  const [selectedAreaLoading, setSelectedAreaLoading] = useState(false);

  // 已选区域分析结果（弹窗展示）
  const [selectedAreaAnalysis, setSelectedAreaAnalysis] = useState<any | null>(null);
  // Kernel 显示图层引用与可见状态
  const kernelLayerRef = useRef<L.LayerGroup | null>(null);
  const [kernelShown, setKernelShown] = useState(false);
  // 选区面板最小化状态（最小化后地图可见）
  const [selectedAreaMinimized, setSelectedAreaMinimized] = useState(false);
  // 百度街景位置状态
  const [streetViewLocation, setStreetViewLocation] = useState<{lat: number, lng: number} | null>(null);
  
  // 图片预览状态
  const [viewPhotoUrl, setViewPhotoUrl] = useState<string | null>(null);
  const [photoAnalysis, setPhotoAnalysis] = useState<any | null>(null);
  const [photoAnalysisLoading, setPhotoAnalysisLoading] = useState(false);
  const [photoAnalysisError, setPhotoAnalysisError] = useState<string | null>(null);
  
  // 从消息盒子跳转时自动填充的上报人信息
  const [pendingEditInfo, setPendingEditInfo] = useState<any | null>(null);

  // 监听百度街景事件和图片预览事件
  useEffect(() => {
    const handleOpenStreetView = (e: any) => {
      if (e.detail && e.detail.lat && e.detail.lng) {
        setStreetViewLocation({ lat: e.detail.lat, lng: e.detail.lng });
      }
    };
    const handleViewPhoto = (e: any) => {
      if (e.detail && e.detail.url) {
        setViewPhotoUrl(e.detail.url);
        setPhotoAnalysis(null);
        setPhotoAnalysisError(null);
        setPhotoAnalysisLoading(false);
      }
    };
    window.addEventListener('open-street-view', handleOpenStreetView);
    window.addEventListener('view-photo', handleViewPhoto);
    return () => {
      window.removeEventListener('open-street-view', handleOpenStreetView);
      window.removeEventListener('view-photo', handleViewPhoto);
    };
  }, []);

  // 管理员：监听删除上报点事件
  useEffect(() => {
    if (!isAdmin) return;
    const handleDeleteDamage = async (e: any) => {
      const detail = e?.detail;
      const id = detail?.id;
      const roadId = detail?.roadId;
      if (!id) return;
      try {
        const ok = window.confirm('确认删除该上报点？此操作不可恢复');
        if (!ok) return;
        const resp = await fetch(`/api/message/${id}`, { method: 'DELETE' });
        if (!resp.ok) {
          const txt = await resp.text();
          console.error('删除上报点失败', txt);
          alert('删除失败，请稍后重试');
          return;
        }
        // 从本地状态移除对应点
        setLanes(prev => prev.map(l => {
          if (roadId && l.id !== roadId) return l;
          const damagePoints = (l as any).damagePoints;
          if (!Array.isArray(damagePoints)) return l;
          const filtered = damagePoints.filter((dp: any) => String(dp.id) !== String(id));
          return { ...l, damagePoints: filtered } as any;
        }));
      } catch (err) {
        console.error('删除上报点异常', err);
        alert('删除失败，请检查网络后重试');
      }
    };
    window.addEventListener('delete-damage-point', handleDeleteDamage as EventListener);
    return () => window.removeEventListener('delete-damage-point', handleDeleteDamage as EventListener);
  }, [isAdmin]);

  // 浮动球（最小化）位置与拖拽 refs
  const [floatPos, setFloatPos] = useState<{top:number,left:number}>({top: 120, left: 120});
  const floatRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({x:0,y:0});
  const movedRef = useRef(false);

  // 地图上选择上报位置的模式与临时标记
  const [pickDamageMode, setPickDamageMode] = useState<{ roadId: string } | null>(null);
  const tempDamageMarkerRef = useRef<L.Marker | null>(null);
  const reportedDamageMarkersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    if (!selectedAreaMinimized) return;
    if (typeof window === 'undefined') return;
    setFloatPos(({top, left}) => {
      if (left === 120) {
        return { top: Math.max(80, window.innerHeight - 160), left: Math.max(60, window.innerWidth - 100) };
      }
      return {top,left};
    });
  }, [selectedAreaMinimized]);

  const mapRef = useRef<HTMLDivElement>(null);
  const polyLinesRef = useRef<L.Polyline[]>([]);
  const polylineMapRef = useRef<Map<string, L.Polyline>>(new Map());
  const damageMarkersRef = useRef<L.CircleMarker[]>([]);

  // 获取状态对应的颜色
  const getConditionColor = (condition: string, isSelected: boolean) => {
    if (isSelected) return '#4f46e5'; // 选中时统一显示为深蓝色高亮
    switch (condition) {
      case 'Excellent': return '#10b981'; // 绿色
      case 'Good': return '#22c55e'; // 浅绿色
      case 'Fair': return '#f59e0b'; // 黄色
      case 'Poor': return '#ef4444'; // 红色
      default: return '#64748b';
    }
  };

  // 把任意时间字符串或 Date 标准化为 YYYY-MM-DD（若无法解析则返回原始值或空串）
  const formatDateShort = (v?: string | Date | null) => {
    if (!v) return '';
    try {
      if (typeof v === 'string') {
        // 若像 '2026-01-10T12:34:56.000Z'，取前 10 位
        const iso = v.trim();
        if (iso.length >= 10 && iso[4] === '-') return iso.slice(0, 10);
        const d = new Date(iso);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        return iso;
      }
      if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
      return '';
    } catch (err) { return '';} 
  }; 

  useEffect(() => {
    if (!mapRef.current || map) return;
    const leafletMap = L.map(mapRef.current, {
      center: [MAP_DEFAULT_PROPS.center.lat, MAP_DEFAULT_PROPS.center.lng],
      zoom: 15,
      zoomControl: false 
    });
    L.tileLayer(
      'http://t0.tianditu.gov.cn/DataServer?T=vec_w&x={x}&y={y}&l={z}&tk=8c0f066c87196e801b0db5c201ff798c',
      {
        maxZoom: 18,
        attribution: '© 天地图'
      }
    ).addTo(leafletMap);
    L.control.zoom({ position: 'topright' }).addTo(leafletMap);
    setMap(leafletMap);
    return () => { leafletMap.remove(); };
  }, []);

  // 当框选模式被打开时，使用「鼠标按下→拖动→抬起」的方式绘制矩形并处理事件（更直观的拖拽框选）
  const boxSelectStartRef = useRef<L.LatLng | null>(null);
  useEffect(() => {
    if (!map) return;

    let isDrawing = false;

    const onMouseDown = (e: any) => {
      if (!boxSelectMode) return;
      // 只在左键点击时开始框选（右键用于拖动地图）
      if (e.originalEvent && e.originalEvent.button !== 0) return;
      isDrawing = true;
      // 仅禁用拖动和双击缩放，保留滚轮缩放
      try { 
        map.dragging.disable(); 
        map.doubleClickZoom.disable();
        // 保留滚轮缩放功能
        // map.scrollWheelZoom.disable();
        map.boxZoom.disable();
      } catch (err) {}
      const latlng = e.latlng;
      boxSelectStartRef.current = latlng;
      if (selectionRectRef.current) {
        try { selectionRectRef.current.remove(); } catch (err) {}
        selectionRectRef.current = null;
      }
      selectionRectRef.current = L.rectangle([latlng, latlng], { color: '#4f46e5', weight: 2, dashArray: '4 4' }).addTo(map);

      // 设置十字光标
      try { map.getContainer().style.cursor = 'crosshair'; } catch (err) {}
    };

    const onMouseMove = (e: any) => {
      if (!boxSelectMode || !isDrawing || !boxSelectStartRef.current) return;
      const bounds = L.latLngBounds(boxSelectStartRef.current, e.latlng);
      if (selectionRectRef.current) selectionRectRef.current.setBounds(bounds);
    };

    const finishSelection = async (endLatLng?: L.LatLng) => {
      const start = boxSelectStartRef.current;
      if (!start || !endLatLng) return;
      const bounds = L.latLngBounds(start, endLatLng);
      if (selectionRectRef.current) selectionRectRef.current.setBounds(bounds);

      // 选中框内的所有路段：如果路段任一坐标点落入 bounds 则视为被选中
      const ids = lanes.filter(l => Array.isArray(l.coordinates) && l.coordinates.some((c: any) => bounds.contains(L.latLng(c.lat, c.lng)))).map(l => l.id);
      setSelectedLaneIds(ids);

      // 如果有选中路段，标记第一个为当前选中（但不改变地图视图）
      if (ids.length > 0) {
        const first = lanes.find(l => l.id === ids[0]);
        if (first) setSelectedLane(first);
      }

      // 额外从 Overpass 按 bbox 拉取未加载的路段，标记为临时；仅在框选模式下可见，退出后移除
      try {
        setSelectedAreaLoading(true);
        if (fetchControllerRef.current) fetchControllerRef.current.abort();
        fetchControllerRef.current = new AbortController();
        const south = bounds.getSouth();
        const west = bounds.getWest();
        const north = bounds.getNorth();
        const east = bounds.getEast();
        // 使用简化的 bbox 键进行缓存（四舍五入到 4 位小数）
        const makeKey = (s: number, w: number, n: number, e: number) => `${s.toFixed(4)}:${w.toFixed(4)}:${n.toFixed(4)}:${e.toFixed(4)}`;
        const key = makeKey(south, west, north, east);
        let fetched: any[] | undefined = bboxCacheRef.current.get(key);
        if (!fetched) {
          fetched = await fetchRealLanesByBbox(south, west, north, east, fetchControllerRef.current.signal, 0.5);
          if (Array.isArray(fetched) && fetched.length > 0) {
            bboxCacheRef.current.set(key, fetched);
          }
        }

        if (Array.isArray(fetched) && fetched.length > 0) {
          const existingIds = new Set(lanes.map(l => l.id));
          const toAdd: any[] = [];
          fetched.forEach(f => {
            if (!existingIds.has(f.id)) {
              // 标记为临时路段
              (f as any)._temp = true;
              toAdd.push(f);
              tempLaneIdsRef.current.add(f.id);
            }
            // 确保被选中
            setSelectedLaneIds(prev => prev.includes(f.id) ? prev : [...prev, f.id]);
          });
          if (toAdd.length > 0) setLanes(prev => [...prev, ...toAdd]);
        }
      } catch (err) {
        if ((err as any)?.name !== 'AbortError') console.error('按 bbox 拉取路段失败：', err);
      } finally {
        setSelectedAreaLoading(false);
      }

      // 重置起点，保留矩形以便用户可查看/清除
      boxSelectStartRef.current = null;
    };

    const onMouseUp = (e: any) => {
      if (!boxSelectMode) return;
      if (isDrawing) {
        isDrawing = false;
        // 恢复地图交互
        try { 
          map.dragging.enable(); 
          map.doubleClickZoom.enable();
          map.boxZoom.enable();
        } catch (err) {}
        try { map.getContainer().style.cursor = ''; } catch (err) {}
        if (e && e.latlng) finishSelection(e.latlng).catch(err => console.error(err));
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDrawing) {
        isDrawing = false;
        boxSelectStartRef.current = null;
        try { if (selectionRectRef.current) { selectionRectRef.current.remove(); selectionRectRef.current = null; } } catch (err) {}
        try { 
          map.dragging.enable(); 
          map.doubleClickZoom.enable();
          map.boxZoom.enable();
          map.getContainer().style.cursor = ''; 
        } catch (err) {}
      }
    };

    if (boxSelectMode) {
      map.on('mousedown', onMouseDown);
      map.on('mousemove', onMouseMove);
      map.on('mouseup', onMouseUp);
      // 捕获 document 的 mouseup，以防用户在 map 外释放鼠标
      document.addEventListener('mouseup', onMouseUp as any);
      document.addEventListener('keydown', onKeyDown as any);
      try { map.getContainer().style.cursor = 'crosshair'; } catch (err) {}
    }

    // 选择上报位置：监听 map click（优先级低于框选）
    const onMapClickForPick = (e: any) => {
      if (!map) return;
      if (!pickDamageMode) return;
      const clicked = e.latlng;

      // 1) 清除上一次临时标记
      try { if (tempDamageMarkerRef.current) { tempDamageMarkerRef.current.remove(); tempDamageMarkerRef.current = null; } } catch(e) {}

      // 2) 如果有对应的 polyline，则把点击坐标“吸附”到最近的路段点上
      const line = polylineMapRef.current.get(pickDamageMode.roadId);
      let finalLatLng = clicked;
      if (line && map) {
        try {
          let ptsRaw: any = (line as any).getLatLngs ? (line as any).getLatLngs() : [];
          let pts: L.LatLng[] = [];
          // 兼容 nested latlngs（如 MultiPolyline）
          if (Array.isArray(ptsRaw) && ptsRaw.length > 0 && Array.isArray(ptsRaw[0])) pts = (ptsRaw as any).flat();
          else pts = ptsRaw as any;

          if (pts && pts.length > 0) {
            const clickPt = map.latLngToLayerPoint(clicked);
            let minDist = Infinity;
            let bestProj: L.Point | null = null;
            for (let i = 0; i < pts.length - 1; i++) {
              const a = map.latLngToLayerPoint(pts[i]);
              const b = map.latLngToLayerPoint(pts[i + 1]);
              const vx = b.x - a.x;
              const vy = b.y - a.y;
              const wx = clickPt.x - a.x;
              const wy = clickPt.y - a.y;
              const len2 = vx * vx + vy * vy;
              const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (vx * wx + vy * wy) / len2));
              const projX = a.x + t * vx;
              const projY = a.y + t * vy;
              const d2 = (projX - clickPt.x) * (projX - clickPt.x) + (projY - clickPt.y) * (projY - clickPt.y);
              if (d2 < minDist) { minDist = d2; bestProj = L.point(projX, projY); }
            }
            
            // 如果距离太远（例如大于 50 像素），则拒绝选择
            if (minDist > 2500) { // 50^2 = 2500
              alert('请在选定的路段上点击选择上报点');
              return;
            }
            
            if (bestProj) finalLatLng = map.layerPointToLatLng(bestProj);
          }
        } catch (err) { console.warn('吸附到路段失败，使用原始点击点', err); }
      }

      // 3) 创建临时标记并触发选择事件
      const marker = L.circleMarker([finalLatLng.lat, finalLatLng.lng], { radius: 7, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }).addTo(map);
      tempDamageMarkerRef.current = marker as any;
      window.dispatchEvent(new CustomEvent('damage-location-selected', { detail: { roadId: pickDamageMode.roadId, lat: finalLatLng.lat, lng: finalLatLng.lng } }));

      // 4) 退出 pick 模式并恢复光标
      setPickDamageMode(null);
      try { map.getContainer().style.cursor = ''; } catch(e) {}
    };

    map.on('click', onMapClickForPick);

    return () => {
      try { map.off('mousedown', onMouseDown); map.off('mousemove', onMouseMove); map.off('mouseup', onMouseUp); } catch (e) {}
      try { document.removeEventListener('mouseup', onMouseUp as any); } catch (err) {}
      try { document.removeEventListener('keydown', onKeyDown as any); } catch (err) {}
      try { map.dragging.enable(); map.getContainer().style.cursor = ''; } catch (err) {}
      try { map.off('click', onMapClickForPick); } catch (e) {}
    };
  }, [map, boxSelectMode, lanes]);

  const loadNearbyLanes = async (): Promise<LaneInfo[] | undefined> => {
    if (!map || isLoading) return;
    setIsLoading(true);
    setHasError(false);
    const center = map.getCenter();
    try {
      const realData = await fetchRealLanes(center.lat, center.lng, 1000);
      // 批量拉取 DB 中已有的记录并合并（优先保留 DB 的 condition 等字段）
      try {
        const idsArray = realData.map(r => r.id).filter(Boolean);
        if (idsArray.length > 0) {
          const [res, msgRes] = await Promise.all([
            fetch(`/api/road-conditions/batch`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: idsArray })
            }),
            fetch(`/api/messages/batch`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: idsArray })
            })
          ]);
          
          let dbRows = [];
          if (res.ok) {
            dbRows = await res.json();
          } else {
            console.error('Failed to fetch road conditions batch:', await res.text());
          }
          
          let msgRows = [];
          if (msgRes.ok) {
            msgRows = await msgRes.json();
            console.log('Fetched messages batch:', msgRows.length, 'records for', idsArray.length, 'lanes');
          } else {
            console.error('Failed to fetch messages batch:', await msgRes.text());
          }

          const dbMap: Record<string, any> = {};
          dbRows.forEach((r: any) => { dbMap[String(r.road_id)] = r; });
          
          const msgMap: Record<string, any[]> = {};
          msgRows.forEach((m: any) => {
            const rId = String(m.road_id);
            if (!msgMap[rId]) msgMap[rId] = [];
            msgMap[rId].push({
              id: String(m.id),
              lat: m.lat,
              lng: m.lng,
              value: 1, // Add default value for severity/visual size
              type: m.text || '用户上报',
              description: m.text,
              photos: m.photo_urls ? (typeof m.photo_urls === 'string' ? m.photo_urls.split(',') : (Array.isArray(m.photo_urls) ? m.photo_urls : [])) : []
            });
          });

          const matchId = (lId: string, rId: string) => {
            if (!lId || !rId) return false;
            if (lId === rId) return true;
            if (lId.endsWith(rId)) return true;
            if (rId.endsWith(lId)) return true;
            return false;
          };
          const merged = realData.map(r => {
            // 仅使用精确匹配（避免模糊匹配污染多条路段）；如需模糊匹配则需要更严格的规则与人工确认
            let rec = dbMap[String(r.id)];
            if (!rec) {
              // 记录可能的模糊候选以便排查，但不自动应用（如果确实需要，可以启用更严格的单一候选规则）
              const candidates = dbRows.filter((d: any) => matchId(r.id, d.road_id));
              if (candidates.length === 1 && candidates[0].road_id && String(candidates[0].road_id).length > 6) {
                // 如果只有一个且 id 不是非常短（避免 '1' 之类的模糊匹配），可以作为候选
                rec = candidates[0];
                console.log('Applying single fuzzy match for', r.id, '->', rec.road_id);
              } else if (candidates.length > 1) {
                console.warn('Multiple fuzzy matches for', r.id, candidates.map((c:any) => c.road_id));
              } else if (candidates.length === 1) {
                console.warn('Skipping short fuzzy match for', r.id, candidates[0].road_id);
              }
            }
            
            const damagePoints = msgMap[String(r.id)] || [];
            
            if (rec) {
              return { ...r, condition: rec.condition || r.condition, lastUpdated: r.lastUpdated || formatDateShort(rec.last_updated) || r.lastUpdated, damagePoints };
            }
            return { ...r, damagePoints };
          });
          setLanes(merged);
          return merged;
        }
      } catch (e) {
        console.error('批量合并 DB 记录失败，回退到纯 OSM 数据：', e);
      }
      setLanes(realData);
      return realData;
    } catch (err: any) {
      console.error('loadNearbyLanes error', err);
      setHasError(true);
      // 更友好的错误消息
      const msg = (err && err.message && err.message.includes('timeout')) ? 'OSM 服务超时或网络不稳定，请稍后重试' : '数据加载失败，请检查网络或稍后重试';
      setErrorMessage(msg);
      return undefined;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (map && lanes.length === 0) loadNearbyLanes();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  // 监听外部请求打开某个路段详情（例如 MessageBox 的“查看”按钮）
  useEffect(() => {
    const handler = async (e: any) => {
      const roadId = e?.detail?.roadId;
      if (!roadId) return;
      const matchId = (lId: string, rId: string) => {
        if (!lId || !rId) return false;
        if (lId === rId) return true;
        if (lId.endsWith(rId)) return true;
        if (rId.endsWith(lId)) return true;
        return false;
      };
      let found = lanes.find(l => matchId(l.id, roadId));
      if (!found) {
        // 尝试刷新附近路段再找一遍
        const loaded = await loadNearbyLanes();
        found = (loaded || []).find((l: any) => matchId(l.id, roadId));
      }
      if (found) {
        setSelectedLane(found);
        setShowDetails(true);
        if (map) map.flyTo([found.coordinates[0].lat, found.coordinates[0].lng], 16);
      } else {
        // 如果仍未找到，可尝试直接设置 selectedLane 的 id 并打开详情（部分信息可能缺失）
        setSelectedLane({ id: roadId, roadName: roadId, coordinates: [{ lat: map?.getCenter().lat || 0, lng: map?.getCenter().lng || 0 }], laneCount: 0 } as any);
        setShowDetails(true);
      }
    };
    window.addEventListener('open-lane', handler as EventListener);
    return () => window.removeEventListener('open-lane', handler as EventListener);
  }, [lanes, map]);

  // 监听从消息盒子跳转并自动打开编辑路况的事件
  useEffect(() => {
    const handler = async (e: any) => {
      const roadId = e?.detail?.roadId;
      const reporterInfo = e?.detail?.reporterInfo;
      if (!roadId) return;
      const matchId = (lId: string, rId: string) => {
        if (!lId || !rId) return false;
        if (lId === rId) return true;
        if (lId.endsWith(rId)) return true;
        if (rId.endsWith(lId)) return true;
        return false;
      };
      let found = lanes.find(l => matchId(l.id, roadId));
      if (!found) {
        const loaded = await loadNearbyLanes();
        found = (loaded || []).find((l: any) => matchId(l.id, roadId));
      }
      if (found) {
        setSelectedLane(found);
        setShowDetails(true);
        // 设置待填充的上报人信息，LaneDetails 会监听这个状态
        setPendingEditInfo(reporterInfo || null);
        if (map) map.flyTo([found.coordinates[0].lat, found.coordinates[0].lng], 16);
      } else {
        setSelectedLane({ id: roadId, roadName: roadId, coordinates: [{ lat: map?.getCenter().lat || 0, lng: map?.getCenter().lng || 0 }], laneCount: 0 } as any);
        setShowDetails(true);
        setPendingEditInfo(reporterInfo || null);
      }
    };
    window.addEventListener('open-lane-edit', handler as EventListener);
    return () => window.removeEventListener('open-lane-edit', handler as EventListener);
  }, [lanes, map]);


  useEffect(() => {
    if (!map) return;
    // 清理之前的线与标记
    polyLinesRef.current.forEach(p => p.remove());
    polyLinesRef.current = [];
    polylineMapRef.current.clear();
    damageMarkersRef.current.forEach(m => m.remove());
    damageMarkersRef.current = [];

    lanes.forEach(lane => {
      const isSelected = selectedLaneIds.includes(lane.id) || selectedLane?.id === lane.id;
      // 如果正在选取破损位置且当前路段是目标路段，则高亮并使用强调色
      const isPickTarget = pickDamageMode && pickDamageMode.roadId === lane.id;
      const color = isPickTarget ? '#ef4444' : getConditionColor(lane.condition, isSelected);
      const weight = isPickTarget ? 14 : (isSelected ? 12 : 6);

      const path = lane.coordinates.map(c => [c.lat, c.lng] as [number, number]);
      const polyline = L.polyline(path, {
        color: color,
        weight: weight,
        opacity: isSelected || isPickTarget ? 1 : 0.8,
        lineJoin: 'round',
        lineCap: 'round'
      }).addTo(map);

      polyline.on('click', (e) => {
        // 如果当前正处于为该路段选择破损点的模式，则把此次点击作为“选点”操作处理（直接吸附到路段并触发事件）
        if (pickDamageMode && pickDamageMode.roadId === lane.id) {
          const clicked = e.latlng;
          let finalLatLng = clicked;
          try {
            let ptsRaw: any = (polyline as any).getLatLngs ? (polyline as any).getLatLngs() : [];
            let pts: L.LatLng[] = [];
            if (Array.isArray(ptsRaw) && ptsRaw.length > 0 && Array.isArray(ptsRaw[0])) pts = (ptsRaw as any).flat();
            else pts = ptsRaw as any;
            if (pts && pts.length > 0 && map) {
              const clickPt = map.latLngToLayerPoint(clicked);
              let minDist = Infinity;
              let bestProj: L.Point | null = null;
              for (let i = 0; i < pts.length - 1; i++) {
                const a = map.latLngToLayerPoint(pts[i]);
                const b = map.latLngToLayerPoint(pts[i + 1]);
                const vx = b.x - a.x;
                const vy = b.y - a.y;
                const wx = clickPt.x - a.x;
                const wy = clickPt.y - a.y;
                const len2 = vx * vx + vy * vy;
                const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (vx * wx + vy * wy) / len2));
                const projX = a.x + t * vx;
                const projY = a.y + t * vy;
                const d2 = (projX - clickPt.x) * (projX - clickPt.x) + (projY - clickPt.y) * (projY - clickPt.y);
                if (d2 < minDist) { minDist = d2; bestProj = L.point(projX, projY); }
              }
              if (bestProj) finalLatLng = map.layerPointToLatLng(bestProj);
            }
          } catch (err) { console.warn('polyline 点击吸附失败', err); }

          try { if (tempDamageMarkerRef.current) { tempDamageMarkerRef.current.remove(); tempDamageMarkerRef.current = null; } } catch (e) {}
          try {
            const mk = L.circleMarker([finalLatLng.lat, finalLatLng.lng], { radius: 7, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }).addTo(map);
            tempDamageMarkerRef.current = mk as any;
          } catch (err) { console.warn('创建临时标记失败', err); }

          window.dispatchEvent(new CustomEvent('damage-location-selected', { detail: { roadId: lane.id, lat: finalLatLng.lat, lng: finalLatLng.lng } }));
          setPickDamageMode(null);
          try { map.getContainer().style.cursor = ''; } catch (err) {}
          return;
        }

        L.DomEvent.stopPropagation(e);
        // 若当前处于框选模式，则把该路段添加到已选集合（支持增量选择）
        if (boxSelectMode) {
          setSelectedLaneIds(prev => prev.includes(lane.id) ? prev : [...prev, lane.id]);
        } else {
          setSelectedLane(lane);
        }
      });
      polyLinesRef.current.push(polyline);
      // 记录路段 id -> polyline 的映射，便于选点时“吸附”到路段上
      try { polylineMapRef.current.set(lane.id, polyline); } catch (err) { console.warn('记录 polyline 映射失败', err); }

      // 渲染该路段上已存在的破损点
      if (Array.isArray((lane as any).damagePoints)) {
        for (const dp of (lane as any).damagePoints) {
          try {
            const mk = L.circleMarker([dp.lat, dp.lng], { radius: 6, color: '#b91c1c', fillColor: '#ef4444', fillOpacity: 0.9 }).addTo(map);
            
            // 创建 popup 内容
            const popupContent = document.createElement('div');
            popupContent.className = 'p-1 min-w-[150px]';
            
            let html = `<div class="font-bold text-sm mb-1">${dp.type || '破损点'}</div>`;
            if (dp.description) {
              html += `<div class="text-xs text-slate-600 mb-2">${dp.description}</div>`;
            }
            if (dp.photos && dp.photos.length > 0) {
              const url = dp.photos[0];
              const safeUrl = encodeURIComponent(url);
              html += `<div class="mb-2 cursor-pointer hover:opacity-90 transition-opacity" title="点击查看大图" onclick="window.dispatchEvent(new CustomEvent('view-photo', { detail: { url: decodeURIComponent('${safeUrl}') } }))"><img src="${url}" class="w-full h-20 object-cover rounded shadow-sm" /></div>`;
            }
            
            // 百度街景按钮
            html += `<button class="w-full py-1.5 bg-indigo-50 text-indigo-600 text-xs rounded border border-indigo-100 hover:bg-indigo-100 transition-colors" onclick="window.dispatchEvent(new CustomEvent('open-street-view', { detail: { lat: ${dp.lat}, lng: ${dp.lng} } }))">查看百度街景</button>`;
            
            popupContent.innerHTML = html;
            // 管理员：允许删除上报点
            if (isAdmin && dp.id) {
              const delBtn = document.createElement('button');
              delBtn.className = 'w-full mt-2 py-1.5 bg-red-50 text-red-600 text-xs rounded border border-red-100 hover:bg-red-100 transition-colors';
              delBtn.textContent = '删除上报点';
              delBtn.onclick = () => {
                window.dispatchEvent(new CustomEvent('delete-damage-point', { detail: { id: dp.id, roadId: lane.id } }));
              };
              popupContent.appendChild(delBtn);
            }
            mk.bindPopup(popupContent);
            damageMarkersRef.current.push(mk as any);
          } catch (err) {
            console.warn('渲染破损点失败：', err);
          }
        }
      }
    });
  }, [map, lanes, selectedLane, pickDamageMode, selectedLaneIds, isAdmin]);

  // 处理地图上选择破损位置的交互与事件
  useEffect(() => {
    if (!map) return;

    const onStart = (e: any) => {
      const roadId = e?.detail?.roadId;
      if (!roadId) return;
      setPickDamageMode({ roadId });
      try { map.getContainer().style.cursor = 'crosshair'; } catch (err) {}
    };

    const onCancel = () => {
      setPickDamageMode(null);
      try { if (tempDamageMarkerRef.current) { tempDamageMarkerRef.current.remove(); tempDamageMarkerRef.current = null; } } catch (err) {}
      try { map.getContainer().style.cursor = ''; } catch (err) {}
    };

    const onDamageReported = (ev: any) => {
      const d = ev?.detail;
      if (!d || d.lat == null || d.lng == null || !d.roadId) return;

      // 首先清理选点时的临时标记（如果有）
      try { if (tempDamageMarkerRef.current) { tempDamageMarkerRef.current.remove(); tempDamageMarkerRef.current = null; } } catch (e) {}

      try {
        const mk = L.circleMarker([d.lat, d.lng], { radius: 7, color: '#dc2626', fillColor: '#dc2626', fillOpacity: 1 }).addTo(map);
        
        const popupContent = document.createElement('div');
        popupContent.className = 'p-1 min-w-[150px]';
        let html = `<div class="font-bold text-sm mb-1">破损上报</div>`;
        if (d.description) {
          html += `<div class="text-xs text-slate-600 mb-2">${d.description}</div>`;
        }
        if (d.photos && d.photos.length > 0) {
          const url = d.photos[0];
          const safeUrl = encodeURIComponent(url);
          html += `<div class="mb-2 cursor-pointer hover:opacity-90 transition-opacity" title="点击查看大图" onclick="window.dispatchEvent(new CustomEvent('view-photo', { detail: { url: decodeURIComponent('${safeUrl}') } }))"><img src="${url}" class="w-full h-20 object-cover rounded shadow-sm" /></div>`;
        }
        html += `<button class="w-full py-1.5 bg-indigo-50 text-indigo-600 text-xs rounded border border-indigo-100 hover:bg-indigo-100 transition-colors" onclick="window.dispatchEvent(new CustomEvent('open-street-view', { detail: { lat: ${d.lat}, lng: ${d.lng} } }))">查看百度街景</button>`;
        
        popupContent.innerHTML = html;
        mk.bindPopup(popupContent);
        reportedDamageMarkersRef.current.push(mk as any);
      } catch (err) { console.error('添加上报标记失败：', err); }

      setLanes(prev => prev.map(l => {
        if (l.id === d.roadId) {
          const dpId = d.id || `${l.id}-report-${Date.now()}`;
          const dp = { id: dpId, lat: d.lat, lng: d.lng, value: d.severity || 1, type: '破损上报', description: d.description, photos: d.photos || [] } as any;
          return { ...l, damagePoints: Array.isArray((l as any).damagePoints) ? [...(l as any).damagePoints, dp] : [dp] } as any;
        }
        return l;
      }));
    };

    window.addEventListener('start-pick-damage-location', onStart as EventListener);
    window.addEventListener('cancel-pick-damage-location', onCancel as EventListener);
    window.addEventListener('damage-reported', onDamageReported as EventListener);

    return () => {
      window.removeEventListener('start-pick-damage-location', onStart as EventListener);
      window.removeEventListener('cancel-pick-damage-location', onCancel as EventListener);
      window.removeEventListener('damage-reported', onDamageReported as EventListener);
    };
  }, [map]);

  const handleSelectLane = (lane: LaneInfo) => {
    setSelectedLane(lane);
    if (map) map.flyTo([lane.coordinates[0].lat, lane.coordinates[0].lng], 16);
  };

  const handleLocateMe = () => {
    if (map) {
      map.locate({ setView: true, maxZoom: 15 });
      setCurrentRegionName('当前位置');
    }
  };

  const handleRegionChange = (region: Region) => {
    if (map) {
      setCurrentRegionName(region.name);
      map.flyTo([region.lat, region.lng], region.zoom, { animate: true, duration: 2 });
      setTimeout(() => loadNearbyLanes(), 2100); 
    }
  };

  useEffect(() => {
    // 清理：当弹窗关闭时移除地图热力图层
    if (!selectedAreaAnalysis && kernelLayerRef.current) {
      try { kernelLayerRef.current.remove(); } catch(e) {}
      kernelLayerRef.current = null;
      setKernelShown(false);
    }
  }, [selectedAreaAnalysis]);

  // 当选中路段变化时自动展开详情
  useEffect(() => { if (selectedLane) setShowDetails(true); }, [selectedLane]);

  // 当选中路段变化时自动展开详情
  useEffect(() => { if (selectedLane) setShowDetails(true); }, [selectedLane]);

  return (
    <div className="flex h-screen w-full bg-slate-100 overflow-hidden font-sans">
      <Sidebar 
        lanes={lanes}
        onSelectLane={handleSelectLane} 
        selectedLaneId={selectedLane?.id || null} 
        user={user}
        setUser={setUser}
        permissions={permissions}
      />
      <main className="flex-1 relative">
        <div ref={mapRef} className="w-full h-full z-10" />
        {pickDamageMode && (
          <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-[1101] pointer-events-none">
            <div className="bg-indigo-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">请在被选中的道路上点击选择破损位置；按 Esc 取消</div>
          </div>
        )}
        <div className="absolute top-6 left-6 flex items-center gap-3 z-[1000] pointer-events-auto">
          <div className="bg-white/95 backdrop-blur-sm p-2 rounded-2xl shadow-2xl border border-gray-200 flex gap-2">
            <RegionSelector currentRegionName={currentRegionName} onRegionChange={handleRegionChange} />

            <button 
              onClick={loadNearbyLanes}
              disabled={isLoading}
              className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-800 transition-all disabled:opacity-50 shadow-lg shadow-slate-900/20"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {isLoading ? '检索中' : '刷新数据'}
            </button>
            <button onClick={handleLocateMe} className="p-2.5 bg-white text-slate-700 rounded-xl border border-gray-200 hover:bg-gray-50 transition-all shadow-sm">
              <Navigation className="w-5 h-5" />
            </button>

            {/* 框选与选中区域分析按钮 */}
            <div className="flex items-center gap-2">
              <button
                className={`px-3 py-2 rounded-xl font-bold text-sm ${boxSelectMode ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700'} border border-gray-200 hover:scale-[1.02] transition-all`}
                onClick={() => {
                  if (boxSelectMode) {
                    // 退出框选：取消未完成请求，移除临时拉取的路段与矩形，清空选择
                    try { if (fetchControllerRef.current) { fetchControllerRef.current.abort(); fetchControllerRef.current = null; } } catch(e){}
                    try { if (selectionRectRef.current) { selectionRectRef.current.remove(); selectionRectRef.current = null; } } catch(e){}
                    if (tempLaneIdsRef.current.size > 0) {
                      setLanes(prev => prev.filter(l => !(l as any)._temp));
                      tempLaneIdsRef.current.clear();
                    }
                    setSelectedLaneIds([]);
                    setSelectedAreaAnalysis(null);
                  }
                  setBoxSelectMode(s => !s);
                }}
                title={boxSelectMode ? '退出框选模式' : '进入框选模式：按住鼠标拖拽选择区域'}
              >
                {boxSelectMode ? '退出框选' : '框选'}
              </button>

              <button
                className={`px-3 py-2 rounded-xl font-bold text-sm bg-white text-slate-700 border border-gray-200 hover:scale-[1.02] transition-all ${selectedLaneIds.length === 0 || selectedAreaLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                onClick={() => {
                  if (selectedLaneIds.length === 0 || selectedAreaLoading) return;
                  // 触发选中区域分析（重写：按路况权重 + 上报破损点，确保每条路都参与）
                  const selectedLanes = lanes.filter(l => selectedLaneIds.includes(l.id));
                  const conditionWeight = (cond?: string) => {
                    if (cond === 'Poor') return 1.8;
                    if (cond === 'Fair') return 1.4;
                    if (cond === 'Good') return 1.0;
                    if (cond === 'Excellent') return 0.8;
                    return 1.0;
                  };
                  const makePseudoPoints = (coords: any[], laneId: string, weight: number) => {
                    if (!Array.isArray(coords) || coords.length === 0) return [] as any[];
                    if (coords.length === 1) return [{ id: `${laneId}-pseudo-0`, roadId: laneId, lat: coords[0].lat, lng: coords[0].lng, value: 0.8 * weight, source: 'pseudo' }];
                    const idxs = coords.length >= 3 ? [0, Math.floor(coords.length / 2), coords.length - 1] : [0, coords.length - 1];
                    return idxs.map((idx, i) => ({ id: `${laneId}-pseudo-${i}`, roadId: laneId, lat: coords[idx].lat, lng: coords[idx].lng, value: 0.8 * weight, source: 'pseudo' }));
                  };

                  const points = selectedLanes.flatMap(l => {
                    const w = conditionWeight((l as any).condition as string | undefined);
                    // 只使用真实的上报点数据，不生成伪点
                    const damagePoints = Array.isArray((l as any).damagePoints)
                      ? (l as any).damagePoints.map((p: any, idx: number) => ({
                          id: `${l.id}-d-${p.id ?? idx}`,
                          roadId: l.id,
                          lat: p.lat,
                          lng: p.lng,
                          value: (typeof p.value === 'number' ? p.value : 1.5) * w,
                          source: 'damage',
                          severity: p.severity,
                          damageType: p.damage_type || p.damageType
                        }))
                      : [];
                    return damagePoints;
                  });

                  // 收集道路基础信息用于分析
                  const roadStats = selectedLanes.map(l => ({
                    id: l.id,
                    name: l.roadName,
                    condition: l.condition || '未知',
                    coordCount: Array.isArray(l.coordinates) ? l.coordinates.length : 0,
                    damageCount: Array.isArray((l as any).damagePoints) ? (l as any).damagePoints.length : 0
                  }));
                  const totalDamagePoints = points.length;
                  const poorRoads = roadStats.filter(r => r.condition === 'Poor').length;
                  const fairRoads = roadStats.filter(r => r.condition === 'Fair').length;
                  
                  if (points.length === 0 && roadStats.every(r => r.damageCount === 0)) {
                    // 没有上报点，但仍可显示道路状况统计
                    setSelectedAreaAnalysis({ 
                      noData: true,
                      roadStats,
                      summary: `选中 ${selectedLanes.length} 条道路，暂无上报的破损点数据。\n其中：${poorRoads} 条较差、${fairRoads} 条一般状态。`,
                      suggestions: poorRoads > 0 ? ['建议对较差状态道路进行现场巡查'] : ['当前区域道路状况良好']
                    });
                    return;
                  }
                  // 显示加载指示，尤其在 bbox 仍在补全时
                  setSelectedAreaAnalysis(null);
                  setSelectedAreaAnalysis({ info: '正在运行分析（会在数据补全后更新）' });
                  import('./services/spatialAnalysis').then(mod => {
                    // 自适应带宽/分辨率：依据选区对角线自动选取
                    const lats = points.map(p => p.lat);
                    const lngs = points.map(p => p.lng);
                    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
                    const meanLat = (minLat + maxLat) / 2;
                    const metersPerDegLat = 111320;
                    const metersPerDegLng = 111320 * Math.cos(meanLat * Math.PI / 180);
                    const dx = (maxLng - minLng) * metersPerDegLng;
                    const dy = (maxLat - minLat) * metersPerDegLat;
                    const diag = Math.sqrt(dx * dx + dy * dy);
                    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
                    let bandwidth = clamp(diag / 4 || 0, 80, 600);
                    let cellSize = clamp(bandwidth / 3, 25, 200);

                    let dLat = cellSize / metersPerDegLat;
                    let dLng = cellSize / metersPerDegLng;
                    let rows = Math.max(1, Math.ceil((maxLat - minLat) / dLat));
                    let cols = Math.max(1, Math.ceil((maxLng - minLng) / dLng));
                    let cells = Math.max(1, rows * cols);
                    let ops = cells * points.length;
                    const MAX_OPS = 5e6;

                    while (ops > MAX_OPS && cellSize < 400) {
                      cellSize *= 1.4;
                      bandwidth = clamp(bandwidth * 1.2, 80, 800);
                      dLat = cellSize / metersPerDegLat;
                      dLng = cellSize / metersPerDegLng;
                      rows = Math.max(1, Math.ceil((maxLat - minLat) / dLat));
                      cols = Math.max(1, Math.ceil((maxLng - minLng) / dLng));
                      cells = Math.max(1, rows * cols);
                      ops = cells * points.length;
                    }

                    let usedPoints = points;
                    if (ops > MAX_OPS) {
                      const maxPoints = Math.max(200, Math.floor(MAX_OPS / cells));
                      if (maxPoints < points.length) {
                        const sampled: typeof points = [];
                        const factor = points.length / maxPoints;
                        for (let i = 0; i < maxPoints; i++) sampled.push(points[Math.floor(i * factor)]);
                        usedPoints = sampled;
                      }
                    }

                    // 异步化计算，避免阻塞渲染；并在出错时友好回退
                    setSelectedAreaLoading(true);
                    setTimeout(() => {
                      try {
                        const hs = mod.computeGetisOrdGi(usedPoints, { bandwidthMeters: bandwidth });
                        const report = mod.interpretHotspots(hs);
                        const kd = mod.computeKernelDensity(usedPoints, { bandwidthMeters: bandwidth, cellSizeMeters: cellSize, normalize: true, bbox: [minLng, minLat, maxLng, maxLat] });
                        // 聚合到路段级热点（只统计路段上的点，不用整个矩形）
                        const roadHotspots = mod.aggregateHotspotsByRoad(hs);
                        // 若已有热力图层，先移除以免叠加旧图层
                        try { if (kernelLayerRef.current) { kernelLayerRef.current.remove(); kernelLayerRef.current = null; setKernelShown(false); } } catch(e) {}
                        setSelectedAreaAnalysis({ hotspots: hs, kernel: kd, report, roadHotspots, _note: ops > MAX_OPS ? '已对数据或分辨率进行自动降级以保证性能' : undefined, _params: { bandwidth, cellSize } });
                      } catch (err) {
                        console.error('选区分析计算失败：', err);
                        setSelectedAreaAnalysis({ error: '分析失败（内部计算出错）' });
                      } finally {
                        setSelectedAreaLoading(false);
                      }
                    }, 50);

                  }).catch(err => {
                    console.error('动态导入 spatialAnalysis 失败：', err);
                    setSelectedAreaAnalysis({ error: '分析失败（模块加载失败）' });
                  });
                }}
              >{selectedAreaLoading ? '加载路段中...' : '分析选中区域'}</button>

              <button
                className="px-2 py-2 rounded-xl font-bold text-sm bg-white text-slate-500 border border-gray-200 hover:bg-gray-50 transition-all"
                onClick={() => {
                  // 清除选择和矩形，并清除当前选中路段与可能的选区分析结果
                  try { if (fetchControllerRef.current) { fetchControllerRef.current.abort(); fetchControllerRef.current = null; } } catch(e){}
                  setSelectedLaneIds([]);
                  setSelectedLane(null);
                  setSelectedAreaAnalysis(null);
                  // 移除可能存在的热力图层
                  try { if (kernelLayerRef.current) { kernelLayerRef.current.remove(); kernelLayerRef.current = null; setKernelShown(false); } } catch(e){}
                  if (tempLaneIdsRef.current.size > 0) {
                    setLanes(prev => prev.filter(l => !(l as any)._temp));
                    tempLaneIdsRef.current.clear();
                  }
                  try { if (selectionRectRef.current) { selectionRectRef.current.remove(); selectionRectRef.current = null; } } catch(e){}
                }}
                title="清除已选区域"
              >清除选择</button>

              <div className="text-xs text-slate-500 px-3">已选：{selectedLaneIds.length}</div>
            </div>
          </div>
        </div>
        {hasError && (
          <div className="absolute top-24 left-6 z-[1000] bg-red-50 border border-red-200 p-3 rounded-xl shadow-lg flex items-center gap-2 text-red-700 text-xs font-bold animate-bounce">
            <AlertTriangle className="w-4 h-4" /> {errorMessage || '数据服务繁忙，请稍后重试。'}
          </div>
        )}
        {/* 右侧可收缩详情按钮 */}
        <div className="fixed" style={{top: '12%', right: 0, zIndex: 1001, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', pointerEvents: 'none', transform: 'translateY(-50%)'}}>
          {selectedLane && (
            <div className="pointer-events-auto flex flex-col items-end">
              <button
                className={`bg-indigo-600 text-white rounded-l-2xl shadow-lg px-4 py-3 font-bold text-sm mb-2 transition-all hover:bg-indigo-700 ${showDetails ? '' : 'animate-bounce'}`}
                onClick={() => setShowDetails(s => !s)}
                style={{minWidth: '40px'}}
              >
                {showDetails ? '收起详情' : '查看详情'}
              </button>
              {showDetails && (
                <div className="fixed right-0 z-[2000]" style={{top: '5%', height: '90vh'}}>
                  <div className="h-full overflow-hidden shadow-2xl rounded-l-2xl bg-transparent">
                    <div className="w-[380px] sm:w-[440px] md:w-[480px] h-full">
                      <LaneDetails
                        lane={selectedLane}
                        onClose={() => setShowDetails(false)}
                        user={user}
                        permissions={permissions}
                        pendingEditInfo={pendingEditInfo}
                        onEditInfoConsumed={() => setPendingEditInfo(null)}
                        onSaved={async (record?: any) => {
                          // 如果后端返回了 record，就用它更新前端状态，避免额外请求
                          if (record) {
                            console.log('onSaved record:', record, 'selectedLane before:', selectedLane?.id);
                            const matchId = (lId: string, rId: string) => {
                              if (!lId || !rId) return false;
                              if (lId === rId) return true;
                              if (lId.endsWith(rId)) return true;
                              if (rId.endsWith(lId)) return true;
                              return false;
                            };

                            // 优先尝试精确匹配（只更新一条路段）
                            let updatedOne = false;
                            setLanes(prev => {
                              const exactIdx = prev.findIndex(l => l.id === record.road_id);
                              if (exactIdx !== -1) {
                                updatedOne = true;
                                return prev.map((l, i) => i === exactIdx ? ({
                                  ...l,
                                  condition: record.condition || l.condition,
                                  lastUpdated: formatDateShort(record.last_updated) || l.lastUpdated,
                                  roadName: record.road_name || l.roadName,
                                } as any) : l);
                              }

                              // 若无精确匹配，尝试一次模糊匹配（仅更新第一个匹配项）
                              const fuzzyIdx = prev.findIndex(l => matchId(l.id, record.road_id));
                              if (fuzzyIdx !== -1) {
                                updatedOne = true;
                                return prev.map((l, i) => i === fuzzyIdx ? ({
                                  ...l,
                                  condition: record.condition || l.condition,
                                  lastUpdated: formatDateShort(record.last_updated) || l.lastUpdated,
                                  roadName: record.road_name || l.roadName,
                                } as any) : l);
                              }

                              return prev;
                            });

                            // 更新 selectedLane（只更新对应那条）
                            setSelectedLane(prev => {
                              if (!prev) return prev;
                              if (prev.id === record.road_id) {
                                return {
                                  ...prev,
                                  condition: record.condition || prev.condition,
                                  lastUpdated: formatDateShort(record.last_updated) || prev.lastUpdated,
                                  roadName: record.road_name || prev.roadName,
                                };
                              }
                              // 如果我们通过模糊匹配更新了某条但它不是当前打开的详情，则尝试把它设为 selectedLane（保持与列表同步）
                              if (!prev || !updatedOne) return prev;
                              const found = lanes.find(l => matchId(l.id, record.road_id));
                              if (found) return found;
                              return prev;
                            });

                            return;
                          }
                          // 否则回退到原来的策略：尝试从后端读取该记录，若失败则刷新地图数据
                          if (!selectedLane) return;
                          try {
                            const res = await fetch(`/api/road-condition/${selectedLane.id}`);
                            if (res.status === 404) {
                              // 无记录则跳过，不再报错刷屏
                              return;
                            }
                            if (res.ok) {
                              const dbRec = await res.json();
                              setSelectedLane(prev => prev && prev.id === dbRec.road_id ? { ...prev, condition: dbRec.condition || prev.condition, lastUpdated: dbRec.last_updated || prev.lastUpdated } : prev);
                              setLanes(prev => prev.map(l => l.id === dbRec.road_id ? { ...l, condition: dbRec.condition || l.condition, lastUpdated: dbRec.last_updated || l.lastUpdated } : l));
                            } else {
                              await loadNearbyLanes();
                            }
                          } catch (err) {
                            console.error('同步后端记录失败：', err);
                            await loadNearbyLanes();
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 选中区域分析弹窗 - 优化尺寸 */}
        {selectedAreaAnalysis && !selectedAreaMinimized && (
          <div className="fixed inset-0 z-[3000] bg-black/40 backdrop-blur-sm flex items-center justify-center" onClick={() => setSelectedAreaAnalysis(null)}>
            <div className="bg-white rounded-2xl p-6 w-[580px] max-w-[90vw] max-h-[85vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()} style={{ pointerEvents: 'auto' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">选中区域分析</h3>
                <div className="flex items-center gap-2">
                  <button className="text-sm text-slate-500" onClick={() => setSelectedAreaMinimized(s => !s)} title={selectedAreaMinimized ? '还原面板' : '最小化面板'}>
                    {selectedAreaMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
                  </button>
                  <button className="text-sm text-slate-500" onClick={() => { setSelectedAreaAnalysis(null); setSelectedAreaMinimized(false); try { if (kernelLayerRef.current) { kernelLayerRef.current.remove(); kernelLayerRef.current = null; setKernelShown(false); } } catch(e) {} }}>关闭</button>
                </div>
              </div>

              {selectedAreaAnalysis.error ? (
                <div className="text-sm text-red-600">{selectedAreaAnalysis.error}</div>
              ) : selectedAreaAnalysis.noData ? (
                // 无上报点数据时显示道路统计
                <div className="space-y-4">
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-5 h-5 text-amber-500" />
                      <span className="font-semibold text-amber-700">暂无上报数据</span>
                    </div>
                    <div className="text-sm text-amber-800 whitespace-pre-line">{selectedAreaAnalysis.summary}</div>
                  </div>
                  {selectedAreaAnalysis.roadStats && selectedAreaAnalysis.roadStats.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">道路状况统计</div>
                      <div className="grid grid-cols-4 gap-3">
                        <div className="bg-red-50 rounded-lg p-3 text-center">
                          <div className="text-xl font-bold text-red-600">{selectedAreaAnalysis.roadStats.filter((r: any) => r.condition === 'Poor').length}</div>
                          <div className="text-xs text-red-500">较差</div>
                        </div>
                        <div className="bg-amber-50 rounded-lg p-3 text-center">
                          <div className="text-xl font-bold text-amber-600">{selectedAreaAnalysis.roadStats.filter((r: any) => r.condition === 'Fair').length}</div>
                          <div className="text-xs text-amber-500">一般</div>
                        </div>
                        <div className="bg-green-50 rounded-lg p-3 text-center">
                          <div className="text-xl font-bold text-green-600">{selectedAreaAnalysis.roadStats.filter((r: any) => r.condition === 'Good').length}</div>
                          <div className="text-xs text-green-500">良好</div>
                        </div>
                        <div className="bg-slate-100 rounded-lg p-3 text-center">
                          <div className="text-xl font-bold text-slate-600">{selectedAreaAnalysis.roadStats.filter((r: any) => !r.condition || r.condition === '未知').length}</div>
                          <div className="text-xs text-slate-500">未知</div>
                        </div>
                      </div>
                    </div>
                  )}
                  {selectedAreaAnalysis.suggestions && (
                    <div className="text-sm text-slate-600">
                      <div className="font-semibold mb-1">建议：</div>
                      <ul className="list-disc ml-5">
                        {selectedAreaAnalysis.suggestions.map((s: string, i: number) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (!selectedAreaAnalysis.hotspots || !selectedAreaAnalysis.kernel) ? (
                <div className="py-6 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                    <div className="text-sm text-slate-600">{selectedAreaAnalysis.info || '正在运行分析，请稍候...'}</div>
                    {selectedAreaAnalysis._note && <div className="text-xs text-slate-400 mt-2">{selectedAreaAnalysis._note}</div>}
                  </div>
                </div>
              ) : (
                <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                  {/* 区域健康度总览 */}
                  {selectedAreaAnalysis.report && (
                    <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-4 border border-slate-200">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg ${
                            selectedAreaAnalysis.report.areaHealthLevel === '优良' ? 'bg-emerald-500' :
                            selectedAreaAnalysis.report.areaHealthLevel === '良好' ? 'bg-green-500' :
                            selectedAreaAnalysis.report.areaHealthLevel === '一般' ? 'bg-yellow-500' :
                            selectedAreaAnalysis.report.areaHealthLevel === '较差' ? 'bg-orange-500' : 'bg-red-500'
                          }`}>
                            {selectedAreaAnalysis.report.areaHealthScore || '--'}
                          </div>
                          <div>
                            <div className="text-lg font-bold text-slate-800">区域健康等级：{selectedAreaAnalysis.report.areaHealthLevel || '分析中'}</div>
                            <div className="text-xs text-slate-500">选中 {selectedLaneIds.length} 条路段 · {(selectedAreaAnalysis.hotspots||[]).length} 个上报点</div>
                          </div>
                        </div>
                      </div>
                      {selectedAreaAnalysis.report.summaryText && (
                        <div className="text-sm text-slate-600 leading-relaxed">{selectedAreaAnalysis.report.summaryText}</div>
                      )}
                    </div>
                  )}

                  {/* 点线面三维度分析 - 简化版：只保留区域和道路分析 */}
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="flex border-b border-slate-200">
                      {[
                        { key: 'area', icon: '□', label: '区域总览' },
                        { key: 'line', icon: '─', label: '道路分析' },
                      ].map(tab => (
                        <button
                          key={tab.key}
                          className={`flex-1 px-4 py-3 text-sm font-medium transition ${
                            (selectedAreaAnalysis._activeTab || 'area') === tab.key
                              ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-500'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                          onClick={() => setSelectedAreaAnalysis((prev: any) => ({ ...prev, _activeTab: tab.key }))}
                        >
                          <span className="mr-2">{tab.icon}</span>{tab.label}
                        </button>
                      ))}
                    </div>

                    <div className="p-4">
                      {/* 区域分析 */}
                      {(selectedAreaAnalysis._activeTab || 'area') === 'area' && selectedAreaAnalysis.report?.insights?.area && (
                        <div className="space-y-3">
                          <div className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-2">区域整体评估</div>
                          {selectedAreaAnalysis.report.insights.area.map((text: string, i: number) => (
                            <div key={i} className="flex gap-3 items-start">
                              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2 flex-shrink-0" />
                              <div className="text-sm text-slate-700 leading-relaxed">{text}</div>
                            </div>
                          ))}
                          {selectedAreaAnalysis.report.maintenanceSuggestions?.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-slate-100">
                              <div className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-2">养护行动建议</div>
                              {selectedAreaAnalysis.report.maintenanceSuggestions.map((text: string, i: number) => (
                                <div key={i} className="flex gap-3 items-start mb-2">
                                  <div className="w-5 h-5 rounded bg-amber-100 text-amber-600 flex items-center justify-center text-xs font-bold flex-shrink-0">{i + 1}</div>
                                  <div className="text-sm text-slate-700">{text}</div>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* 破损严重程度统计 */}
                          <div className="mt-4 pt-4 border-t border-slate-100">
                            <div className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">破损严重程度分布</div>
                            <div className="grid grid-cols-4 gap-3">
                              <div className="bg-red-50 rounded-lg p-3 text-center">
                                <div className="text-xl font-bold text-red-600">{lanes.filter(l => selectedLaneIds.includes(l.id) && l.condition === 'Poor').length}</div>
                                <div className="text-xs text-red-500">较差</div>
                              </div>
                              <div className="bg-amber-50 rounded-lg p-3 text-center">
                                <div className="text-xl font-bold text-amber-600">{lanes.filter(l => selectedLaneIds.includes(l.id) && l.condition === 'Fair').length}</div>
                                <div className="text-xs text-amber-500">一般</div>
                              </div>
                              <div className="bg-green-50 rounded-lg p-3 text-center">
                                <div className="text-xl font-bold text-green-600">{lanes.filter(l => selectedLaneIds.includes(l.id) && (l.condition === 'Good' || l.condition === 'Excellent')).length}</div>
                                <div className="text-xs text-green-500">良好</div>
                              </div>
                              <div className="bg-slate-100 rounded-lg p-3 text-center">
                                <div className="text-xl font-bold text-slate-600">{lanes.filter(l => selectedLaneIds.includes(l.id) && (!l.condition || l.condition === '未知')).length}</div>
                                <div className="text-xs text-slate-500">未知</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 道路分析 - 基于破损严重程度排名 */}
                      {(selectedAreaAnalysis._activeTab || 'area') === 'line' && (
                        <div className="space-y-3">
                          <div className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-2">道路破损严重程度排名</div>
                          {(() => {
                            const selectedLanes = lanes.filter(l => selectedLaneIds.includes(l.id));
                            const sortedLanes = [...selectedLanes].sort((a, b) => {
                              const severityOrder = { 'Poor': 0, 'Fair': 1, 'Good': 2, 'Excellent': 3, '未知': 4 };
                              return (severityOrder[a.condition as keyof typeof severityOrder] ?? 4) - (severityOrder[b.condition as keyof typeof severityOrder] ?? 4);
                            });
                            return sortedLanes.length > 0 ? (
                              <div className="space-y-2">
                                {sortedLanes.slice(0, 10).map((lane, idx: number) => {
                                  const conditionStyle = lane.condition === 'Poor' ? 'text-red-600 bg-red-50' :
                                    lane.condition === 'Fair' ? 'text-amber-600 bg-amber-50' :
                                    lane.condition === 'Good' ? 'text-green-600 bg-green-50' :
                                    lane.condition === 'Excellent' ? 'text-emerald-600 bg-emerald-50' : 'text-slate-600 bg-slate-100';
                                  const conditionText = lane.condition === 'Poor' ? '较差' :
                                    lane.condition === 'Fair' ? '一般' :
                                    lane.condition === 'Good' ? '良好' :
                                    lane.condition === 'Excellent' ? '优良' : '未知';
                                  return (
                                    <div key={idx} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition">
                                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${lane.condition === 'Poor' ? 'bg-red-500 text-white' : lane.condition === 'Fair' ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-600'}`}>{idx + 1}</div>
                                      <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm text-slate-800 truncate">{lane.roadName || lane.id}</div>
                                        <div className="text-xs text-slate-500">长度：{(lane.length || 0).toFixed(0)}米</div>
                                      </div>
                                      <div className={`px-2 py-1 rounded text-xs font-medium ${conditionStyle}`}>{conditionText}</div>
                                      <button className="px-2 py-1 bg-white border rounded text-xs hover:bg-slate-50" onClick={() => {
                                        if (!map) return;
                                        setSelectedLane(lane);
                                        try { map.flyTo([lane.coordinates[0].lat, lane.coordinates[0].lng], 16); } catch(e) {}
                                      }}>定位</button>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : <div className="text-sm text-slate-500 py-4 text-center">未选中任何道路</div>;
                          })()}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 操作按钮 - 移除热力图 */}
                  <div className="flex gap-2">
                    <button className="flex-1 px-3 py-2 rounded-lg bg-indigo-500 text-white text-sm hover:bg-indigo-600 transition" onClick={() => {
                      try { 
                        const data = {
                          selectedLanes: lanes.filter(l => selectedLaneIds.includes(l.id)).map(l => ({
                            id: l.id,
                            roadName: l.roadName,
                            condition: l.condition,
                            length: l.length
                          })),
                          report: selectedAreaAnalysis.report,
                          exportTime: new Date().toISOString()
                        };
                        const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}); 
                        const url = URL.createObjectURL(blob); 
                        const a = document.createElement('a'); 
                        a.href=url; 
                        a.download='area_analysis.json'; 
                        a.click(); 
                        URL.revokeObjectURL(url); 
                      } catch(e) { alert('导出失败'); }
                    }}>导出分析报告</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 浮动最小化球（可拖动，位于视口） */}
        {selectedAreaAnalysis && selectedAreaMinimized && (
          <div
            ref={floatRef}
            title="点击还原面板；按住拖动以移动"
            role="button"
            aria-label="选区分析悬浮球（点击还原，拖动移动）"
            onMouseDown={(e) => {
              e.stopPropagation();
              // 开始拖拽
              draggingRef.current = true;
              movedRef.current = false;
              const rect = (floatRef.current as any)?.getBoundingClientRect();
              dragOffsetRef.current = { x: e.clientX - (rect?.left || 0), y: e.clientY - (rect?.top || 0) };

              const onMove = (ev: MouseEvent) => {
                if (!draggingRef.current) return;
                movedRef.current = true;
                const w = (floatRef.current as any)?.offsetWidth || 56;
                const h = (floatRef.current as any)?.offsetHeight || 56;
                let left = ev.clientX - dragOffsetRef.current.x;
                let top = ev.clientY - dragOffsetRef.current.y;
                const maxLeft = Math.max(8, window.innerWidth - w - 8);
                const maxTop = Math.max(8, window.innerHeight - h - 8);
                left = Math.max(8, Math.min(maxLeft, left));
                top = Math.max(8, Math.min(maxTop, top));
                setFloatPos({ left, top });
              };
              const onUp = () => {
                draggingRef.current = false;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                setTimeout(() => { movedRef.current = false; }, 0);
              };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              draggingRef.current = true;
              movedRef.current = false;
              const touch = e.touches[0];
              const rect = (floatRef.current as any)?.getBoundingClientRect();
              dragOffsetRef.current = { x: touch.clientX - (rect?.left || 0), y: touch.clientY - (rect?.top || 0) };

              const onMove = (ev: TouchEvent) => {
                if (!draggingRef.current) return;
                movedRef.current = true;
                const touch2 = ev.touches[0];
                const w = (floatRef.current as any)?.offsetWidth || 56;
                const h = (floatRef.current as any)?.offsetHeight || 56;
                let left = touch2.clientX - dragOffsetRef.current.x;
                let top = touch2.clientY - dragOffsetRef.current.y;
                const maxLeft = Math.max(8, window.innerWidth - w - 8);
                const maxTop = Math.max(8, window.innerHeight - h - 8);
                left = Math.max(8, Math.min(maxLeft, left));
                top = Math.max(8, Math.min(maxTop, top));
                setFloatPos({ left, top });
              };
              const onEnd = () => {
                draggingRef.current = false;
                document.removeEventListener('touchmove', onMove as any);
                document.removeEventListener('touchend', onEnd as any);
                setTimeout(() => { movedRef.current = false; }, 0);
              };
              document.addEventListener('touchmove', onMove as any, { passive: false });
              document.addEventListener('touchend', onEnd as any);
            }}
            onClick={(e) => {
              e.stopPropagation();
              // 点击非拖拽时恢复面板
              if (!movedRef.current) setSelectedAreaMinimized(false);
            }}
            style={{ position: 'fixed', top: floatPos.top, left: floatPos.left, zIndex: 4000 }}
            className="w-14 h-14 rounded-full bg-white shadow-lg border border-slate-200 flex items-center justify-center cursor-grab"
          >
            <div className="flex flex-col items-center gap-0 -mt-0.5">
              <div className="text-xs font-bold text-indigo-600">热</div>
              <div className="text-[10px] text-slate-500">{selectedLaneIds.length}</div>
            </div>
          </div>
        )}

        {/* 百度街景弹窗 */}
        {streetViewLocation && (
          <div className="fixed inset-0 z-[5000] bg-black/70 flex items-center justify-center p-4" onClick={() => setStreetViewLocation(null)}>
            <div className="bg-white rounded-2xl w-[960px] max-w-[96vw] h-[620px] max-h-[90vh] flex flex-col shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-slate-100">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-indigo-500" />
                  百度街景
                </h3>
                <button className="p-2 hover:bg-slate-100 rounded-full transition-colors" onClick={() => setStreetViewLocation(null)}>
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
              <div className="flex-1 bg-slate-50 flex items-center justify-center relative">
                {baiduAk ? (
                  <iframe
                    title="百度街景"
                    className="w-full h-full"
                    src={`https://api.map.baidu.com/panorama/v2?ak=${encodeURIComponent(baiduAk)}&width=1024&height=512&location=${streetViewLocation.lng},${streetViewLocation.lat}&fov=360`}
                    allowFullScreen
                  />
                ) : (
                  <div className="text-center p-10">
                    <div className="w-16 h-16 bg-indigo-100 text-indigo-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <MapPin className="w-8 h-8" />
                    </div>
                    <h4 className="text-lg font-bold text-slate-700 mb-2">街景服务未配置</h4>
                    <p className="text-sm text-slate-500 mb-4">请在 .env.local 中设置 VITE_BAIDU_AK 后再试。</p>
                    <p className="text-xs text-slate-400 max-w-xs mx-auto">当前坐标：{streetViewLocation.lat.toFixed(6)}, {streetViewLocation.lng.toFixed(6)}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 图片预览 + 病害分析 */}
        {viewPhotoUrl && (
          <div className="fixed inset-0 z-[5000] bg-black/60 flex items-center justify-center p-4" onClick={() => { setViewPhotoUrl(null); setPhotoAnalysis(null); setPhotoAnalysisError(null); setPhotoAnalysisLoading(false); }}>
            <div className="bg-white flex flex-row max-w-[96vw] max-h-[94vh] w-[1200px] h-[85vh] relative rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
              <button
                className="absolute top-3 right-3 p-2 bg-white/80 hover:bg-white rounded-full transition-colors text-slate-600 z-10 shadow-sm"
                onClick={() => { setViewPhotoUrl(null); setPhotoAnalysis(null); setPhotoAnalysisError(null); setPhotoAnalysisLoading(false); }}
                aria-label="关闭图片预览"
              >
                <X className="w-5 h-5" />
              </button>

              {/* 左侧：图片区域（占主导 ~65%） */}
              <div className="flex-[3] flex flex-col bg-slate-900 min-w-0">
                <div className="flex-1 flex items-center justify-center p-2 relative overflow-hidden">
                  <img
                    src={viewPhotoUrl}
                    alt="预览图"
                    className="w-full h-full object-contain"
                    style={{ maxHeight: 'calc(85vh - 60px)' }}
                  />
                  {/* 图片上的分析标注覆盖层 */}
                  {photoAnalysis?.highlight_regions && photoAnalysis.highlight_regions.length > 0 && (
                    <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2">
                      {photoAnalysis.highlight_regions.map((region: any, idx: number) => (
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
                  <span>道路：{selectedLane?.roadName || '未知'}</span>
                  {photoAnalysis && (
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${photoAnalysis.severity === '严重' ? 'bg-red-500/20 text-red-400' : photoAnalysis.severity === '中等' ? 'bg-amber-500/20 text-amber-400' : 'bg-green-500/20 text-green-400'}`}>
                        {photoAnalysis.severity || '未知'}
                      </span>
                      {photoAnalysis.severity_score && (
                        <span>评分：{photoAnalysis.severity_score}/10</span>
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
                    onClick={async () => {
                      if (!viewPhotoUrl) return;
                      setPhotoAnalysisLoading(true);
                      setPhotoAnalysisError(null);
                      setPhotoAnalysis(null);
                      const res = await analyzeDamagePhoto(viewPhotoUrl, { roadName: selectedLane?.roadName, locationText: selectedLane ? `${selectedLane.coordinates?.[0]?.lat?.toFixed?.(5) || ''}, ${selectedLane.coordinates?.[0]?.lng?.toFixed?.(5) || ''}` : undefined });
                      if (!res || res.error) {
                        setPhotoAnalysisError(res?.error || '分析失败，请稍后重试');
                        setPhotoAnalysisLoading(false);
                        return;
                      }
                      setPhotoAnalysis(res.data);
                      setPhotoAnalysisLoading(false);
                    }}
                    disabled={photoAnalysisLoading}
                  >
                    {photoAnalysisLoading ? (
                      <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />分析中...</span>
                    ) : '开始分析'}
                  </button>
                </div>

                {/* 可滚动内容区域 */}
                <div className="flex-1 overflow-y-auto px-5 py-4">
                {photoAnalysisError && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-3">{photoAnalysisError}</div>}

                  {photoAnalysisLoading && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                      <div className="text-sm text-slate-500">正在分析病害特征...</div>
                      <div className="text-xs text-slate-400">正在识别病害类型、评估严重度并生成维修方案</div>
                    </div>
                  )}

                {photoAnalysis && !photoAnalysisLoading ? (
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
                            <span className="font-semibold text-slate-900">{photoAnalysis.damage_type || '未知'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500 text-xs">严重等级</span>
                            <span className={`font-semibold ${photoAnalysis.severity === '严重' ? 'text-red-600' : photoAnalysis.severity === '中等' ? 'text-amber-600' : 'text-green-600'}`}>{photoAnalysis.severity || '未知'}</span>
                          </div>
                          {photoAnalysis.severity_score && (
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-slate-500 text-xs">严重度评分</span>
                                <span className="font-semibold text-slate-700">{photoAnalysis.severity_score}/10</span>
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-2">
                                <div className={`h-2 rounded-full transition-all ${photoAnalysis.severity_score >= 7 ? 'bg-red-500' : photoAnalysis.severity_score >= 4 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${photoAnalysis.severity_score * 10}%` }}></div>
                              </div>
                            </div>
                          )}
                          {photoAnalysis.dimensions && (
                            <div className="bg-slate-50 rounded-lg p-2.5 mt-1 grid grid-cols-2 gap-2">
                              {photoAnalysis.dimensions.estimated_length && <div><div className="text-[10px] text-slate-400">估算长度</div><div className="text-xs font-semibold text-slate-700">{photoAnalysis.dimensions.estimated_length}</div></div>}
                              {photoAnalysis.dimensions.estimated_width && <div><div className="text-[10px] text-slate-400">估算宽度</div><div className="text-xs font-semibold text-slate-700">{photoAnalysis.dimensions.estimated_width}</div></div>}
                              {photoAnalysis.dimensions.estimated_depth && <div><div className="text-[10px] text-slate-400">估算深度</div><div className="text-xs font-semibold text-slate-700">{photoAnalysis.dimensions.estimated_depth}</div></div>}
                              {photoAnalysis.dimensions.estimated_area && <div><div className="text-[10px] text-slate-400">影响面积</div><div className="text-xs font-semibold text-slate-700">{photoAnalysis.dimensions.estimated_area}</div></div>}
                            </div>
                          )}
                          {photoAnalysis.reasoning && <div className="text-xs text-slate-500 mt-2 bg-blue-50 rounded-lg p-2.5 border border-blue-100">💡 {photoAnalysis.reasoning}</div>}
                        </div>
                      </div>

                      {/* 2. 成因分析 */}
                      {photoAnalysis.cause_analysis && (
                        <div className="rounded-xl border border-slate-200 overflow-hidden">
                          <div className="bg-gradient-to-r from-purple-50 to-pink-50 px-4 py-2.5 border-b border-slate-100">
                            <div className="font-bold text-slate-800 text-xs flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-[10px] font-black">2</span>
                              损伤成因分析
                            </div>
                          </div>
                          <div className="p-4 space-y-2">
                            <div><span className="text-slate-500 text-xs">主因：</span><span className="text-slate-800 font-medium text-xs">{photoAnalysis.cause_analysis.primary_cause}</span></div>
                            {photoAnalysis.cause_analysis.contributing_factors && photoAnalysis.cause_analysis.contributing_factors.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                {photoAnalysis.cause_analysis.contributing_factors.map((f: string, idx: number) => (
                                  <span key={idx} className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded-md text-[11px]">{f}</span>
                                ))}
                              </div>
                            )}
                            {photoAnalysis.cause_analysis.progression_risk && <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded-lg mt-1">⚠️ {photoAnalysis.cause_analysis.progression_risk}</div>}
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
                              <span className={`w-2 h-2 rounded-full ${photoAnalysis.maintenance?.urgency === '立即' ? 'bg-red-500 animate-pulse' : photoAnalysis.maintenance?.urgency?.includes('短期') ? 'bg-amber-500' : 'bg-green-500'}`}></span>
                              <span className="text-xs font-semibold text-slate-700">{photoAnalysis.maintenance?.urgency || '待评估'}</span>
                            </div>
                            {photoAnalysis.maintenance?.technique && (
                              <span className="px-2.5 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[11px] font-medium">{photoAnalysis.maintenance.technique}</span>
                            )}
                            {photoAnalysis.maintenance?.estimated_cost && (
                              <span className="text-xs text-slate-500">💰 {photoAnalysis.maintenance.estimated_cost}</span>
                            )}
                          </div>
                          {photoAnalysis.maintenance?.actions && photoAnalysis.maintenance.actions.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="text-[11px] text-slate-400 font-semibold">维修步骤</div>
                              {photoAnalysis.maintenance.actions.map((a: string, idx: number) => (
                                <div key={idx} className="flex items-start gap-2 text-xs text-slate-700">
                                  <span className="w-4 h-4 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">{idx + 1}</span>
                                  {a}
                                </div>
                              ))}
                            </div>
                          )}
                          {photoAnalysis.maintenance?.materials && photoAnalysis.maintenance.materials.length > 0 && (
                            <div>
                              <div className="text-[11px] text-slate-400 font-semibold mb-2">所需材料</div>
                              <div className="space-y-1.5">
                                {photoAnalysis.maintenance.materials.map((m: any, idx: number) => (
                                  <div key={idx} className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                                    <div className="font-medium text-xs text-slate-800">{m.name}{m.spec ? ` (${m.spec})` : ''}</div>
                                    <div className="text-[11px] text-slate-500 mt-0.5">{m.usage}{m.unit_amount ? ` · 用量：${m.unit_amount}` : ''}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {photoAnalysis.maintenance?.equipment && photoAnalysis.maintenance.equipment.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              <span className="text-[11px] text-slate-400">设备：</span>
                              {photoAnalysis.maintenance.equipment.map((eq: string, idx: number) => (
                                <span key={idx} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[11px]">{eq}</span>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center gap-4 text-[11px] text-slate-500">
                            {photoAnalysis.maintenance?.work_duration && <span>⏱ 工期：{photoAnalysis.maintenance.work_duration}</span>}
                            {photoAnalysis.maintenance?.quality_standard && <span>✅ {photoAnalysis.maintenance.quality_standard}</span>}
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
                          <div className="text-xs text-slate-700">{photoAnalysis.traffic?.impact || '影响待评估'}</div>
                          <div className="flex items-center gap-3 flex-wrap text-xs">
                            {photoAnalysis.traffic?.risk_level && (
                              <span className={`px-2 py-0.5 rounded-full font-semibold ${photoAnalysis.traffic.risk_level === '高' ? 'bg-red-100 text-red-700' : photoAnalysis.traffic.risk_level === '中' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                                风险:{photoAnalysis.traffic.risk_level}
                              </span>
                            )}
                            {photoAnalysis.traffic?.speed_limit && <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">限速 {photoAnalysis.traffic.speed_limit}</span>}
                            {photoAnalysis.traffic?.closure_needed && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-semibold">需封闭施工</span>}
                          </div>
                          {photoAnalysis.traffic?.advice && <div className="text-xs text-slate-600 bg-amber-50 p-2 rounded-lg">📋 {photoAnalysis.traffic.advice}</div>}
                        </div>
                      </div>

                      {/* 5. 养护建议 */}
                      {photoAnalysis.lane_care_tips && photoAnalysis.lane_care_tips.length > 0 && (
                        <div className="rounded-xl border border-slate-200 overflow-hidden">
                          <div className="bg-gradient-to-r from-green-50 to-emerald-50 px-4 py-2.5 border-b border-slate-100">
                            <div className="font-bold text-slate-800 text-xs flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-[10px] font-black">5</span>
                              日常养护建议
                            </div>
                          </div>
                          <div className="p-4 space-y-2">
                            {photoAnalysis.lane_care_tips.map((tip: string, idx: number) => (
                              <div key={idx} className="flex items-start gap-2 text-xs text-slate-700">
                                <span className="text-green-500 mt-0.5">●</span>
                                {tip}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 发送给维修方按钮 */}
                      <div className="pt-4 border-t border-slate-100">
                        <button
                          className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold text-sm hover:from-amber-600 hover:to-orange-600 transition-all flex items-center justify-center gap-2"
                          onClick={() => {
                            // 格式化分析结果为可复制文本
                            const analysisText = [
                              `【病害诊断报告】`,
                              `道路：${selectedLane?.roadName || '未知'}`,
                              `病害类型：${photoAnalysis.damage_type || '未知'}`,
                              `严重等级：${photoAnalysis.severity || '未知'}`,
                              photoAnalysis.severity_score ? `严重度评分：${photoAnalysis.severity_score}/10` : '',
                              photoAnalysis.dimensions ? `\n【尺寸估算】\n${photoAnalysis.dimensions.estimated_length ? `长度：${photoAnalysis.dimensions.estimated_length}` : ''}${photoAnalysis.dimensions.estimated_width ? ` 宽度：${photoAnalysis.dimensions.estimated_width}` : ''}${photoAnalysis.dimensions.estimated_depth ? ` 深度：${photoAnalysis.dimensions.estimated_depth}` : ''}` : '',
                              photoAnalysis.cause_analysis ? `\n【成因分析】\n主因：${photoAnalysis.cause_analysis.primary_cause || ''}${photoAnalysis.cause_analysis.contributing_factors?.length ? `\n诱因：${photoAnalysis.cause_analysis.contributing_factors.join('、')}` : ''}` : '',
                              photoAnalysis.maintenance ? `\n【维修方案】\n紧迫性：${photoAnalysis.maintenance.urgency || ''}${photoAnalysis.maintenance.technique ? `\n工艺：${photoAnalysis.maintenance.technique}` : ''}${photoAnalysis.maintenance.actions?.length ? `\n步骤：\n${photoAnalysis.maintenance.actions.map((a: string, i: number) => `${i+1}. ${a}`).join('\n')}` : ''}` : '',
                              photoAnalysis.maintenance?.materials?.length ? `\n【材料清单】\n${photoAnalysis.maintenance.materials.map((m: any) => `- ${m.name}${m.spec ? `(${m.spec})` : ''}${m.unit_amount ? ` ${m.unit_amount}` : ''}`).join('\n')}` : '',
                              photoAnalysis.traffic ? `\n【通行管控】\n${photoAnalysis.traffic.impact || ''}${photoAnalysis.traffic.risk_level ? ` 风险等级：${photoAnalysis.traffic.risk_level}` : ''}${photoAnalysis.traffic.closure_needed ? ' 需封闭施工' : ''}` : '',
                              photoAnalysis.lane_care_tips?.length ? `\n【养护建议】\n${photoAnalysis.lane_care_tips.map((t: string) => `- ${t}`).join('\n')}` : '',
                            ].filter(Boolean).join('\n');
                            
                            navigator.clipboard.writeText(analysisText).then(() => {
                              alert('分析报告已复制到剪贴板，可粘贴到维修报告中');
                            }).catch(() => {
                              // 如果剪贴板API不可用，创建一个临时textarea
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
                  ) : !photoAnalysisLoading && (
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
        )}
        
        {/* 路面健康度监测面板 */}
        <RoadHealthMonitor />
      </main>
    </div>
  );
};

// 路面健康度监测面板组件（与报告表单四状态完全一致）
const RoadHealthMonitor = () => (
  <div className="absolute bottom-6 left-6 bg-slate-900/95 backdrop-blur-md p-5 rounded-2xl shadow-2xl border border-white/10 z-[1000]">
    <h4 className="text-[10px] font-bold text-indigo-400 uppercase tracking-[0.2em] mb-4">路面健康度监测</h4>
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-2 bg-[#10b981] rounded-full"></div>
        <span className="text-xs font-bold text-white">优良（Excellent）</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-8 h-2 bg-[#22c55e] rounded-full"></div>
        <span className="text-xs font-bold text-white">良好（Good）</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-8 h-2 bg-[#f59e0b] rounded-full"></div>
        <span className="text-xs font-bold text-white">一般（Fair）</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-8 h-2 bg-[#ef4444] rounded-full"></div>
        <span className="text-xs font-bold text-white">较差（Poor）</span>
      </div>
      <div className="flex items-center gap-3 pt-2 border-t border-white/10">
        <div className="w-8 h-2 bg-[#4f46e5] rounded-full shadow-[0_0_8px_#4f46e5]"></div>
        <span className="text-xs font-bold text-indigo-300">已选中路段</span>
      </div>
    </div>
  </div>
);

export default App;
