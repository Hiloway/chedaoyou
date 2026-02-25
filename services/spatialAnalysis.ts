/**
 * spatialAnalysis.ts
 * 提供空间分析工具：Getis-Ord Gi*（热点分析）和核密度（Kernel Density）
 * 可在服务端或浏览器端使用（纯 TS，零依赖）。
 */

export interface DamagePoint {
  id?: string;
  lat: number;
  lng: number;
  value?: number; // 破损严重度或权重，默认为 1
  roadId?: string; // 可选：所属路段 id，便于聚合时精确匹配
}

const EARTH_RADIUS = 6371000; // meters

function haversineDistance(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const sinDlat = Math.sin(dLat / 2);
  const sinDlng = Math.sin(dLng / 2);
  const val = sinDlat * sinDlat + Math.cos(lat1) * Math.cos(lat2) * sinDlng * sinDlng;
  const c = 2 * Math.atan2(Math.sqrt(val), Math.sqrt(1 - val));
  return EARTH_RADIUS * c;
}

// 标准正态分布 CDF（误差函数近似）
function stdNormalCDF(z: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const poly = (((a5 * t + a4) * t + a3) * t + a2) * t + a1;
  const erf = 1 - poly * Math.exp(-z * z);
  const sign = z < 0 ? -1 : 1;
  const cdf = 0.5 * (1 + sign * erf);
  return cdf;
}

/**
 * computeGetisOrdGi
 * 计算每个点的 Getis-Ord Gi* Z-score 与 p-value，并根据显著性标注热点/冷点
 */
export const computeGetisOrdGi = (
  points: DamagePoint[],
  options?: { bandwidthMeters?: number; valueField?: string; significanceZ?: number }
) => {
  const bandwidth = options?.bandwidthMeters ?? 500; // default 500m
  const n = points.length;
  if (n === 0) return [];

  const values = points.map(p => (typeof p.value === 'number' ? p.value : 1));
  const sumX = values.reduce((s, v) => s + v, 0);
  const meanX = sumX / n;
  const s = Math.sqrt(values.reduce((acc, v) => acc + Math.pow(v - meanX, 2), 0) / n);

  const results = points.map((pi, i) => {
    let sumW = 0;
    let sumWx = 0;
    let sumW2 = 0;
    for (let j = 0; j < n; j++) {
      const pj = points[j];
      const d = haversineDistance(pi.lat, pi.lng, pj.lat, pj.lng);
      const w = d <= bandwidth ? 1 : 0; // 可替换为其他权重函数
      sumW += w;
      sumWx += w * values[j];
      sumW2 += w * w;
    }

    let z = 0;
    let pValue = 1;
    if (s > 0 && n > 1) {
      const numerator = sumWx - meanX * sumW;
      const denom = s * Math.sqrt((n * sumW2 - sumW * sumW) / (n - 1));
      if (denom !== 0) {
        z = numerator / denom;
        pValue = 2 * (1 - stdNormalCDF(Math.abs(z)));
      }
    }

    const hotspotType = z >= (options?.significanceZ ?? 1.96) ? 'hotspot'
      : z <= -(options?.significanceZ ?? 1.96) ? 'coldspot'
      : 'not-significant';

    return {
      id: pi.id,
      roadId: pi.roadId,
      lat: pi.lat,
      lng: pi.lng,
      value: typeof pi.value === 'number' ? pi.value : 1,
      zScore: z,
      pValue,
      hotspotType
    };
  });

  return results;
};


/**
 * interpretHotspots
 * 将 Getis-Ord Gi* 结果转化为面向用户的自然语言分析报告
 * 采用点（上报点）、线（道路）、面（区域）三个维度进行综合诊断
 */
