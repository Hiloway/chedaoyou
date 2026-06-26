/**
 * ai.cjs - AI 代理路由
 * 前端不再直调 DeepSeek/千问，统一走后端代理，避免 API Key 暴露
 * 提供三个接口：
 *   POST /api/ai/analyze-lane        路况文本分析（DeepSeek）
 *   POST /api/ai/analyze-damage      病害照片诊断（千问 VL）
 *   POST /api/ai/chat                助手对话（DeepSeek）
 */
const express = require('express');
const { AI_CONFIG } = require('../config');

const router = express.Router();

// 懒加载 OpenAI SDK（保持与原前端调用方式一致）
let _openai = null;
let _qwenVision = null;
async function getClients() {
  if (!_openai && AI_CONFIG.deepseek.apiKey) {
    const { default: OpenAI } = await import('openai');
    _openai = new OpenAI({
      apiKey: AI_CONFIG.deepseek.apiKey,
      baseURL: AI_CONFIG.deepseek.baseURL,
    });
  }
  if (!_qwenVision && AI_CONFIG.qwen.apiKey) {
    const { default: OpenAI } = await import('openai');
    _qwenVision = new OpenAI({
      apiKey: AI_CONFIG.qwen.apiKey,
      baseURL: AI_CONFIG.qwen.baseURL,
    });
  }
  return { openai: _openai, qwenVision: _qwenVision };
}

// 清理可能的 markdown 代码块
const cleanJsonResponse = (content) => String(content || '').replace(/```json\n?|\n?```/g, '').trim();

// POST /api/ai/analyze-lane - 路况分析
router.post('/api/ai/analyze-lane', async (req, res) => {
  const { openai } = await getClients();
  if (!openai) return res.status(503).json({ message: 'AI 服务未配置（缺少 DEEPSEEK_API_KEY）' });

  try {
    const { laneData } = req.body || {};
    if (!laneData) return res.status(400).json({ message: 'laneData required' });

    const prompt = buildLaneAnalysisPrompt(laneData);
    const completion = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: '你是一名具有 15 年经验的道路工程师和交通规划专家。请分析路况数据并给出专业的 JSON 评估结果，不要输出多余文字。' },
        { role: 'user', content: prompt },
      ],
      model: AI_CONFIG.deepseek.model,
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return res.status(502).json({ message: '未收到响应内容' });

    const result = JSON.parse(cleanJsonResponse(content));
    return res.json({
      safety: { status: result.safety?.status || '未知', risks: result.safety?.risks || '暂无风险' },
      insights: { capacity: result.insights?.capacity || '通行能力待评估', standard: result.insights?.standard || '合规性待评估' },
      suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
    });
  } catch (err) {
    console.error('POST /api/ai/analyze-lane error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'AI 分析失败' });
  }
});

// POST /api/ai/analyze-damage - 病害照片诊断
router.post('/api/ai/analyze-damage', async (req, res) => {
  const { qwenVision } = await getClients();
  if (!qwenVision) return res.status(503).json({ message: '视觉 AI 服务未配置（缺少 QWEN_API_KEY）' });

  try {
    const { photoUrl, roadName, locationText } = req.body || {};
    if (!photoUrl) return res.status(400).json({ message: 'photoUrl required' });

    const messages = [
      {
        role: 'system',
        content: '你是一名具有 15 年经验的道路病害诊断高级工程师。请结合图片和上下文，对路面病害进行专业定性、严重度评估，并给出详细的维修材料与工艺方案、养护建议及通行管控方案。务必返回 JSON，不要输出多余文字。',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildDamageAnalysisPrompt({ roadName, locationText }),
          },
          { type: 'image_url', image_url: { url: photoUrl } },
        ],
      },
    ];

    const completion = await qwenVision.chat.completions.create({
      messages,
      model: AI_CONFIG.qwen.model,
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return res.status(502).json({ message: '未收到模型响应' });
    const data = JSON.parse(cleanJsonResponse(content));
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('POST /api/ai/analyze-damage error:', err?.response || err);
    const msg = err?.response?.data?.error?.message || err?.message || '分析失败';
    return res.status(500).json({ message: msg });
  }
});

