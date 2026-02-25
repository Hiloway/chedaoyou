import { db } from './db';

export async function getRoadCondition(road_id: string) {
  const [rows] = await db.query('SELECT * FROM road_condition WHERE road_id = ?', [road_id]);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export async function addOrUpdateRoadCondition(data: any) {
  // 如果已存在则更新，否则插入
  const sql = `
    INSERT INTO road_condition (
      road_id, condition, description, damage_type, severity, reporter_id, reporter_name,
       road_name, notes, attachment_urls, is_verified, verified_by, verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      condition = VALUES(condition),
      description = VALUES(description),
      damage_type = VALUES(damage_type),
      severity = VALUES(severity),
      reporter_id = VALUES(reporter_id),
      reporter_name = VALUES(reporter_name),
      road_name = VALUES(road_name),
      notes = VALUES(notes),
      attachment_urls = VALUES(attachment_urls),
      is_verified = VALUES(is_verified),
      verified_by = VALUES(verified_by),
      verified_at = VALUES(verified_at),
      updated_at = NOW()
  `;
  
  const params = [
    data.road_id, data.condition, data.description, data.damage_type, data.severity, data.reporter_id, data.reporter_name,
    data.lat, data.lng, data.road_name, data.notes, JSON.stringify(data.attachment_urls || []), data.is_verified, data.verified_by, data.verified_at
  ];
  await db.query(sql, params);
}

export async function listRoadConditions() {
  const [rows] = await db.query('SELECT * FROM road_condition');
  return rows;
}