/**
 * 路段相关公共工具函数
 * 在多个组件 / hooks 之间复用，避免重复定义
 */

/**
 * 道路 id 模糊匹配：用于把 OSM id（如 osm-123456）与后端 road_id 进行比较
 * 规则：精确相等，或一个 endsWith 另一个
 */
export const matchLaneId = (lId: string | null | undefined, rId: string | null | undefined): boolean => {
  if (!lId || !rId) return false;
  if (lId === rId) return true;
  if (lId.endsWith(rId)) return true;
  if (rId.endsWith(lId)) return true;
  return false;
};

/**
 * 把任意时间字符串或 Date 标准化为 YYYY-MM-DD（若无法解析则返回空串）
 */
export const formatDateShort = (v?: string | Date | null): string => {
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
  } catch {
    return '';
  }
};

/**
 * 取路段第一个坐标点，返回标准化的 {lat, lng}；无效时返回 null
 */
export const getLaneFirstPoint = (laneLike: any): { lat: number; lng: number } | null => {
  const first = laneLike?.coordinates?.[0];
  if (!first) return null;
  const lat = Number(first.lat);
  const lng = Number(first.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

/**
 * 用 Haversine 公式计算路段折线总长度（米）
 */
export const getLaneLengthMeters = (laneLike: any): number => {
  const coords = Array.isArray(laneLike?.coordinates) ? laneLike.coordinates : [];
  if (coords.length < 2) return 0;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const lat1 = toRad(Number(a.lat));
    const lat2 = toRad(Number(b.lat));
    const dLat = lat2 - lat1;
    const dLng = toRad(Number(b.lng) - Number(a.lng));
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    total += 6371000 * c;
  }
  return Number.isFinite(total) ? total : 0;
};

/**
 * 根据路况返回对应颜色；选中状态统一高亮为深蓝
 */
export const getConditionColor = (condition: string, isSelected: boolean): string => {
  if (isSelected) return '#4f46e5';
  switch (condition) {
    case 'Excellent': return '#10b981';
    case 'Good': return '#22c55e';
    case 'Fair': return '#f59e0b';
    case 'Poor': return '#ef4444';
    case 'InRepair': return '#f59e0b';
    default: return '#64748b';
  }
};
