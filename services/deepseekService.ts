import OpenAI from "openai";
import { LaneInfo } from "../types";

// DeepSeek（文本）
const API_KEY = import.meta.env?.VITE_DEEPSEEK_API_KEY;
const openai = API_KEY
  ? new OpenAI({ baseURL: 'https://api.deepseek.com', apiKey: API_KEY, dangerouslyAllowBrowser: true })
  : null;

// 千问视觉（阿里 DashScope 兼容模式）
const QWEN_KEY = import.meta.env?.VITE_QWEN_API_KEY;
const QWEN_BASE = import.meta.env?.VITE_QWEN_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const qwenVision = QWEN_KEY
  ? new OpenAI({ apiKey: QWEN_KEY, baseURL: QWEN_BASE, dangerouslyAllowBrowser: true })
  : null;

export const analyzeLaneData = async (lane: LaneInfo): Promise<any> => {
  try {
    const prompt = `你是一位资深的交通规划专家。请对以下车道数据进行深度分析，并严格按照指定的 JSON 格式输出：

道路信息：
- 道路名称：${lane.roadName}
- 车道数量：${lane.laneCount}车道
- 道路宽度：${lane.width}米
- 道路状态：${lane.condition}
- 方向：${lane.direction}

请分析以下内容：
1. 安全等级和风险点
2. 通行能力和合规性分析
3. 优化建议

返回格式必须是有效的 JSON 对象：
{
  "safety": {
    "status": "安全等级描述",
    "risks": "潜在风险点"
  },
  "insights": {
    "capacity": "通行能力分析",
    "standard": "合规性分析"
  },
  "suggestions": ["建议1", "建议2", "建议3"]
}`;

    const completion = await openai.chat.completions.create({
      messages: [
        { 
          role: "system", 
          content: "你是一位资深的交通规划专家。请严格按照指定的 JSON 格式输出分析结果，不要添加任何额外的文本说明。" 
        },
        { role: "user", content: prompt }
      ],
      model: "deepseek-chat",
      response_format: { type: "json_object" }, // 确保返回 JSON 格式
      temperature: 0.7,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      console.error("未收到响应内容");
      return null;
    }

    // 清理可能的 markdown 代码块
    const cleanedContent = content.replace(/```json\n?|\n?```/g, '').trim();
    
    try {
      const result = JSON.parse(cleanedContent);
      
      // 确保返回结构一致
      return {
        safety: {
          status: result.safety?.status || "未知",
          risks: result.safety?.risks || "暂无风险"
        },
        insights: {
          capacity: result.insights?.capacity || "通行能力待评估",
          standard: result.insights?.standard || "合规性待评估"
        },
        suggestions: Array.isArray(result.suggestions) ? result.suggestions : []
      };
    } catch (e) {
      console.error("JSON 解析失败，原始内容:", content);
      console.error("解析错误:", e);
      return null;
    }
  } catch (error) {
    console.error("API 调用失败:", error);
    return null;
  }
};

export const analyzeDamagePhoto = async (
  photoUrl: string,
  meta?: { roadName?: string; locationText?: string }
): Promise<{ data?: any; error?: string }> => {
  if (!qwenVision || !QWEN_KEY) {
    return { error: '未配置 VITE_QWEN_API_KEY（千问视觉）' };
  }
  try {
    const messages: any[] = [
      {
        role: "system",
        content:
          "你是一名具有 15 年经验的道路病害诊断高级工程师。请结合图片和上下文，对路面病害进行专业定性、严重度评估，并给出详细的维修材料与工艺方案、养护建议及通行管控方案。务必返回 JSON，不要输出多余文字。",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `请针对这张道路病害照片输出详细分析 JSON，字段如下：
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
      {"name": "材料名称", "spec": "规格/型号", "usage": "用途说明", "unit_amount": "每平方米/每延米用量"},
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
  "lane_care_tips": [
    "日常养护建议1（面向养护人员）",
    "预防性措施2",
    "长期维护建议3"
  ],
  "reasoning": "判断依据详细说明",
  "highlight_regions": [
    {"label": "病害区域说明", "description": "该区域的详细特征描述"}
  ]
}
道路名: ${meta?.roadName || "未知"}
位置: ${meta?.locationText || "未知"}
注意：请基于图片内容给出尽可能准确的分析，确保所有字段都有值。`,
          },
          {
            type: "image_url",
            image_url: { url: photoUrl },
          },
        ],
      },
    ];

    const completion = await qwenVision.chat.completions.create({
      messages,
      model: "qwen-vl-plus",
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return { error: '未收到模型响应' };
    const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
    return { data: JSON.parse(cleaned) };
  } catch (err: any) {
    console.error("analyzeDamagePhoto failed", err?.response || err);
    const msg = err?.response?.data?.error?.message || err?.message || '分析失败';
    return { error: msg };
  }
};

export const chatWithAssistant = async (history: {role: string, content: string}[], message: string) => {
  try {
    // 转换消息格式
    const messages: any[] = [
      { 
        role: "system", 
        content: '你是一位精通 WebGIS 和交通工程的专家助手。请以专业、简洁的方式回答用户问题。请不要使用 Markdown 符号（如 #、*、- 等）。请直接使用清晰的标题行、换行和空格来组织内容。你的回复应当看起来像一份干净、整洁的纯文本报告。'
      }
    ];

    // 添加历史消息
    history.forEach(msg => {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      });
    });

    // 添加当前消息
    messages.push({ role: "user", content: message });

    const completion = await openai.chat.completions.create({
      messages: messages,
      model: "deepseek-chat",
      temperature: 0.7,
    });

    return completion.choices[0]?.message?.content || "抱歉，未能生成回复。";
  } catch (error) {
    console.error("聊天 API 调用失败:", error);
    return "抱歉，暂时无法回答问题，请稍后再试。";
  }
};