export const interpretHotspots = (
  giResults: ReturnType<typeof computeGetisOrdGi>,
  options?: { roadNames?: string[]; areaName?: string }
) => {
  const hotspots = giResults.filter(r => r.hotspotType === 'hotspot');
  const coldspots = giResults.filter(r => r.hotspotType === 'coldspot');
  const normal = giResults.filter(r => r.hotspotType === 'not-significant');

  const total = giResults.length;
  const hotRatio = total > 0 ? hotspots.length / total : 0;
  const coldRatio = total > 0 ? coldspots.length / total : 0;
  const avgHotZ = hotspots.length
    ? hotspots.reduce((sum, r) => sum + r.zScore, 0) / hotspots.length
    : 0;
  const maxZ = hotspots.length ? Math.max(...hotspots.map(r => r.zScore)) : 0;

  // ============ 面向用户的自然语言分析 ============
  
  // 【面】区域整体评估
  const areaInsights: string[] = [];
  let areaHealthLevel: '优良' | '良好' | '一般' | '较差' | '严重' = '良好';
  let areaHealthScore = 100;

  if (total === 0) {
    areaInsights.push('该区域暂无破损上报记录，路面状况良好或缺少巡查数据。');
    areaHealthLevel = '优良';
  } else if (hotRatio > 0.4) {
    areaHealthLevel = '严重';
    areaHealthScore = 20;
    areaInsights.push(`区域内${Math.round(hotRatio * 100)}%的上报点呈现高度聚集特征，表明该区域存在系统性路面损坏问题。`);
    areaInsights.push('建议启动专项整治计划，优先排查地下管网、路基及排水系统是否存在隐患。');
  } else if (hotRatio > 0.25) {
    areaHealthLevel = '较差';
    areaHealthScore = 40;
    areaInsights.push(`检测到约${Math.round(hotRatio * 100)}%的点位属于破损热点，区域整体养护压力较大。`);
    areaInsights.push('建议按热点集中度排序，分批次安排维修队伍进场。');
  } else if (hotRatio > 0.1) {
    areaHealthLevel = '一般';
    areaHealthScore = 60;
    areaInsights.push(`区域内存在${hotspots.length}处局部热点（占比${Math.round(hotRatio * 100)}%），整体可控但需关注重点路段。`);
    areaInsights.push('建议结合日常巡查优先处理高Z值热点，防止病害扩散。');
  } else if (hotspots.length > 0) {
    areaHealthLevel = '良好';
    areaHealthScore = 80;
    areaInsights.push(`仅检测到${hotspots.length}处分散热点，区域路面整体状况良好。`);
    areaInsights.push('可将这些零星热点纳入常规养护计划处理。');
  } else {
    areaHealthLevel = '优良';
    areaHealthScore = 95;
    areaInsights.push('未检测到显著破损热点，区域路面健康状况优良。');
    areaInsights.push('建议维持当前养护频率，定期巡查即可。');
  }

  // 冷点（低破损区）分析
  if (coldspots.length > 0 && coldRatio > 0.1) {
    areaInsights.push(`同时发现${coldspots.length}处显著低破损区（冷点），这些区域可作为养护效果对照或经验总结样本。`);
  }

  // 【点】关键破损点诊断
  const pointInsights: string[] = [];
  const criticalPoints = hotspots.filter(p => p.zScore > 2.58); // 99%置信度
  const highPoints = hotspots.filter(p => p.zScore > 1.96 && p.zScore <= 2.58);

  if (criticalPoints.length > 0) {
    pointInsights.push(`发现${criticalPoints.length}处极显著热点（置信度>99%），这些点位周边破损异常密集，很可能存在：`);
    if (maxZ > 3.5) {
      pointInsights.push('• 路面结构性失效（基层塌陷、翻浆等深层病害）');
    }
    if (maxZ > 3.0) {
      pointInsights.push('• 地下管线泄漏或排水系统故障');
    }
    pointInsights.push('• 重车碾压或超载造成的累积损伤');
    pointInsights.push('建议对这些点位进行专项勘察，必要时采用钻芯取样或探地雷达检测。');
  }

  if (highPoints.length > 0) {
    pointInsights.push(`另有${highPoints.length}处高显著热点（置信度95-99%），属于中度聚集，建议在专项整治时一并处理。`);
  }

  if (hotspots.length > 0 && criticalPoints.length === 0) {
    pointInsights.push(`检测到的${hotspots.length}处热点均为一般显著水平，破损聚集程度可控。`);
    pointInsights.push('建议按破损严重度排序处理，优先修复影响通行安全的点位。');
  }

  // 【线】道路级诊断（需要配合 aggregateHotspotsByRoad 使用）
  const lineInsights: string[] = [];
  lineInsights.push('道路级分析需结合下方路段热点列表查看，Z值越高表示该路段破损聚集程度越严重。');

  // 维护建议
  const maintenanceSuggestions: string[] = [];
  if (areaHealthLevel === '严重' || areaHealthLevel === '较差') {
    maintenanceSuggestions.push('启动"重点路段专项整治"预案，协调交警部门做好交通疏导');
    maintenanceSuggestions.push('安排地勘单位对极显著热点区域进行地下病害排查');
    maintenanceSuggestions.push('储备足量沥青料、水泥稳定料等应急修复材料');
    maintenanceSuggestions.push('完成修复后建议3个月内安排复查，评估修复效果');
  } else if (areaHealthLevel === '一般') {
    maintenanceSuggestions.push('将热点区域纳入月度养护计划，按优先级逐步处理');
    maintenanceSuggestions.push('关注热点周边路段，预防病害扩散');
    maintenanceSuggestions.push('雨季前完成排水设施检查，减少水损风险');
  } else {
    maintenanceSuggestions.push('维持常规巡查频率，发现问题及时上报');
    maintenanceSuggestions.push('可将冷点区域的养护经验推广至其他路段');
  }

  // 生成摘要文本
  const summaryText = `该区域共${total}个上报点，其中${hotspots.length}处为破损热点（占${Math.round(hotRatio * 100)}%），` +
    `${coldspots.length}处为低破损冷点，${normal.length}处无显著聚集特征。` +
    `区域健康等级：${areaHealthLevel}（${areaHealthScore}分）。`;

  return {
    // 原有数据保留
    hotspotCount: hotspots.length,
    coldspotCount: coldspots.length,
    normalCount: normal.length,
    hotRatio,
    coldRatio,
    avgHotZ,
    maxZ,
    hotspots,
    coldspots,
    
    // 新增：面向用户的结构化分析
    areaHealthLevel,
    areaHealthScore,
    summaryText,
    
    // 三维度洞察
    insights: {
      area: areaInsights,      // 面（区域）
      point: pointInsights,    // 点（上报点）
      line: lineInsights       // 线（道路）
    },
    
    // 维护建议
    maintenanceSuggestions,
    
    // 兼容旧接口（扁平化 insights）
    legacyInsights: [...areaInsights, ...pointInsights.slice(0, 2)]
  };
};

