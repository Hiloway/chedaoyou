-- road_conditions 表，用于存储用户/维修方上报和编辑的路况信息
CREATE TABLE IF NOT EXISTS `road_conditions` (
  `road_id` VARCHAR(191) NOT NULL,
  `condition` VARCHAR(32) DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `damage_type` VARCHAR(128) DEFAULT NULL,
  `severity` VARCHAR(64) DEFAULT NULL,
  `reporter_id` VARCHAR(128) DEFAULT NULL,
  `reporter_name` VARCHAR(128) DEFAULT NULL,
  `road_name` VARCHAR(255) DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `attachment_urls` JSON DEFAULT NULL,
  `is_verified` TINYINT(1) DEFAULT 0,
  `verified_by` VARCHAR(128) DEFAULT NULL,
  `verified_at` DATETIME DEFAULT NULL,
  `last_updated` DATE DEFAULT NULL,
  PRIMARY KEY (`road_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 使用：在 MySQL 中运行本文件以初始化表
