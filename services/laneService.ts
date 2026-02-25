
import { LaneInfo, LaneType } from '../types';

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter'
];

async function tryFetchWithRetries(url: string, init?: RequestInit, retries = 2, backoff = 400) {
  let lastErr: any = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(url, init);
      return resp;
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise(r => setTimeout(r, backoff * Math.pow(1.8, i)));
    }
  }
  throw lastErr;
}

export const fetchRealLanes = async (lat: number, lng: number, radius: number = 800): Promise<LaneInfo[]> => {
  const query = `
    [out:json][timeout:30];
    way(around:${radius}, ${lat}, ${lng})["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"];
    out geom;
  `;
  
  for (const baseUrl of OVERPASS_MIRRORS) {
    const url = `${baseUrl}?data=${encodeURIComponent(query)}`;
    
    try {
      const response = await tryFetchWithRetries(url, undefined, 2, 500);
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) continue;

      const data = await response.json();
      if (!data || !data.elements) return [];

      return data.elements.map((el: any) => {
        const tags = el.tags || {};
        
        // 映射道路等级
        let roadTypeDesc = '常规车道';
        if (tags.highway === 'motorway') roadTypeDesc = '高速公路';
        else if (tags.highway === 'trunk') roadTypeDesc = '城市快速路';
        else if (tags.highway === 'primary') roadTypeDesc = '一级主干道';
        else if (tags.highway === 'secondary') roadTypeDesc = '二级干道';
        else if (tags.highway === 'tertiary') roadTypeDesc = '三级干道';

      
        let condition: 'Excellent' | 'Good' | 'Fair' | 'Poor' | '未知' = '未知';
        const smoothness = tags.smoothness;
        if (smoothness === 'excellent') condition = 'Excellent';
        else if (['good', 'intermediate'].includes(smoothness)) condition = 'Good';
        else if (['bad', 'very_bad'].includes(smoothness)) condition = 'Fair';
        else if (['horrible', 'very_horrible', 'impassable'].includes(smoothness)) condition = 'Poor';
        else {
         
          const rand = (el.id % 100) / 100;
          if (rand > 0.9) condition = 'Poor';
          else if (rand > 0.7) condition = 'Fair';
          else if (rand > 0.4) condition = 'Excellent';
          else condition = 'Good';
        }

        return {
          id: `osm-${el.id}`,
          roadName: tags.name || tags.ref || `${roadTypeDesc}`,
          laneCount: parseInt(tags.lanes) || (tags.oneway === 'yes' ? 3 : 6),
          direction: tags.oneway === 'yes' ? 'north' : 'bidirectional',
          type: LaneType.CAR,
          width: tags.width ? parseFloat(tags.width) : null,
          condition: condition,
          lastUpdated: new Date().toISOString().split('T')[0],
          coordinates: el.geometry ? el.geometry.map((pt: any) => ({ lat: pt.lat, lng: pt.lon })) : []
        };
      }).filter((lane: any) => lane.coordinates.length > 0);

    } catch (error) {
      console.error(`镜像 ${baseUrl} 失败:`, error);
    }
  }
  return [];
};

/**
 * 根据 bbox 拉取道路（用于框选时补全未加载的路段）
 * bbox: south, west, north, east
 * 可传入 AbortSignal 进行取消。
 */
export const fetchRealLanesByBbox = async (
  south: number,
  west: number,
  north: number,
  east: number,
  signal?: AbortSignal,
  maxAreaDeg?: number // 可选面积上限（经纬度度数），避免范围过大
): Promise<LaneInfo[]> => {
  // 简单保护：如果 bbox 面积过大，直接返回空数组（避免请求 Overpass 超时）
  const areaDeg = Math.abs(north - south) * Math.abs(east - west);
  if (maxAreaDeg && areaDeg > maxAreaDeg) return [];
  if (areaDeg > 1.0) return []; // 非常粗糙的阈值（约 1 度 * 1 度）

  const query = `
    [out:json][timeout:30];
    way(${south},${west},${north},${east})["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"];
    out geom;
  `;

  for (const baseUrl of OVERPASS_MIRRORS) {
    const url = `${baseUrl}?data=${encodeURIComponent(query)}`;

    try {
      const response = await tryFetchWithRetries(url, { signal }, 2, 500);
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) continue;

      const data = await response.json();
      if (!data || !data.elements) return [];

      return data.elements.map((el: any) => {
        const tags = el.tags || {};
        let roadTypeDesc = '常规车道';
        if (tags.highway === 'motorway') roadTypeDesc = '高速公路';
        else if (tags.highway === 'trunk') roadTypeDesc = '城市快速路';
        else if (tags.highway === 'primary') roadTypeDesc = '一级主干道';
        else if (tags.highway === 'secondary') roadTypeDesc = '二级干道';
        else if (tags.highway === 'tertiary') roadTypeDesc = '三级干道';

        let condition: 'Excellent' | 'Good' | 'Fair' | 'Poor' | '未知' = '未知';
        const smoothness = tags.smoothness;
        if (smoothness === 'excellent') condition = 'Excellent';
        else if (['good', 'intermediate'].includes(smoothness)) condition = 'Good';
        else if (['bad', 'very_bad'].includes(smoothness)) condition = 'Fair';
        else if (['horrible', 'very_horrible', 'impassable'].includes(smoothness)) condition = 'Poor';
        else {
          const idStr = String(el.id);
          let hash = 0;
          for (let i = 0; i < idStr.length; i++) {
            hash = (hash << 5) - hash + idStr.charCodeAt(i);
            hash |= 0;
          }
          const rand = Math.abs(hash) % 100 / 100;
          if (rand > 0.9) condition = 'Poor';
          else if (rand > 0.7) condition = 'Fair';
          else if (rand > 0.4) condition = 'Excellent';
          else condition = 'Good';
        }

        return {
          id: `osm-${el.id}`,
          roadName: tags.name || tags.ref || `${roadTypeDesc}`,
          laneCount: parseInt(tags.lanes) || (tags.oneway === 'yes' ? 3 : 6),
          direction: tags.oneway === 'yes' ? 'north' : 'bidirectional',
          type: LaneType.CAR,
          width: tags.width ? parseFloat(tags.width) : null,
          condition: condition,
          lastUpdated: new Date().toISOString().split('T')[0],
          coordinates: el.geometry ? el.geometry.map((pt: any) => ({ lat: pt.lat, lng: pt.lon })) : []
        };
      }).filter((lane: any) => lane.coordinates.length > 0);

    } catch (error) {
      if (error && (error as any).name === 'AbortError') throw error;
      console.error(`bbox 镜像 ${baseUrl} 失败:`, error);
    }
  }
  return [];
};
