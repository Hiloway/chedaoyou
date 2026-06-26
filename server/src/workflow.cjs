/**
 * workflow.cjs - 路况工作流状态机
 * 集中管理状态常量、动作集合与状态流转规则
 */

const WORKFLOW_STATUS = {
  REPORTED: 'reported',
  ASSIGNED: 'assigned',
  IN_REPAIR: 'in_repair',
  AWAITING_ACCEPTANCE: 'awaiting_acceptance',
  COMPLETED: 'completed',
};

const WORKFLOW_ACTIONS = new Set([
  'report_issue',
  'assign_repair',
  'confirm_in_repair',
  'request_completion',
  'approve_completion',
  'reopen_issue',
  'manual_override',
]);

const FINAL_CONDITIONS = new Set(['Excellent', 'Good', 'Fair', 'Poor']);

const deriveStatusFromCondition = (condition, currentStatus = null) => {
  if (!condition) return currentStatus;
  if (condition === 'InRepair') return WORKFLOW_STATUS.IN_REPAIR;
  if (condition === 'Excellent' || condition === 'Good') return WORKFLOW_STATUS.COMPLETED;
  if (condition === 'Fair' || condition === 'Poor') return WORKFLOW_STATUS.REPORTED;
  return currentStatus;
};

const canTransit = (currentStatus, allowedFrom) => {
  if (!Array.isArray(allowedFrom) || allowedFrom.length === 0) return true;
  return allowedFrom.includes(currentStatus || null);
};

/**
 * 解析状态流转
 * @returns {{ ok: boolean, code?: string, message?: string, nextStatus: string|null, condition: string|null }}
 */
const resolveTransition = ({ currentStatus, action, condition }) => {
  if (!action) {
    if (!condition) return { ok: true, nextStatus: currentStatus || null, condition: null };
    if (condition === 'InRepair') {
      return { ok: true, nextStatus: WORKFLOW_STATUS.IN_REPAIR, condition: 'InRepair' };
    }
    if (FINAL_CONDITIONS.has(condition) && (currentStatus === WORKFLOW_STATUS.IN_REPAIR || currentStatus === WORKFLOW_STATUS.AWAITING_ACCEPTANCE)) {
      return { ok: true, nextStatus: WORKFLOW_STATUS.COMPLETED, condition };
    }
    return { ok: true, nextStatus: deriveStatusFromCondition(condition, currentStatus), condition };
  }

  if (action === 'report_issue') {
    return { ok: true, nextStatus: WORKFLOW_STATUS.REPORTED, condition };
  }

  if (action === 'assign_repair') {
    const allowedFrom = [null, WORKFLOW_STATUS.REPORTED, WORKFLOW_STATUS.COMPLETED];
    if (!canTransit(currentStatus, allowedFrom)) {
      return { ok: false, code: 'INVALID_TRANSITION', message: `当前状态 ${currentStatus || 'none'} 不能执行 assign_repair` };
    }
    return { ok: true, nextStatus: WORKFLOW_STATUS.ASSIGNED, condition };
  }

  if (action === 'confirm_in_repair') {
    const allowedFrom = [null, WORKFLOW_STATUS.REPORTED, WORKFLOW_STATUS.ASSIGNED, WORKFLOW_STATUS.AWAITING_ACCEPTANCE];
    if (!canTransit(currentStatus, allowedFrom)) {
      return { ok: false, code: 'INVALID_TRANSITION', message: `当前状态 ${currentStatus || 'none'} 不能执行 confirm_in_repair` };
    }
    return { ok: true, nextStatus: WORKFLOW_STATUS.IN_REPAIR, condition: 'InRepair' };
  }

  if (action === 'request_completion') {
    const allowedFrom = [WORKFLOW_STATUS.IN_REPAIR, WORKFLOW_STATUS.AWAITING_ACCEPTANCE];
    if (!canTransit(currentStatus, allowedFrom)) {
      return { ok: false, code: 'INVALID_TRANSITION', message: `当前状态 ${currentStatus || 'none'} 不能执行 request_completion` };
    }
    return { ok: true, nextStatus: WORKFLOW_STATUS.AWAITING_ACCEPTANCE, condition: 'InRepair' };
  }

  if (action === 'approve_completion') {
    const allowedFrom = [WORKFLOW_STATUS.IN_REPAIR, WORKFLOW_STATUS.AWAITING_ACCEPTANCE];
    if (!canTransit(currentStatus, allowedFrom)) {
      return { ok: false, code: 'INVALID_TRANSITION', message: `当前状态 ${currentStatus || 'none'} 不能执行 approve_completion` };
    }
    const finalCondition = condition && FINAL_CONDITIONS.has(condition) ? condition : null;
    if (!finalCondition) {
      return { ok: false, code: 'FINAL_CONDITION_REQUIRED', message: 'approve_completion 需要设置最终路况（Excellent/Good/Fair/Poor）' };
    }
    return { ok: true, nextStatus: WORKFLOW_STATUS.COMPLETED, condition: finalCondition };
  }

  if (action === 'reopen_issue') {
    return { ok: true, nextStatus: WORKFLOW_STATUS.REPORTED, condition: condition || 'Poor' };
  }

  if (action === 'manual_override') {
    const nextStatus = deriveStatusFromCondition(condition, currentStatus);
    return { ok: true, nextStatus, condition };
  }

  return { ok: false, code: 'INVALID_ACTION', message: `不支持的 workflow_action: ${action}` };
};

module.exports = {
  WORKFLOW_STATUS,
  WORKFLOW_ACTIONS,
  FINAL_CONDITIONS,
  deriveStatusFromCondition,
  canTransit,
  resolveTransition,
};
