/**
 * deepseekService.ts - AI 服务
 * 已改造为走后端代理（/api/ai/*），不再在前端直调 DeepSeek/千问，避免 API Key 泄露
 * 对外接口签名保持不变，调用方无需改动
 */
import { aiApi } from './api';

/**
 * 路况分析（DeepSeek）
 * @returns 结构化分析结果，失败返回 null
 */
export const analyzeLaneData = async (laneData: any) => {
  try {
    return await aiApi.analyzeLane(laneData);
  } catch (error) {
    console.error('analyzeLaneData 调用失败:', error);
    return null;
  }
};

/**
 * 病害照片诊断（千问 VL）
 * @returns { data?: any; error?: string }
 */
export const analyzeDamagePhoto = async (
  photoUrl: string,
  meta?: { roadName?: string; locationText?: string }
): Promise<{ data?: any; error?: string }> => {
  try {
    const resp = await aiApi.analyzeDamage(photoUrl, meta);
    return { data: resp.data };
  } catch (err: any) {
    console.error('analyzeDamagePhoto 失败:', err);
    return { error: err?.message || '分析失败' };
  }
};

/**
 * 助手对话（DeepSeek）
 * @returns 回复文本
 */
export const chatWithAssistant = async (
  history: { role: string; content: string }[],
  message: string
): Promise<string> => {
  try {
    const resp = await aiApi.chat(history, message);
    return resp.content;
  } catch (error) {
    console.error('聊天 API 调用失败:', error);
    return '抱歉，暂时无法回答问题，请稍后再试。';
  }
};
