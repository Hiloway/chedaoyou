/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEEPSEEK_API_KEY: string;
  // 可以添加其他 Vite 环境变量
  readonly VITE_APP_TITLE?: string;
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
