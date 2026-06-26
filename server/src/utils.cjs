/**
 * utils.cjs - 通用工具函数（normalize / 时间格式化等）
 */

const normalizeText = (value, maxLen = 255) => {
  if (value === undefined || value === null) return null;
  return String(value).trim().slice(0, maxLen) || null;
};

const VALID_CONDITIONS = new Set(['Excellent', 'Good', 'Fair', 'Poor', 'InRepair', '未知']);
const FINAL_CONDITIONS = new Set(['Excellent', 'Good', 'Fair', 'Poor']);

const normalizeCondition = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  return VALID_CONDITIONS.has(normalized) ? normalized : null;
};

const normalizeWorkflowStatus = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return Object.values(require('./workflow').WORKFLOW_STATUS).includes(normalized) ? normalized : null;
};

const normalizeWorkflowAction = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return require('./workflow').WORKFLOW_ACTIONS.has(normalized) ? normalized : null;
};

const normalizeAttachmentForDb = (incoming, fallback) => {
  if (incoming !== undefined) return JSON.stringify(Array.isArray(incoming) ? incoming : []);
  if (fallback === undefined || fallback === null) return JSON.stringify([]);
  if (typeof fallback === 'string') return fallback;
  return JSON.stringify(fallback);
};

const toMysqlDateTimeOrNull = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

const toMysqlDateOrNow = (value) => {
  if (!value) return new Date();
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return new Date();
  return d;
};

module.exports = {
  normalizeText,
  normalizeCondition,
  normalizeWorkflowStatus,
  normalizeWorkflowAction,
  normalizeAttachmentForDb,
  toMysqlDateTimeOrNull,
  toMysqlDateOrNow,
  VALID_CONDITIONS,
  FINAL_CONDITIONS,
};
