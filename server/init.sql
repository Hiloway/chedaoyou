-- ============================================================
-- 车道优系统 数据库初始化脚本
-- 数据库：MySQL 8.0+   字符集：utf8mb4
-- 使用：mysql -u root -p road_conditions < init.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS `road_conditions` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `road_conditions`;

-- ------------------------------------------------------------
-- 1. 路况主表：存储每条道路的当前路况与工作流状态
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `road_conditions` (
  `road_id` VARCHAR(191) NOT NULL,
  `condition` VARCHAR(32) DEFAULT NULL COMMENT 'Excellent/Good/Fair/Poor/InRepair/未知',
  `workflow_status` VARCHAR(32) DEFAULT NULL COMMENT 'reported/assigned/in_repair/awaiting_acceptance/completed',
  `workflow_updated_at` DATETIME DEFAULT NULL,
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
  PRIMARY KEY (`road_id`),
  INDEX `idx_workflow_status` (`workflow_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 2. 工作流流转历史：记录每次状态变更
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `road_condition_transitions` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `road_id` VARCHAR(191) NOT NULL,
  `from_status` VARCHAR(32) DEFAULT NULL,
  `to_status` VARCHAR(32) DEFAULT NULL,
  `action` VARCHAR(64) DEFAULT NULL,
  `actor_role` VARCHAR(32) DEFAULT NULL,
  `actor_name` VARCHAR(128) DEFAULT NULL,
  `note` TEXT DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_road_id_created_at` (`road_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 3. 维修报告：维修方提交的正式报告
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `repair_reports` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `road_id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(512) DEFAULT NULL,
  `start_stake` VARCHAR(64) DEFAULT NULL,
  `end_stake` VARCHAR(64) DEFAULT NULL,
  `background` TEXT DEFAULT NULL,
  `detection` TEXT DEFAULT NULL,
  `core_plan` TEXT DEFAULT NULL,
  `materials` TEXT DEFAULT NULL,
  `budget` TEXT DEFAULT NULL,
  `schedule` TEXT DEFAULT NULL,
  `conclusion` TEXT DEFAULT NULL,
  `organization` VARCHAR(255) DEFAULT NULL,
  `report_date` DATE DEFAULT NULL,
  `contact` VARCHAR(255) DEFAULT NULL,
  `attachment_urls` JSON DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_road_id` (`road_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 4. 用户上报消息：路况上报、破损点、消息盒子
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `messages` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `road_id` VARCHAR(191) DEFAULT NULL,
  `type` VARCHAR(32) NOT NULL DEFAULT 'user',
  `name` VARCHAR(255) DEFAULT NULL,
  `contact` VARCHAR(255) DEFAULT NULL,
  `text` TEXT DEFAULT NULL,
  `photo_urls` JSON DEFAULT NULL,
  `lat` DOUBLE DEFAULT NULL,
  `lng` DOUBLE DEFAULT NULL,
  `assigned_to` VARCHAR(128) DEFAULT NULL,
  `is_read` TINYINT(1) DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_is_read_created_at` (`is_read`, `created_at`),
  INDEX `idx_created_at` (`created_at`),
  INDEX `idx_road_id` (`road_id`),
  INDEX `idx_assigned_to` (`assigned_to`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 5. 账号表：统一登录账号（admin/maintainer/user 三种角色）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `accounts` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(128) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) DEFAULT NULL,
  `role` ENUM('admin','maintainer','user') NOT NULL DEFAULT 'user',
  `reset_token` VARCHAR(255) DEFAULT NULL,
  `reset_expires` DATETIME DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 6. 管理员扩展信息
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admins` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `account_id` BIGINT NOT NULL,
  `full_name` VARCHAR(255) DEFAULT NULL,
  `contact_phone` VARCHAR(64) DEFAULT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `organization` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 7. 维修方扩展信息
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `maintainers` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `account_id` BIGINT NOT NULL,
  `organization` VARCHAR(255) DEFAULT NULL,
  `contact_person` VARCHAR(255) DEFAULT NULL,
  `phone` VARCHAR(64) DEFAULT NULL,
  `license_no` VARCHAR(128) DEFAULT NULL,
  `service_area` TEXT DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 8. 普通用户扩展信息
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `account_id` BIGINT NOT NULL,
  `full_name` VARCHAR(255) DEFAULT NULL,
  `contact_phone` VARCHAR(64) DEFAULT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `address` TEXT DEFAULT NULL,
  `metadata` JSON DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
