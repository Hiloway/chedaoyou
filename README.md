<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 车道优系统

基于 WebGIS 的车道健康度监测与养护管理平台。前端 React + Leaflet + 天地图，后端 Express + MySQL，集成 DeepSeek 文本分析与通义千问视觉病害诊断。

## 功能概览

- **地图可视化**：天地图底图 + OpenStreetMap Overpass 路网拉取，支持框选区域分析
- **路况工作流**：上报 → 指派 → 维修 → 验收 → 完成，五状态流转 + 历史记录
- **破损点上报**：地图选点 + 照片上传 + 百度街景查看
- **AI 病害诊断**：千问视觉识别病害类型、严重度，输出维修材料/工艺/通行管控方案
- **空间分析**：Getis-Ord Gi* 热点分析 + 核密度估计，区域健康度评分
- **多角色**：管理员 / 维修方 / 普通用户，JWT 鉴权

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite 6 + Leaflet + TailwindCSS |
| 后端 | Express 5 + MySQL2 + JWT + bcryptjs |
| AI | DeepSeek（文本）+ 通义千问 VL（视觉），经后端代理调用 |
| 地图 | 天地图底图 + OSM Overpass + 百度街景 |

## 目录结构

```
车道/
├── App.tsx                     # 主应用（地图 + 交互编排）
├── components/                 # UI 组件
│   ├── Sidebar.tsx             # 左侧栏：路段列表 + AI 对话
│   ├── LaneDetails.tsx         # 路段详情：上报/维修/审核
│   ├── MessageBox.tsx          # 用户上报消息盒
│   ├── ReportList.tsx          # 维修报告列表
│   ├── Login.tsx               # 登录注册
│   ├── ProfileModal.tsx        # 资料编辑
│   ├── RegionSelector.tsx      # 省/市/区三级联动
│   ├── MapToolbar.tsx          # 地图工具栏
│   ├── AreaAnalysisModal.tsx   # 区域分析弹窗
│   ├── PhotoAnalysisModal.tsx  # 图片预览 + AI 病害诊断
│   ├── StreetViewModal.tsx     # 百度街景弹窗
│   └── RoadHealthMonitor.tsx   # 路面健康度图例
├── hooks/                      # 自定义 Hook
│   ├── useMap.ts               # 地图初始化与图层管理
│   ├── useLanes.ts             # 路段数据加载
│   ├── useBoxSelect.ts         # 框选交互
│   ├── useDamageReport.ts      # 破损点上报
│   └── useAreaAnalysis.ts      # 选区空间分析
├── services/                   # 业务服务
│   ├── api.ts                  # 统一 API 客户端
│   ├── laneService.ts          # Overpass 路网拉取
│   ├── deepseekService.ts      # AI 服务（走后端代理）
│   ├── spatialAnalysis.ts      # Gi* + 核密度（纯 TS）
│   └── coordinateSystem.ts     # GCJ02/WGS84 互转
├── utils/                      # 工具函数
│   └── lane.ts                 # 路段相关工具（matchId/距离/格式化）
├── server/                     # 后端
│   ├── index.cjs               # Express 入口（装配 + 启动）
│   ├── src/
│   │   ├── config.js           # 配置（DB/JWT/常量）
│   │   ├── db.js               # 连接池
│   │   ├── schema.js           # 建表 SQL
│   │   ├── workflow.js         # 工作流状态机
│   │   ├── utils.js            # normalize 等工具
│   │   ├── middleware/auth.js  # JWT 鉴权中间件
│   │   └── routes/             # 路由按模块拆分
│   └── init.sql                # 数据库初始化脚本
└── types.ts                    # 全局类型定义
```

## 快速开始

**前置要求**：Node.js 18+、MySQL 8.0+

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env.local`，按需填写：

```bash
cp .env.example .env.local
```

关键变量说明：

| 变量 | 说明 |
|---|---|
| `DB_PASSWORD` | MySQL 密码（**必填**，不再有硬编码默认值） |
| `JWT_SECRET` | JWT 签名密钥（**生产必填**，建议 32 位以上随机串） |
| `DEEPSEEK_API_KEY` | DeepSeek 文本模型 Key |
| `QWEN_API_KEY` | 通义千问视觉模型 Key |
| `VITE_BAIDU_AK` | 百度地图/街景 AK（前端可见） |
| `VITE_COORDINATE_MODE` | 坐标系：`wgs84`（默认）或 `gcj02` |

> AI Key 现在通过后端代理调用，不再暴露到前端。

### 3. 初始化数据库

```bash
mysql -u root -p < server/init.sql
```

### 4. 启动服务

```bash
# 后端（端口 4000）
npm run start:server

# 前端（端口 3000，另开终端）
npm run dev
```

打开 http://localhost:3000 即可使用。

## 脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动前端开发服务器 |
| `npm run build` | 构建生产包 |
| `npm run start:server` | 启动后端 API 服务 |
