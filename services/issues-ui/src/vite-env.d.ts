/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __BUILD_SHA__: string;

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
