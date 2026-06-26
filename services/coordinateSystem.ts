export type CoordinateMode = 'wgs84' | 'gcj02';

export interface LngLat {
  lat: number;
  lng: number;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

const A = 6378245.0;
const EE = 0.00669342162296594323;
const PI = Math.PI;

const parseMode = (raw?: string): CoordinateMode => {
  const value = String(raw || 'wgs84').trim().toLowerCase();
  return value === 'gcj02' ? 'gcj02' : 'wgs84';
};

export const COORDINATE_MODE: CoordinateMode = parseMode(import.meta.env?.VITE_COORDINATE_MODE);

const normalizePoint = (lat: number, lng: number): LngLat => ({
  lat: Number(lat),
  lng: Number(lng),
});

const isInChina = (lat: number, lng: number) => {
  return lng >= 72.004 && lng <= 137.8347 && lat >= 0.8293 && lat <= 55.8271;
};

const transformLat = (x: number, y: number) => {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
};

const transformLng = (x: number, y: number) => {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
};

export const wgs84ToGcj02 = (lat: number, lng: number): LngLat => {
  const point = normalizePoint(lat, lng);
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return point;
  if (!isInChina(point.lat, point.lng)) return point;

  let dLat = transformLat(point.lng - 105.0, point.lat - 35.0);
  let dLng = transformLng(point.lng - 105.0, point.lat - 35.0);
  const radLat = point.lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);

  return {
    lat: point.lat + dLat,
    lng: point.lng + dLng,
  };
};

export const gcj02ToWgs84 = (lat: number, lng: number): LngLat => {
  const point = normalizePoint(lat, lng);
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return point;
  if (!isInChina(point.lat, point.lng)) return point;

  const converted = wgs84ToGcj02(point.lat, point.lng);
  return {
    lat: point.lat * 2 - converted.lat,
    lng: point.lng * 2 - converted.lng,
  };
};

export const osmCoordinateToMap = (lat: number, lng: number): LngLat => {
  if (COORDINATE_MODE === 'gcj02') return wgs84ToGcj02(lat, lng);
  return normalizePoint(lat, lng);
};

export const mapCoordinateToOsm = (lat: number, lng: number): LngLat => {
  if (COORDINATE_MODE === 'gcj02') return gcj02ToWgs84(lat, lng);
  return normalizePoint(lat, lng);
};

export const mapBoundsToOsm = (south: number, west: number, north: number, east: number): Bounds => {
  const s = Number(south);
  const w = Number(west);
  const n = Number(north);
  const e = Number(east);

  if (COORDINATE_MODE !== 'gcj02') {
    return {
      south: Math.min(s, n),
      north: Math.max(s, n),
      west: Math.min(w, e),
      east: Math.max(w, e),
    };
  }

  const points = [
    mapCoordinateToOsm(s, w),
    mapCoordinateToOsm(s, e),
    mapCoordinateToOsm(n, w),
    mapCoordinateToOsm(n, e),
  ];

  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);

  return {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lngs),
    east: Math.max(...lngs),
  };
};
