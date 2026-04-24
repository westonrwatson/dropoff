/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_BASE_URL?: string
  readonly VITE_GEMINI_INSIGHTS_LITE_MODEL?: string
  readonly VITE_GEMINI_INSIGHTS_FALLBACK_MODEL?: string
  readonly VITE_GEMINI_INSIGHTS_PRIMARY_TIMEOUT_MS?: string
  readonly VITE_GEMINI_INSIGHTS_FALLBACK_TIMEOUT_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
