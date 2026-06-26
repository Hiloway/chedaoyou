/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 百度街景 / 地图 API Key（前端可见，受 referer 限制） */
  readonly VITE_BAIDU_AK?: string;
  /** 应用标题 */
  readonly VITE_APP_TITLE?: string;
  /** 自定义 API 基址（默认走 vite proxy /api） */
  readonly VITE_API_BASE_URL?: string;
  /** 坐标系模式：wgs84 | gcj02 */
  readonly VITE_COORDINATE_MODE?: 'wgs84' | 'gcj02';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