// POST /api/ai/chat - 助手对话
router.post('/api/ai/chat', async (req, res) => {
  const { openai } = await getClients();
  if (!openai) return res.status(503).json({ message: 'AI 服务未配置（缺少 DEEPSEEK_API_KEY）' });

  try {
    const { history = [], message } = req.body || {};
    if (!message) return res.status(400).json({ message: 'message required' });

    const messages = [
      {
        role: 'system',
        content: '你是一位精通 WebGIS 和交通工程的专家助手。请以专业、简洁的方式回答用户问题。请不要使用 Markdown 符号（如 #、*、- 等）。请直接使用清晰的标题行、换行和空格来组织内容。',
      },
      ...history.map(msg => ({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content })),
      { role: 'user', content: message },
    ];

    const completion = await openai.chat.completions.create({
      messages,
      model: AI_CONFIG.deepseek.model,
      temperature: 0.7,
    });

    return res.json({ ok: true, content: completion.choices[0]?.message?.content || '抱歉，未能生成回复。' });
  } catch (err) {
    console.error('POST /api/ai/chat error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'AI 对话失败' });
  }
});

// ---------- Prompt 构建 ----------

function buildLaneAnalysisPrompt(laneData) {
  return `请分析以下车道数据并输出详细 JSON：
{
  "safety": { "status": "安全/一般/风险", "risks": "风险描述" },
  "insights": { "capacity": "通行能力分析", "standard": "合规性分析" },
  "suggestions": ["改进建议1", "改进建议2", "改进建议3"]
}

车道信息：
- 道路名称: ${laneData.roadName || '未知'}
- 车道数: ${laneData.laneCount || '未知'}
- 宽度: ${laneData.width || '未知'} 米
- 路况: ${laneData.condition || '未知'}
- 类型: ${laneData.type || '未知'}
- 方向: ${laneData.direction || '未知'}
- 最后更新: ${laneData.lastUpdated || '未知'}
- 坐标点数: ${laneData.coordinates?.length || 0}

请基于以上信息给出专业的 JSON 评估。`;
}

function buildDamageAnalysisPrompt({ roadName, locationText }) {
  return `请针对这张道路病害照片输出详细分析 JSON，字段如下：
{
  "damage_type": "病害类型（横向裂缝/纵向裂缝/网裂/坑槽/松散/沉陷/车辙/破碎/泛油/其他）",
  "severity": "轻微/中等/严重",
  "severity_score": 1-10的数值评分,
  "dimensions": {
    "estimated_length": "估算长度，如 2-3m",
    "estimated_width": "估算宽度，如 5-10mm",
    "estimated_depth": "估算深度，如 3-5cm（坑槽适用）",
    "estimated_area": "估算影响面积，如 0.5m²"
  },
  "cause_analysis": {
    "primary_cause": "主要成因，如基层失稳/温缩/荷载疲劳/排水不良/施工缺陷",
    "contributing_factors": ["次要因素1", "次要因素2"],
    "progression_risk": "恶化风险说明"
  },
  "maintenance": {
    "actions": ["具体维修步骤1", "具体维修步骤2", "步骤3"],
    "urgency": "立即/短期(7天内)/中期(1-3月)/低优先级",
    "technique": "推荐工艺名称，如灌缝/热补/铣刨罩面/微表处",
    "materials": [
      {"name": "材料名称", "spec": "规格/型号", "usage": "用途说明", "unit_amount": "每平方米/每延米用量"}
    ],
    "equipment": ["所需设备1", "所需设备2"],
    "estimated_cost": "估算单位维修费用范围，如 80-120元/m²",
    "work_duration": "估算施工工期，如 2-4小时",
    "quality_standard": "验收标准说明"
  },
  "traffic": {
    "impact": "对通行影响描述",
    "risk_level": "高/中/低",
    "advice": "交通组织建议",
    "speed_limit": "建议限速值，如30km/h",
    "closure_needed": true或false
  },
  "lane_care_tips": ["日常养护建议1（面向养护人员）", "预防性措施2", "长期维护建议3"],
  "reasoning": "判断依据详细说明",
  "highlight_regions": [{"label": "病害区域说明", "description": "该区域的详细特征描述"}]
}
道路名: ${roadName || '未知'}
位置: ${locationText || '未知'}
注意：请基于图片内容给出尽可能准确的分析，确保所有字段都有值。`;
}

module.exports = router;
