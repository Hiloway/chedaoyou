
import { LaneInfo, LaneType } from '../types';
import { mapBoundsToOsm, mapCoordinateToOsm, osmCoordinateToMap } from './coordinateSystem';

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

/**
 * 将 OSM highway 标签映射为中文道路等级描述
 */
const mapRoadType = (highway?: string): string => {
  switch (highway) {
    case 'motorway': return '高速公路';
    case 'trunk': return '城市快速路';
    case 'primary': return '一级主干道';
    case 'secondary': return '二级干道';
    case 'tertiary': return '三级干道';
    default: return '常规车道';
  }
};

/**
 * 基于 OSM id 的确定性 hash（0~1），保证同一条路在 fetchRealLanes
 * 与 fetchRealLanesByBbox 两个入口下得到完全一致的随机路况
 */
const hashIdToRand = (id: number | string): number => {
  const idStr = String(id);
  let hash = 0;
  for (let i = 0; i < idStr.length; i++) {
    hash = (hash << 5) - hash + idStr.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 100 / 100;
};

/**
 * 根据 OSM smoothness 标签推断路况；缺失时用确定性 hash 兜底
 */
const deriveCondition = (tags: any, id: number | string): LaneInfo['condition'] => {
  const smoothness = tags?.smoothness;
  if (smoothness === 'excellent') return 'Excellent';
  if (['good', 'intermediate'].includes(smoothness)) return 'Good';
  if (['bad', 'very_bad'].includes(smoothness)) return 'Fair';
  if (['horrible', 'very_horrible', 'impassable'].includes(smoothness)) return 'Poor';

  const rand = hashIdToRand(id);
  if (rand > 0.9) return 'Poor';
  if (rand > 0.7) return 'Fair';
  if (rand > 0.4) return 'Excellent';
  return 'Good';
};

/**
 * 将单个 OSM element 映射为 LaneInfo（两个 fetch 入口共用，避免逻辑重复）
 */
const mapOsmElementToLane = (el: any): LaneInfo | null => {
  const tags = el.tags || {};
  const roadTypeDesc = mapRoadType(tags.highway);
  const coordinates = el.geometry
    ? el.geometry.map((pt: any) => osmCoordinateToMap(pt.lat, pt.lon)).filter(Boolean)
    : [];
  if (coordinates.length === 0) return null;

  return {
    id: `osm-${el.id}`,
    roadName: tags.name || tags.ref || roadTypeDesc,
    laneCount: parseInt(tags.lanes) || (tags.oneway === 'yes' ? 3 : 6),
    direction: tags.oneway === 'yes' ? 'north' : 'bidirectional',
    type: LaneType.CAR,
    width: tags.width ? parseFloat(tags.width) : null,
    condition: deriveCondition(tags, el.id),
    lastUpdated: new Date().toISOString().split('T')[0],
    coordinates,
  };
};

const parseOverpassResponse = (data: any): LaneInfo[] => {
  if (!data || !data.elements) return [];
  return data.elements
    .map(mapOsmElementToLane)
    .filter((lane: LaneInfo | null): lane is LaneInfo => lane !== null);
};

export const fetchRealLanes = async (lat: number, lng: number, radius: number = 800): Promise<LaneInfo[]> => {
  const centerForQuery = mapCoordinateToOsm(lat, lng);
  const query = `
    [out:json][timeout:30];
    way(around:${radius}, ${centerForQuery.lat}, ${centerForQuery.lng})["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"];
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
      return parseOverpassResponse(data);
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
  maxAreaDeg?: number
): Promise<LaneInfo[]> => {
  const osmBbox = mapBoundsToOsm(south, west, north, east);
  // 简单保护：bbox 面积过大直接返回空数组，避免 Overpass 超时
  const areaDeg = Math.abs(osmBbox.north - osmBbox.south) * Math.abs(osmBbox.east - osmBbox.west);
  if (maxAreaDeg && areaDeg > maxAreaDeg) return [];
  if (areaDeg > 1.0) return [];

  const query = `
    [out:json][timeout:30];
    way(${osmBbox.south},${osmBbox.west},${osmBbox.north},${osmBbox.east})["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"];
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
      return parseOverpassResponse(data);
    } catch (error) {
      if (error && (error as any).name === 'AbortError') throw error;
      console.error(`bbox 镜像 ${baseUrl} 失败:`, error);
    }
  }
  return [];
};
