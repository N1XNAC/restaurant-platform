/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin used when the site is hosted separately from the API. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