/**
 * aggregateHotspotsByRoad
 * 将点级 Gi* 结果按 roadId 聚合。要求点 id 含路段前缀（例如 `${roadId}-${idx}`）或传入 mapping
 */
export const aggregateHotspotsByRoad = (
  giResults: ReturnType<typeof computeGetisOrdGi>
) => {
  const map: Record<string, { roadId: string; total: number; hotspotCount: number; coldspotCount: number; avgHotZ: number; zSum: number } > = {};

  for (const r of giResults) {
    if (!r || !r.id) continue;
    // 优先使用显式 roadId，其次从 id 解析（兼容 damage 点 id 中的自定义后缀）
    const idStr: string = String(r.id);
    let roadId = (r as any).roadId as string | undefined;
    if (!roadId) {
      // 先尝试去掉常见后缀（-d-xxx, _d_xxx, -p-xxx 等）
      const splitByDamage = idStr.split(/[-_]d[-_]/); // e.g. osm-1-d-123 -> ["osm-1", "123"]
      roadId = splitByDamage[0] || idStr;
      // 如果仍有尾部编号则剥离
      const m = roadId.match(/^(.+?)(?:[-_]\d+)?$/);
      roadId = m ? m[1] : roadId;
    }
    if (!map[roadId]) map[roadId] = { roadId, total: 0, hotspotCount: 0, coldspotCount: 0, avgHotZ: 0, zSum: 0 };
    map[roadId].total += 1;
    if (r.hotspotType === 'hotspot') {
      map[roadId].hotspotCount += 1;
      map[roadId].zSum += r.zScore;
    }
    if (r.hotspotType === 'coldspot') map[roadId].coldspotCount += 1;
  }

  const arr = Object.values(map).map(v => ({
    roadId: v.roadId,
    totalPoints: v.total,
    hotspotCount: v.hotspotCount,
    coldspotCount: v.coldspotCount,
    avgHotZ: v.hotspotCount > 0 ? v.zSum / v.hotspotCount : 0,
    hotRatio: v.hotspotCount / Math.max(1, v.total)
  }));

  // 排序：优先按 hotspotCount，再按 hotRatio
  arr.sort((a, b) => (b.hotspotCount - a.hotspotCount) || (b.hotRatio - a.hotRatio));

  return arr;
};


/**
 * computeKernelDensity
 * 基于点数据生成规则网格并计算每个格子的密度值（高斯核）
 */
