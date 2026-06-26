/**
 * schema.cjs - 数据库建表与迁移
 * 启动时自动确保所有表存在，替代原先散落在 index.cjs 里的建表逻辑
 */
const { pool } = require('./config');

// 全部建表语句，与 init.sql 保持一致
const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`road_conditions\` (
    \`road_id\` VARCHAR(191) NOT NULL,
    \`condition\` VARCHAR(32) DEFAULT NULL,
    \`workflow_status\` VARCHAR(32) DEFAULT NULL,
    \`workflow_updated_at\` DATETIME DEFAULT NULL,
    \`description\` TEXT DEFAULT NULL,
    \`damage_type\` VARCHAR(128) DEFAULT NULL,
    \`severity\` VARCHAR(64) DEFAULT NULL,
    \`reporter_id\` VARCHAR(128) DEFAULT NULL,
    \`reporter_name\` VARCHAR(128) DEFAULT NULL,
    \`road_name\` VARCHAR(255) DEFAULT NULL,
    \`notes\` TEXT DEFAULT NULL,
    \`attachment_urls\` JSON DEFAULT NULL,
    \`is_verified\` TINYINT(1) DEFAULT 0,
    \`verified_by\` VARCHAR(128) DEFAULT NULL,
    \`verified_at\` DATETIME DEFAULT NULL,
    \`last_updated\` DATE DEFAULT NULL,
    PRIMARY KEY (\`road_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS \`road_condition_transitions\` (
    \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
    \`road_id\` VARCHAR(191) NOT NULL,
    \`from_status\` VARCHAR(32) DEFAULT NULL,
    \`to_status\` VARCHAR(32) DEFAULT NULL,
    \`action\` VARCHAR(64) DEFAULT NULL,
    \`actor_role\` VARCHAR(32) DEFAULT NULL,
    \`actor_name\` VARCHAR(128) DEFAULT NULL,
    \`note\` TEXT DEFAULT NULL,
    \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX \`idx_road_id_created_at\` (\`road_id\`, \`created_at\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS \`repair_reports\` (
    \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
    \`road_id\` VARCHAR(191) NOT NULL,
    \`title\` VARCHAR(512) DEFAULT NULL,
    \`start_stake\` VARCHAR(64) DEFAULT NULL,
    \`end_stake\` VARCHAR(64) DEFAULT NULL,
    \`background\` TEXT DEFAULT NULL,
    \`detection\` TEXT DEFAULT NULL,
    \`core_plan\` TEXT DEFAULT NULL,
    \`materials\` TEXT DEFAULT NULL,
    \`budget\` TEXT DEFAULT NULL,
    \`schedule\` TEXT DEFAULT NULL,
    \`conclusion\` TEXT DEFAULT NULL,
    \`organization\` VARCHAR(255) DEFAULT NULL,
    \`report_date\` DATE DEFAULT NULL,
    \`contact\` VARCHAR(255) DEFAULT NULL,
    \`attachment_urls\` JSON DEFAULT NULL,
    \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS \`messages\` (
    \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
    \`road_id\` VARCHAR(191) DEFAULT NULL,
    \`type\` VARCHAR(32) NOT NULL DEFAULT 'user',
    \`name\` VARCHAR(255) DEFAULT NULL,
    \`contact\` VARCHAR(255) DEFAULT NULL,
    \`text\` TEXT DEFAULT NULL,
    \`photo_urls\` JSON DEFAULT NULL,
    \`lat\` DOUBLE DEFAULT NULL,
    \`lng\` DOUBLE DEFAULT NULL,
    \`is_read\` TINYINT(1) DEFAULT 0,
    \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS \`accounts\` (
    \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
    \`username\` VARCHAR(128) NOT NULL UNIQUE,
    \`password_hash\` VARCHAR(255) DEFAULT NULL,
    \`role\` ENUM('admin','maintainer','user') NOT NULL DEFAULT 'user',
    \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS \`maintainers\` (
    \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
    \`account_id\` BIGINT NOT NULL,
    \`organization\` VARCHAR(255) DEFAULT NULL,
    \`contact_person\` VARCHAR(255) DEFAULT NULL,
    \`phone\` VARCHAR(64) DEFAULT NULL,
    \`license_no\` VARCHAR(128) DEFAULT NULL,
    \`service_area\` TEXT DEFAULT NULL,
    \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\`(\`id\`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS \`admins\` (
    \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
    \`account_id\` BIGINT NOT NULL,
    \`full_name\` VARCHAR(255) DEFAULT NULL,
    \`contact_phone\` VARCHAR(64) DEFAULT NULL,
    \`email\` VARCHAR(255) DEFAULT NULL,
    \`organization\` VARCHAR(255) DEFAULT NULL,
    \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\`(\`id\`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS \`users\` (
    \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
    \`account_id\` BIGINT NOT NULL,
    \`full_name\` VARCHAR(255) DEFAULT NULL,
    \`contact_phone\` VARCHAR(64) DEFAULT NULL,
    \`email\` VARCHAR(255) DEFAULT NULL,
    \`address\` TEXT DEFAULT NULL,
    \`metadata\` JSON DEFAULT NULL,
    \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\`(\`id\`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
];

// 增量迁移：尝试添加后期新增的字段与索引（已存在则忽略）
const ALTER_STATEMENTS = [
  'ALTER TABLE road_conditions ADD COLUMN workflow_status VARCHAR(32) DEFAULT NULL',
  'ALTER TABLE road_conditions ADD COLUMN workflow_updated_at DATETIME DEFAULT NULL',
  'ALTER TABLE road_conditions ADD INDEX idx_workflow_status (workflow_status)',
  'ALTER TABLE messages ADD INDEX idx_is_read_created_at (is_read, created_at)',
  'ALTER TABLE messages ADD INDEX idx_created_at (created_at)',
  'ALTER TABLE messages ADD INDEX idx_road_id (road_id)',
  'ALTER TABLE messages ADD COLUMN assigned_to VARCHAR(128) DEFAULT NULL',
  'ALTER TABLE messages ADD INDEX idx_assigned_to (assigned_to)',
  'ALTER TABLE accounts ADD COLUMN reset_token VARCHAR(255) DEFAULT NULL',
  'ALTER TABLE accounts ADD COLUMN reset_expires DATETIME DEFAULT NULL',
];

const ensureSchema = async () => {
  for (const sql of CREATE_STATEMENTS) {
    try {
      await pool.query(sql);
    } catch (err) {
      console.error('[schema] 建表失败:', err.message);
    }
  }
  for (const sql of ALTER_STATEMENTS) {
    try {
      await pool.query(sql);
    } catch (err) {
      // 字段/索引已存在则忽略
    }
  }
  console.log('[schema] 数据库表结构已就绪');
};

module.exports = { ensureSchema, CREATE_STATEMENTS, ALTER_STATEMENTS };
