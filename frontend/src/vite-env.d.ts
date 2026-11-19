/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin used when the site is hosted separately from the API. */
  readonly VITE_API_BASE_URL?: string;
  /** Sub-path for project hosting, e.g. `/lumiere-ops/` on GitHub Pages. */
  readonly VITE_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