export const computeKernelDensity = (
  points: DamagePoint[],
  options?: {
    bandwidthMeters?: number;
    cellSizeMeters?: number;
    bbox?: [number, number, number, number];
    normalize?: boolean;
    maxCells?: number;
  }
) => {
  const bandwidth = options?.bandwidthMeters ?? 100; // meters
  let cellSize = options?.cellSizeMeters ?? 50; // meters
  const normalize = options?.normalize ?? true;
  const maxCells = options?.maxCells ?? 5000;

  if (points.length === 0) return { cells: [], bbox: null };

  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);

  if (options?.bbox) {
    [minLng, minLat, maxLng, maxLat] = options.bbox;
  } else {
    const pad = 0.001;
    minLat -= pad;
    maxLat += pad;
    minLng -= pad;
    maxLng += pad;
  }

  const meanLat = (minLat + maxLat) / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(meanLat * Math.PI / 180);

  let dLat = cellSize / metersPerDegLat;
  let dLng = cellSize / metersPerDegLng;
  let rows = Math.ceil((maxLat - minLat) / dLat);
  let cols = Math.ceil((maxLng - minLng) / dLng);

  while (rows * cols > maxCells) {
    cellSize *= 1.5;
    dLat = cellSize / metersPerDegLat;
    dLng = cellSize / metersPerDegLng;
    rows = Math.ceil((maxLat - minLat) / dLat);
    cols = Math.ceil((maxLng - minLng) / dLng);
  }

  const cells: { lat: number; lng: number; value: number }[] = [];
  const h = bandwidth;
  const twoHSq = 2 * h * h;

  for (let r = 0; r < rows; r++) {
    const lat = minLat + (r + 0.5) * dLat;
    for (let c = 0; c < cols; c++) {
      const lng = minLng + (c + 0.5) * dLng;
      let density = 0;
      for (const p of points) {
        const d = haversineDistance(lat, lng, p.lat, p.lng);
        density += (typeof p.value === 'number' ? p.value : 1) * Math.exp(-(d * d) / twoHSq);
      }
      cells.push({ lat, lng, value: density });
    }
  }

  let maxVal = 0;
  for (const cell of cells) if (cell.value > maxVal) maxVal = cell.value;

  if (normalize && maxVal > 0) {
    for (const cell of cells) cell.value = cell.value / maxVal;
    maxVal = 1; // 归一化后最大值恒为 1
  }

  const result = {
    cells,
    bbox: [minLng, minLat, maxLng, maxLat],
    grid: { rows, cols, cellSizeMeters: cellSize },
    maxValue: maxVal
  };

  // 可将 cells 转为 GeoJSON（点集合），便于前端渲染或导出
  const toGeoJSON = () => {
    return {
      type: 'FeatureCollection',
      features: cells.map(cell => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [cell.lng, cell.lat] },
        properties: { value: cell.value }
      }))
    };
  };

  return { ...result, toGeoJSON };
};



/**
 * analyzeLaneSummary
 * 针对单条道路的深度分析：不仅统计，更诊断风险与优先级
 */
export const analyzeLaneSummary = (lane: {
  coordinates: { lat: number; lng: number }[];
  condition?: string;
  roadName?: string;
  damagePoints?: DamagePoint[]; // ← 新增：该路段上的破损点（可选但推荐）
}) => {
  const coords = Array.isArray(lane.coordinates) ? lane.coordinates : [];
  let length = 0;
  for (let i = 1; i < coords.length; i++) {
    length += haversineDistance(coords[i - 1].lat, coords[i - 1].lng, coords[i].lat, coords[i].lng);
  }
  const numPoints = coords.length;
  const density = length > 0 ? numPoints / (length / 1000) : 0; // points/km

  // 如果提供了 damagePoints，则用它计算破损密度（更准确）
  const damagePoints = lane.damagePoints || [];
  const damageDensity = length > 0 ? damagePoints.length / (length / 1000) : 0;
  const avgSeverity = damagePoints.length
    ? damagePoints.reduce((sum, p) => sum + (p.value || 1), 0) / damagePoints.length
    : 0;

  const cond = lane.condition || '未知';
  const suggestions: string[] = [];
  let urgency: 'low' | 'medium' | 'high' | 'critical' = 'low';

  // === 智能诊断逻辑 ===
  if (cond === 'Poor' || avgSeverity > 2.5) {
    urgency = 'high';
    suggestions.push('存在明显结构性损坏，建议7–15日内安排应急处理。');
  } else if (cond === 'Fair' || (damageDensity > 10 && avgSeverity > 1.5)) {
    urgency = 'medium';
    suggestions.push('存在中度病害，建议1–3个月内纳入养护计划。');
  } else if (cond === 'Good' || damageDensity < 5) {
    urgency = 'low';
    suggestions.push('路况良好，维持常规巡查即可。');
  } else {
    urgency = 'medium';
    suggestions.push('状态不明，建议结合现场破损点进行人工核查。');
  }

  // 高密度破损预警（即使 condition=Good）
  if (damageDensity > 20) {
    suggestions.push('破损点异常密集（>20点/km），可能存在未记录的严重病害，建议重点核查。');
    if (urgency === 'low') urgency = 'medium';
  }

  // 短路段高密度 → 高风险
  if (length < 200 && damageDensity > 15) {
    suggestions.push('短距离内破损集中，易引发安全事故，建议优先处理。');
    urgency = 'high';
  }

  // 输出摘要（用于显示）
  const summary = `道路：${lane.roadName || '未知'}（${(length / 1000).toFixed(2)} km）`;

  return {
    lengthMeters: length,
    numPoints,
    densityPerKm: density,
    damageDensityPerKm: damageDensity, // ← 新增
    avgSeverity,                      // ← 新增
    condition: cond,
    urgency,                          // ← 新增：维修紧迫性
    suggestions,
    summary
  };
};